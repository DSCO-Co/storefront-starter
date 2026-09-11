import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getShopperSession } from "@/lib/account-session";
import { getCartActivityGateway } from "@/lib/cart-activity-store";
import { ANON_ID_COOKIE, ANON_ID_MAX_AGE_SECONDS, readCookie } from "@/lib/compliance-cookies";
import {
  CONSENT_COOKIE,
  gpcHeaderDenied,
  nonEssentialAllowed,
  parseConsentCookie,
} from "@/lib/consent";
import { createLogger } from "@/lib/logger";
import { resolveBehavior, storeHasBrowserTracking } from "@/lib/manifest";
import { cookieConsentEnforced, resolveRequestGeo } from "@/lib/region";
import { getRequestManifest } from "@/lib/request-manifest";

const logger = createLogger("api-cart-activity");

/**
 * Cart-activity ping BFF (FD Epic 16, abandoned-cart). The client calls this
 * on cart change (debounced, `lib/cart-activity-client.ts`) — and again once
 * an email is known (a conversion ping sets `checkedOut`). This route:
 *   1. resolves the tenant from Host (fail-closed, same as every other route);
 *   2. RE-CHECKS cookie consent server-side (the authority) — capturing an
 *      email for marketing recovery is NON-ESSENTIAL, so when the store
 *      enforces consent for this visitor's region and they have not granted,
 *      nothing is recorded (a deliberate, logged suppression — mirrors the
 *      `/api/track` and checkout ORDER_CONFIRMED gates);
 *   3. resolves the shopper email: an explicit body email (the checkout
 *      form's typed address) wins; otherwise the SIGNED-IN shopper's session
 *      email (server-verified, tenant-matched — never client input);
 *   4. binds the ping to the shopper's stable first-party anon subject id and
 *      forwards a SERVER-SIDE cart-activity row to the marketing module, so
 *      the abandoned-cart sweep can detect an idle cart the client-only cart
 *      (localStorage) would otherwise never expose.
 *
 * EMAIL GATE: without an email there is nothing to recover an abandoned cart
 * TO, so a ping with no resolvable email is accepted but NOT recorded —
 * reported as `recorded:false`, never a row that can never be acted on. A
 * failed forward is likewise reported (`recorded:false`), never laundered
 * into success.
 */

/** The signed-in shopper's email, when the session exists AND belongs to THIS store. */
async function resolveSessionEmail(tenantRef: string): Promise<string | null> {
  try {
    const shopper = await getShopperSession();
    return shopper !== null && shopper.tenantRef === tenantRef ? shopper.email : null;
  } catch {
    // No account session configured / cookie unreadable — a guest.
    return null;
  }
}

export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "error", message: "unknown store" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    cartRef?: unknown;
    itemCount?: unknown;
    email?: unknown;
    checkedOut?: unknown;
  } | null;

  const cartRef = typeof body?.cartRef === "string" ? body.cartRef.trim() : "";
  const itemCount = typeof body?.itemCount === "number" ? body.itemCount : Number.NaN;
  const bodyEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const checkedOut = body?.checkedOut === true;
  if (cartRef.length === 0 || !Number.isInteger(itemCount) || itemCount < 0) {
    return NextResponse.json(
      { outcome: "error", message: "cartRef and a non-negative integer itemCount are required" },
      { status: 400 },
    );
  }

  // ── CONSENT RE-CHECK (server authority) ─────────────────────────────────
  // Identical gate to /api/track and the checkout ORDER_CONFIRMED fire. The
  // marketing module itself has no per-subject consent store (its sends are
  // guarded by comms' suppression list); THIS is the platform's suppression
  // point for putting a shopper's email into the marketing audience at all.
  const behavior = resolveBehavior(resolution.manifest);
  const geo = resolveRequestGeo(request.headers);
  // Kill-switch tightening (wave 2): tracking stores can't disable the gate.
  const enforced = cookieConsentEnforced(
    behavior.compliance.cookieConsent,
    geo,
    storeHasBrowserTracking(resolution.manifest, behavior),
  );
  const signal = parseConsentCookie(readCookie(request.headers, CONSENT_COOKIE));
  // Global Privacy Control (F1): a stateless opt-out that wins over any
  // cookie, on every store.
  const gpc = gpcHeaderDenied(request.headers);
  if (gpc || !nonEssentialAllowed(enforced, signal)) {
    // Deliberate, logged suppression — never a silent drop, never recorded.
    logger.warn("cart-activity signal suppressed: no cookie consent", {
      tenantRef: resolution.tenantRef,
      ...(gpc ? { reason: "gpc" } : {}),
    });
    return NextResponse.json({ outcome: "ok", recorded: false });
  }

  // Explicit body email (typed at checkout) wins; else the signed-in
  // shopper's server-verified session email. Never invented.
  const email = bodyEmail.length > 0 ? bodyEmail : await resolveSessionEmail(resolution.tenantRef);

  // Stable first-party anon subject id — mint one if the visitor has none.
  const existingAnon = readCookie(request.headers, ANON_ID_COOKIE);
  const anonId = existingAnon ?? `anon_${randomUUID()}`;

  let recorded = false;
  if (email !== null && email.length > 0) {
    const outcome = await getCartActivityGateway().record({
      tenantRef: resolution.tenantRef,
      cartRef,
      subjectRef: anonId,
      email,
      itemCount,
      checkedOut,
    });
    if (outcome.outcome === "recorded") {
      recorded = true;
    } else {
      // A failed forward is not laundered into success — log it and report it.
      logger.error("cart-activity signal not recorded", {
        tenantRef: resolution.tenantRef,
        message: outcome.message,
      });
    }
  }

  const res = NextResponse.json({ outcome: "ok", recorded });
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
