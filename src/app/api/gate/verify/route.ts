import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  AGE_OK_COOKIE,
  AGE_OK_MAX_AGE_SECONDS,
  AGE_OK_VALUE,
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  readCookie,
} from "@/lib/compliance-cookies";
import { funnelGateInstalled, GATE_ADMIT_COOKIE, GATE_COOKIE } from "@/lib/gate";
import { mintGateAdmit, mintGateSession, verifyGateAdmit } from "@/lib/gate-token";
import { resolveBehavior } from "@/lib/manifest";
import { resolveClientIp } from "@/lib/region";
import { getRequestManifest } from "@/lib/request-manifest";

/**
 * Funnel-gate verification BFF (P8) — the challenge submit. The interstitial
 * POSTs its proofs; this route scores them through the persons CDP (the
 * scoring authority), and on a pass mints the session + admit cookies
 * server-side. A returning visitor with a valid admit cookie is re-admitted
 * WITHOUT re-scoring (the durable-admit feature loopbio minted but never
 * read). If the CDP reports the circuit breaker suspended, everyone is
 * admitted — a mis-tuned gate must degrade to open.
 *
 * Cookies are set server-side only; the client can never forge a pass.
 */
export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "error", message: "unknown store" }, { status: 404 });
  }
  const behavior = resolveBehavior(resolution.manifest);
  const fg = behavior.gating.funnelGuard;
  const tenantRef = resolution.tenantRef;
  if (fg.mode !== "challenge") {
    return NextResponse.json(
      { outcome: "error", message: "this store has no funnel gate" },
      { status: 400 },
    );
  }
  // The paid-add-on check: never mint a gate pass for a store that hasn't
  // installed the add-on (the manifest flag alone is not trusted).
  if (!(await funnelGateInstalled(tenantRef))) {
    return NextResponse.json({ outcome: "ok", verdict: "pass", reason: "not_installed" });
  }

  const secret = process.env.FUNNEL_GATE_SECRET;
  const userAgent = request.headers.get("user-agent");
  const now = new Date();

  const admit = () => {
    const res = NextResponse.json({ outcome: "ok", verdict: "pass" });
    return res;
  };

  async function setSessionCookies(res: NextResponse, risk: number): Promise<NextResponse> {
    const session = await mintGateSession(secret ?? "", {
      tenantRef,
      risk,
      ttlSeconds: fg.cookieTtlSeconds,
      ceilingHours: fg.absoluteCeilingHours,
      userAgent,
      bindUserAgent: true,
      now,
    });
    const admitToken = await mintGateAdmit(secret ?? "", {
      tenantRef,
      admitDays: fg.admitCookieDays,
      now,
    });
    const secure = new URL(request.url).protocol === "https:";
    if (session !== null) {
      res.cookies.set(GATE_COOKIE, session, {
        path: "/",
        maxAge: fg.absoluteCeilingHours * 3600,
        httpOnly: true,
        sameSite: "lax",
        secure,
      });
    }
    if (admitToken !== null) {
      res.cookies.set(GATE_ADMIT_COOKIE, admitToken, {
        path: "/",
        maxAge: fg.admitCookieDays * 86400,
        httpOnly: true,
        sameSite: "lax",
        secure,
      });
    }
    return res;
  }

  // Returning visitor: a valid admit cookie re-admits without a re-challenge.
  const admitCookie = readCookie(request.headers, GATE_ADMIT_COOKIE) ?? undefined;
  if (await verifyGateAdmit(secret, admitCookie, tenantRef, now)) {
    return setSessionCookies(admit(), 0);
  }

  const body = (await request.json().catch(() => null)) as {
    turnstile_token?: unknown;
    honeypot?: unknown;
    started_at?: unknown;
    age_confirmed?: unknown;
  } | null;

  // Stable first-party visitor id (fd_sid), minting one if absent — the gate
  // is often a visitor's first contact, before any consent decision.
  const existingSid = readCookie(request.headers, ANON_ID_COOKIE);
  const visitorRef = existingSid ?? `anon_${randomUUID()}`;

  // Turnstile server-side verification (only when the tenant configured it).
  let turnstile: "verified" | "failed" | "absent" = "absent";
  const turnstileRequired = fg.turnstileSiteKey !== null;
  const turnstileSecret = process.env.FUNNEL_GATE_TURNSTILE_SECRET;
  if (turnstileRequired && turnstileSecret) {
    const supplied = typeof body?.turnstile_token === "string" ? body.turnstile_token : "";
    turnstile =
      supplied.length > 0 ? await verifyTurnstile(turnstileSecret, supplied, request) : "failed";
  }

  const fillMs =
    typeof body?.started_at === "number" && Number.isFinite(body.started_at)
      ? now.getTime() - body.started_at
      : null;

  // Score through the CDP.
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  const storefrontToken = process.env.FLIGHTDECK_STOREFRONT_TOKEN;
  if (!apiBaseUrl || !storefrontToken) {
    // No CDP wired (fixture/dev): admit rather than wall a dev store.
    const res = await setSessionCookies(admit(), 0);
    persistSid(res, existingSid, visitorRef, request);
    return res;
  }

  let verdict: "pass" | "deny" = "pass";
  let score = 0;
  let suspended = false;
  try {
    const evalRes = await fetch(
      `${apiBaseUrl.replace(/\/+$/, "")}/persons/v1/persons/gate/evaluate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-storefront-token": storefrontToken,
          "x-flightdeck-client-ip": resolveClientIp(request.headers) ?? "",
          ...(userAgent !== null ? { "user-agent": userAgent } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
        body: JSON.stringify({
          tenant_ref: tenantRef,
          visitor_ref: visitorRef,
          challenge_threshold: fg.challengeThreshold,
          proof: {
            turnstile,
            turnstile_required: turnstileRequired,
            honeypot_filled: typeof body?.honeypot === "string" && body.honeypot.trim().length > 0,
            fill_ms: fillMs,
            age_confirmed: body?.age_confirmed === true,
            age_required: fg.requireAgeConfirmation,
          },
        }),
      },
    );
    if (evalRes.status === 200) {
      const parsed = (await evalRes.json().catch(() => null)) as {
        verdict?: string;
        score?: number;
        suspended?: boolean;
      } | null;
      verdict = parsed?.verdict === "deny" ? "deny" : "pass";
      score = typeof parsed?.score === "number" ? parsed.score : 0;
      suspended = parsed?.suspended === true;
    }
    // Non-200 (CDP hiccup): fall through as a PASS — the outage-fail-open
    // rule. A gate must never turn a scoring outage into a locked store.
  } catch {
    verdict = "pass";
  }

  if (suspended || verdict === "pass") {
    const res = await setSessionCookies(admit(), score);
    persistSid(res, existingSid, visitorRef, request);
    // If the tenant's gate carries an age attestation, a pass also mints the
    // existing fd_age_ok cookie so the legacy interstitial self-suppresses.
    if (fg.requireAgeConfirmation && body?.age_confirmed === true) {
      res.cookies.set(AGE_OK_COOKIE, AGE_OK_VALUE, {
        path: "/",
        maxAge: AGE_OK_MAX_AGE_SECONDS,
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
      });
    }
    return res;
  }

  // Denied: no cookies, a bland 200 (a bot learns nothing from a distinct code).
  const res = NextResponse.json({ outcome: "ok", verdict: "deny" });
  persistSid(res, existingSid, visitorRef, request);
  return res;
}

function persistSid(
  res: NextResponse,
  existing: string | null,
  visitorRef: string,
  request: Request,
): void {
  if (existing) return;
  res.cookies.set(ANON_ID_COOKIE, visitorRef, {
    path: "/",
    maxAge: ANON_ID_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  });
}

/** Cloudflare Turnstile siteverify. Any error/timeout is a non-verified outcome. */
async function verifyTurnstile(
  secret: string,
  token: string,
  request: Request,
): Promise<"verified" | "failed"> {
  try {
    const form = new URLSearchParams({ secret, response: token });
    const ip = resolveClientIp(request.headers);
    if (ip !== null) form.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(2500),
    });
    const body = (await res.json().catch(() => null)) as { success?: unknown } | null;
    return body?.success === true ? "verified" : "failed";
  } catch {
    return "failed";
  }
}
