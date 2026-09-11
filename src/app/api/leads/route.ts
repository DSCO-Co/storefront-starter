import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ANON_ID_COOKIE, ANON_ID_MAX_AGE_SECONDS, readCookie } from "@/lib/compliance-cookies";
import { getLeadsGateway } from "@/lib/leads-store";
import { createLogger } from "@/lib/logger";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";

const logger = createLogger("api-leads");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Minimum milliseconds between form mount and submit before we believe a
 * human filled it (the loopbio-v2 welcome-signup bot heuristic the
 * email-capture form was modeled on). Deliberately LOW — autofill users are
 * real users; only an instant submit is treated as a bot.
 */
const MIN_TIME_TO_SUBMIT_MS = 1000;

/**
 * Lead-capture BFF (LOO-3132) — the server half of the manifest-gated
 * `behavior.comms.emailCapture` surface (`EmailCaptureForm` POSTs here).
 * This route:
 *   1. resolves the tenant from Host (fail-closed, same as every other route);
 *   2. answers 404 when the store has not opted into email capture — the
 *      surface does not exist (the documented emailCapture posture);
 *   3. runs the server-side bot checks (honeypot `website` field; the
 *      form-mount timestamp's min-time-to-submit) — a bot submit is answered
 *      200 without a record (never tipping the bot off) but reported
 *      `recorded:false`, so nothing downstream mistakes it for a signup;
 *   4. forwards a real submit to the marketing module's leads route
 *      (subjects registry + optional welcome-sequence enrollment), bound to
 *      the shopper's stable first-party anon subject id.
 *
 * A FAILED forward is an honest 502 — the form shows its error state; the
 * shopper is never told "you're on the list" over a write that didn't land.
 */
export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "error", message: "unknown store" }, { status: 404 });
  }
  const behavior = resolveBehavior(resolution.manifest);
  const capture = behavior.comms.emailCapture;
  if (!capture.enabled) {
    // The surface does not exist for this store — indistinguishable from an
    // unknown route, the documented default posture.
    return NextResponse.json({ outcome: "error", message: "not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    website?: unknown;
    started_at?: unknown;
  } | null;

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { outcome: "error", message: "a valid email is required" },
      { status: 400 },
    );
  }

  // Stable first-party anon subject id — mint one if the visitor has none.
  const existingAnon = readCookie(request.headers, ANON_ID_COOKIE);
  const anonId = existingAnon ?? `anon_${randomUUID()}`;

  // ── bot checks ──────────────────────────────────────────────────────────
  // Honeypot: the visually-hidden `website` field humans never fill. Timing:
  // a submit faster than a human can act. Either way the response is a bland
  // 200 (a bot learns nothing) that truthfully reports `recorded:false`.
  const honeypotTripped = typeof body?.website === "string" && body.website.trim().length > 0;
  const startedAt = typeof body?.started_at === "number" ? body.started_at : null;
  const tooFast = startedAt === null || Date.now() - startedAt < MIN_TIME_TO_SUBMIT_MS;
  if (honeypotTripped || tooFast) {
    logger.warn("lead submit rejected by bot checks — not recorded", {
      tenantRef: resolution.tenantRef,
      honeypot: honeypotTripped,
      tooFast,
    });
    return NextResponse.json({ outcome: "ok", recorded: false });
  }

  const outcome = await getLeadsGateway().record({
    tenantRef: resolution.tenantRef,
    email,
    subjectRef: anonId,
    campaignRef: capture.sequenceRef,
  });
  if (outcome.outcome !== "recorded") {
    // A failed forward is not laundered into success — the form's honest
    // error state ("Couldn't sign you up — try again.") depends on this.
    logger.error("lead not recorded", {
      tenantRef: resolution.tenantRef,
      message: outcome.message,
    });
    return NextResponse.json(
      { outcome: "error", message: "signup could not be recorded" },
      { status: 502 },
    );
  }

  const res = NextResponse.json({ outcome: "ok", recorded: true });
  if (!existingAnon) {
    const secure = new URL(request.url).protocol === "https:";
    res.cookies.set(ANON_ID_COOKIE, anonId, {
      path: "/",
      maxAge: ANON_ID_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure,
    });
  }
  return res;
}
