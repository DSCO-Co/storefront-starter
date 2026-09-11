import { NextResponse } from "next/server";
import { readCookie } from "@/lib/compliance-cookies";
import { GATE_COOKIE } from "@/lib/gate";
import { mintGateSession, verifyGateSession } from "@/lib/gate-token";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";

/**
 * Silent session renewal (P8) — the structural fix for the checkout-bounce
 * class (expired gate cookies walling active shoppers mid-checkout during an
 * outage). The layout mounts a tiny client that
 * POSTs here when the session is past half-life OR inside outage grace; this
 * re-mints the cookie carrying the ORIGINAL admission instant (so the
 * absolute ceiling still bounds it) with a fresh sliding window. A visitor
 * actively shopping is never walled mid-flow.
 *
 * An authentic-but-expired session (within grace) renews too — that is the
 * whole point. A forged/foreign/ceiling-exceeded session does NOT renew
 * (verify returns invalid, or expired-past-ceiling with no remaining
 * window) — those re-enter the challenge on the next full render.
 */
export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "error" }, { status: 404 });
  }
  const fg = resolveBehavior(resolution.manifest).gating.funnelGuard;
  if (fg.mode !== "challenge") {
    return NextResponse.json({ outcome: "off" });
  }

  const secret = process.env.FUNNEL_GATE_SECRET;
  const userAgent = request.headers.get("user-agent");
  const now = new Date();
  const state = await verifyGateSession(
    secret,
    readCookie(request.headers, GATE_COOKIE) ?? undefined,
    userAgent,
    now,
  );

  if (state.state === "missing" || state.state === "invalid") {
    // Nothing authentic to renew — the next full render challenges.
    return NextResponse.json({ outcome: "no_session" }, { status: 401 });
  }
  if (state.state === "expired" && state.expiredForSeconds > fg.outageGraceSeconds) {
    return NextResponse.json({ outcome: "expired" }, { status: 401 });
  }

  const renewed = await mintGateSession(secret ?? "", {
    tenantRef: resolution.tenantRef,
    risk: state.claims.risk,
    ttlSeconds: fg.cookieTtlSeconds,
    ceilingHours: fg.absoluteCeilingHours,
    userAgent,
    bindUserAgent: state.claims.uah !== undefined,
    now,
    ist: state.claims.ist,
    sid: state.claims.sid,
  });
  if (renewed === null) {
    return NextResponse.json({ outcome: "no_session" }, { status: 401 });
  }
  const res = NextResponse.json({ outcome: "renewed" });
  res.cookies.set(GATE_COOKIE, renewed, {
    path: "/",
    maxAge: fg.absoluteCeilingHours * 3600,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  });
  return res;
}
