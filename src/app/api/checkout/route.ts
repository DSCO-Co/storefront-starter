import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getShopperSession } from "@/lib/account-session";
import { ARL_DISCLOSURE_REF, ARL_DISCLOSURE_TEXT } from "@/lib/arl-disclosure";
import { getBeaconProducer } from "@/lib/beacon-producer";
import { getCheckoutGateway } from "@/lib/checkout";
import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  hasAgePass,
  hasRuoAck,
  readCookie,
} from "@/lib/compliance-cookies";
import {
  CONSENT_COOKIE,
  categoryAllowed,
  gpcHeaderDenied,
  parseConsentCookie,
} from "@/lib/consent";
import { getConsentGateway } from "@/lib/consent-store";
import { createLogger } from "@/lib/logger";
import { resolveBehavior, storeHasBrowserTracking } from "@/lib/manifest";
import { capturePosthog } from "@/lib/posthog-producer";
import { resolvedPricingConfig, subscriptionCadences } from "@/lib/pricing";
import { parseReferralParam, REFERRAL_COOKIE } from "@/lib/referral";
import { cookieConsentEnforced, resolveClientIp, resolveRequestGeo } from "@/lib/region";
import { getRequestManifest } from "@/lib/request-manifest";
import { RUO_ACK_DISCLOSURE_REF, ruoAckCategories } from "@/lib/ruo-ack";

const logger = createLogger("api-checkout");

/**
 * The checkout BFF Route Handler — the ONLY place card fields leave the
 * shopper's browser to. This is what makes checkout "platform-served" per
 * ADR 0003: the browser never talks to `@dscodotco/checkout` (or any payment
 * gateway) directly, and the server-only `FLIGHTDECK_OPERATOR_TOKEN`
 * (`lib/checkout.ts`) never ships in the client bundle — Next.js Route
 * Handlers run exclusively on the server. That server-only credential is
 * now `FLIGHTDECK_STOREFRONT_TOKEN`, not the platform-wide operator token
 * — see `lib/checkout.ts`'s docblock (B7-4,
 * docs/audits/batch7-review-2026-08-31.md).
 *
 * TENANCY: `tenantRef` is resolved HERE, server-side, from the request's
 * `Host` header via `getRequestManifest()` — the SAME fail-closed
 * `Host -> verified domain-mapping row -> tenant_ref` path every other
 * route in this surface uses (ADR 0003; FD-4: never resolve tenant from
 * request data). A client-supplied tenant in the POST body is never
 * trusted for this — otherwise any caller could point THIS tenant's
 * checkout credential at placing an order for a DIFFERENT tenant.
 */
/**
 * Validate an optional saved ship-to address off the wire (SEAM 2b). Returns
 * null for anything absent or half-specified — never a partial address. Only
 * a fully-formed address (label + line1 + city + state + postal + country) is
 * forwarded; `line2` is optional.
 */
function parseShippingAddress(raw: unknown): {
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
} | null {
  if (raw === null || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const label = str(a.label);
  const line1 = str(a.line1);
  const city = str(a.city);
  const state = str(a.state);
  const postalCode = str(a.postalCode);
  const country = str(a.country);
  if (
    label.length === 0 ||
    line1.length === 0 ||
    city.length === 0 ||
    state.length === 0 ||
    postalCode.length === 0 ||
    country.length === 0
  ) {
    return null;
  }
  const line2 = str(a.line2);
  return { label, line1, line2: line2.length > 0 ? line2 : null, city, state, postalCode, country };
}

async function resolveShopperPersonId(tenantRef: string): Promise<string | null> {
  try {
    const shopper = await getShopperSession();
    return shopper !== null && shopper.tenantRef === tenantRef ? shopper.personId : null;
  } catch {
    // No account session configured / cookie unreadable — treat as a guest.
    return null;
  }
}

export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "error", message: "unknown store" }, { status: 404 });
  }
  if (resolution.manifest.store.status !== "live") {
    return NextResponse.json(
      { outcome: "error", message: "this store is not currently available" },
      { status: 404 },
    );
  }
  const tenantRef = resolution.tenantRef;
  const behavior = resolveBehavior(resolution.manifest);

  // Age gate — checkbox mode GATES CHECKOUT (LOO-3050 item 3): the affirmation
  // is server-enforced here, not a client-only checkbox a scripted POST could
  // skip. The affirmation POSTs `/api/age-gate`, which sets the httpOnly
  // `fd_age_ok` cookie; without it, this store's checkout is refused.
  // (interstitial mode blocks at the layout instead — it never reaches here.)
  const ageGate = behavior.compliance.ageGate;
  if (ageGate.enabled && ageGate.mode === "checkbox" && !hasAgePass(request.headers)) {
    return NextResponse.json(
      { outcome: "error", message: "age verification required before checkout" },
      { status: 403 },
    );
  }

  // RUO acknowledgment — SERVER-ENFORCED, always-on. The research-use-only
  // affirmation is a non-removable compliance surface (sibling of the hardcoded
  // RUO_DISCLAIMER), so unlike the age gate it is NOT manifest-configurable: a
  // scripted POST to this route can never skip it. The affirmation POSTs
  // `/api/ruo-ack`, which sets the httpOnly `fd_ruo_ok` cookie; without it,
  // checkout is refused with a specific `ruo_ack_required` code (never a silent
  // pass, never a 5xx). The order-bound audit row is persisted below, AFTER
  // placement (`persons.consent_records`).
  if (!hasRuoAck(request.headers)) {
    return NextResponse.json(
      {
        outcome: "error",
        code: "ruo_ack_required",
        message: "research-use-only acknowledgment required before checkout",
      },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const customerRef = typeof body?.customerRef === "string" ? body.customerRef : "";
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  // Coupon code (LOO-3156). Validated and applied SERVER-SIDE by commerce
  // (unknown/inactive/exhausted codes refuse the order with an honest,
  // verbatim reason); the manifest's promotions gate is enforced here.
  const couponCode =
    typeof body?.couponCode === "string" && body.couponCode.trim().length > 0
      ? body.couponCode.trim()
      : null;
  const items = Array.isArray(body?.items) ? body.items : null;
  const card = body?.card as { ccnumber?: unknown; ccexp?: unknown; cvv?: unknown } | undefined;
  const cartTotalCents = body?.cartTotalCents;
  const cartCurrency = typeof body?.cartCurrency === "string" ? body.cartCurrency : "usd";
  // Tender inputs (LOO-3156). The affordance only sends these when the
  // manifest gate is on; the checkout module re-checks the manifest-independent
  // facts (balance, code validity) and never over-applies.
  const applyStoreCredit = body?.applyStoreCredit === true;
  const giftCardCode =
    typeof body?.giftCardCode === "string" && body.giftCardCode.trim().length > 0
      ? body.giftCardCode.trim()
      : null;
  // FD Epic 7 / LOO-3154: opt into subscribe-and-save — SERVER-ENFORCED
  // against the store's `behavior.subscriptions` gate, fail-closed. The form
  // only shows the affordance when the gate offers cadences, but a scripted
  // POST is refused HERE regardless: gate off (or no cadences) -> 403; a
  // cadence the manifest does not declare -> 400. The forwarded policy
  // (cadence + its declared discount) is resolved from the Host manifest,
  // never from the client.
  const subscribe = body?.subscribe === true;
  const offeredCadences = subscriptionCadences(behavior);
  let subscription: { enabled: true; intervalDays: number; discountPercent: number } | null = null;
  if (subscribe) {
    if (offeredCadences.length === 0) {
      return NextResponse.json(
        {
          outcome: "error",
          code: "subscriptions_disabled",
          message: "this store does not offer subscriptions",
        },
        { status: 403 },
      );
    }
    const requestedDays = body?.subscriptionIntervalDays;
    const chosen = offeredCadences.find((c) => c.days === requestedDays);
    if (chosen === undefined) {
      return NextResponse.json(
        {
          outcome: "error",
          code: "invalid_subscription_cadence",
          message: "the requested subscription cadence is not offered by this store",
        },
        { status: 400 },
      );
    }
    subscription = { enabled: true, intervalDays: chosen.days, discountPercent: chosen.percent };
  }

  // ── ARL CONSENT EVIDENCE (C5, consumer-compliance remediation 2026-09-09) ─
  // A subscription-creating checkout carries the pinned `subscriptionConsent`
  // evidence: the sha-256 of the EXACT rendered disclosure text (one shared
  // constant with the UI — lib/arl-disclosure.tsx — so rendered and hashed
  // copy cannot drift), the server-computed sha-256 of the client IP, and the
  // request UA. The checkout module REJECTS a storefront-originated
  // subscription without it (400) — surfaced below as an honest error, never
  // a silent retry.
  const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  const subscriptionConsent =
    subscription !== null
      ? {
          disclosureRef: ARL_DISCLOSURE_REF,
          disclosureSha256: sha256Hex(ARL_DISCLOSURE_TEXT),
          ipHash: sha256Hex(resolveClientIp(request.headers) ?? "unknown"),
          userAgent: request.headers.get("user-agent") ?? "",
        }
      : null;
  // SEAM 1: the shopper's shipping-speed choice — a selection between the two
  // manifest-declared rates, never a price. The pricing POLICY itself is
  // resolved server-side below from the Host manifest; `expedited` only picks
  // which manifest rate applies. Defaults to standard.
  const expedited = body?.expedited === true;
  // SEAM 2b: an optional saved ship-to address the shopper picked. Only honored
  // when the store's address-book gate is on AND there is a signed-in shopper —
  // a guest or an address-book-off store never forwards one.
  const shippingAddress = parseShippingAddress(body?.shippingAddress);

  if (
    tenantRef.length === 0 ||
    customerRef.length === 0 ||
    idempotencyKey.length === 0 ||
    items === null ||
    items.length === 0 ||
    typeof card?.ccnumber !== "string" ||
    typeof card?.ccexp !== "string" ||
    typeof cartTotalCents !== "number" ||
    !Number.isInteger(cartTotalCents)
  ) {
    return NextResponse.json(
      { outcome: "error", message: "invalid checkout request" },
      { status: 400 },
    );
  }

  const parsedItems: Array<{ variantId: string; quantity: number }> = [];
  for (const raw of items as unknown[]) {
    const item = raw as { variantId?: unknown; quantity?: unknown };
    if (
      typeof item.variantId !== "string" ||
      item.variantId.length === 0 ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      return NextResponse.json(
        { outcome: "error", message: "invalid checkout request" },
        { status: 400 },
      );
    }
    parsedItems.push({ variantId: item.variantId, quantity: item.quantity });
  }

  // Attribute the order to the signed-in shopper, when there is one. Read
  // SERVER-SIDE from the httpOnly session cookie — never from the POST body —
  // and only when the session's tenant matches the Host-resolved tenant, so
  // a session for another store can never tag this store's order (LOO-3041).
  // GUEST-SAFE: a checkout must succeed for a guest regardless of whether the
  // account session is configured (e.g. SESSION_SECRET unset) — any failure
  // reading the session degrades to an unattributed guest order, never a
  // broken checkout.
  const personId = await resolveShopperPersonId(tenantRef);

  // Referral capture hop (gap brief docs/briefs/referral-capture-gap-
  // 2026-09-06.md): the `?ref=` code the middleware stashed in the httpOnly
  // `fd_ref` cookie — read SERVER-SIDE from the request, never from the POST
  // body — forwarded only when the store's referrals gate is on (the same
  // gate that permitted the capture; a store that turned it off since simply
  // forwards nothing). Re-validated through the same parser the capture
  // used; anything malformed is silently dropped. Downstream, affiliates
  // validates the code against real affiliate rows — an unknown code
  // attributes nothing and can never fail this checkout.
  const referralCode = behavior.referrals.enabled
    ? parseReferralParam(readCookie(request.headers, REFERRAL_COOKIE))
    : null;

  // Promotions gate (LOO-3156): a store with promotions disabled REFUSES a
  // coupon honestly — never silently drops the code and charges full price
  // (the shopper believed a discount was in play).
  if (couponCode !== null && !behavior.promotions.enabled) {
    return NextResponse.json(
      {
        outcome: "error",
        message: "Coupon codes are not enabled for this store, so the order was not placed.",
      },
      { status: 400 },
    );
  }

  const outcome = await getCheckoutGateway().submit({
    tenantRef,
    customerRef,
    ...(personId ? { personId } : {}),
    idempotencyKey,
    items: parsedItems,
    card: {
      ccnumber: card.ccnumber,
      ccexp: card.ccexp,
      ...(typeof card.cvv === "string" ? { cvv: card.cvv } : {}),
    },
    couponCode,
    referralCode,
    cartTotalCents,
    cartCurrency,
    applyStoreCredit,
    giftCardCode,
    subscribe,
    ...(subscription !== null ? { subscription } : {}),
    ...(subscriptionConsent !== null ? { subscriptionConsent } : {}),
    // Forward the store's resolved fraud policy + the server-resolved client
    // IP so `@dscodotco/checkout` enforces the manifest's AVS/CVV + velocity floor
    // (FD Epic 10) before capture. Both are server-derived, never client input.
    fraud: behavior.fraud,
    clientIp: resolveClientIp(request.headers),
    // SEAM 1: the store's shipping + FAIL-CLOSED tax policy, resolved from the
    // request Host (trusted, ADR 0003) — NOT from the POST body. The module
    // re-prices the authoritative total from it; a `stripe_tax` store 422s
    // here (surfaced as an honest error, never a $0-tax order).
    pricing: resolvedPricingConfig(behavior, expedited),
    // SEAM 2b: forward the picked saved address only when the store's
    // address-book gate is on and a shopper is signed in (personId present).
    ...(behavior.accounts.addressBook && personId !== null && shippingAddress !== null
      ? { shippingAddress }
      : {}),
  });

  // ── RUO-ACK AUDIT PERSISTENCE ───────────────────────────────────────────
  // Bind the research-use-only affirmation to THIS placed order as an
  // append-only, immutable, versioned compliance artifact in
  // `persons.consent_records` — timestamp + the exact disclosure version
  // (`disclosure_ref`) the shopper affirmed, `source` naming the order. The
  // gate above already REFUSED the order without the affirmation cookie; this
  // is the durable record that the placed order carried it. It runs only for a
  // placed order and, like the post-order beacon fire, never fails the
  // already-charged response — a persistence failure is LOGGED and surfaced
  // honestly (never laundered into success), it does not un-place the order.
  let mintedAnonId: string | null = null;
  if (outcome.outcome === "placed") {
    const existingAnon = readCookie(request.headers, ANON_ID_COOKIE);
    const anonId = existingAnon ?? `anon_${randomUUID()}`;
    if (!existingAnon) mintedAnonId = anonId;
    const geo = resolveRequestGeo(request.headers);
    const capturedAt = new Date().toISOString();
    try {
      const recorded = await getConsentGateway().record({
        tenantRef,
        subject: personId ? { type: "person", ref: personId } : { type: "anon", ref: anonId },
        categories: ruoAckCategories(),
        region: geo.country ?? "unknown",
        disclosureRef:
          behavior.compliance.acknowledgmentGate.disclosureRef ?? RUO_ACK_DISCLOSURE_REF,
        source: `checkout:order_${outcome.orderId}`,
        capturedAt,
      });
      if (recorded.outcome === "error") {
        logger.error("ruo-ack consent row not persisted; order already placed", {
          tenantRef,
          orderId: outcome.orderId,
          message: recorded.message,
        });
      }
    } catch (err) {
      logger.error("ruo-ack consent persistence threw; order already placed, ignoring", {
        tenantRef,
        orderId: outcome.orderId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── COOKIE-CONSENT ENFORCEMENT (LOO-3050 item 1) ────────────────────────
  // A placed order is a Purchase (ORDER_CONFIRMED) conversion we would fire
  // to the ad platform via beacon — NON-ESSENTIAL tracking. Placing the
  // order itself is essential/transactional and already happened above,
  // regardless of consent. The beacon fire, however, is gated: when the
  // store's cookie-consent gate is enforced for THIS visitor's region and
  // they have not granted, NOTHING leaves this BFF. This is the suppression
  // point — the fire is inside the `if`, so no-consent = no dispatch call.
  if (outcome.outcome === "placed") {
    const geo = resolveRequestGeo(request.headers);
    // Kill-switch tightening (wave 2): a store with browser tracking cannot
    // opt out of enforcement via `cookieConsent.enabled: false`.
    const enforced = cookieConsentEnforced(
      behavior.compliance.cookieConsent,
      geo,
      storeHasBrowserTracking(resolution.manifest, behavior),
    );
    const signal = parseConsentCookie(readCookie(request.headers, CONSENT_COOKIE));
    // Global Privacy Control (F1): `Sec-GPC: 1` suppresses the marketing
    // fire statelessly, whatever the cookie says. E5 granularity: the beacon
    // CAPI fire is ADVERTISING; the PostHog capture below is ANALYTICS.
    const gpc = gpcHeaderDenied(request.headers);
    if (!gpc && categoryAllowed(enforced, signal, "advertising")) {
      // The order IS PLACED. A non-essential post-order marketing fire must
      // NEVER fail the checkout response — not a dispatch error, and not a
      // THROW from getBeaconProducer() itself (it throws when misconfigured,
      // e.g. no beacon ingest token). Both are caught here; the shopper still
      // gets their confirmation. (Retrying would risk a double-charge on an
      // already-placed order — so a beacon hiccup can never gate the response.)
      try {
        const dispatched = await getBeaconProducer().dispatch({
          tenantRef,
          eventId: `order_${outcome.orderId}`,
          occurredAt: new Date().toISOString(),
          order: {
            id: outcome.orderId,
            value: outcome.totalCents / 100,
            currency: outcome.currency,
            products: parsedItems.map((i) => ({ id: i.variantId, quantity: i.quantity })),
          },
          ...(customerRef.startsWith("guest:")
            ? { customer: { email: customerRef.slice("guest:".length) } }
            : {}),
        });
        if (dispatched.outcome === "error") {
          logger.error("beacon purchase dispatch failed", {
            tenantRef,
            message: dispatched.message,
          });
        }
      } catch (err) {
        logger.error("beacon purchase fire threw; order already placed, ignoring", {
          tenantRef,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // Not an error — a deliberate, logged suppression (never a silent drop).
      logger.warn("beacon purchase suppressed: no cookie consent", { tenantRef });
    }
    // PostHog purchase (additional destination) — ANALYTICS category (E5),
    // gated separately from the advertising/CAPI leg above; same
    // fire-and-forget / throw-safe posture. distinct_id = the first-party
    // anon subject (existing cookie, else the one just minted for the
    // RUO-ack row, else the order id as a last resort).
    if (!gpc && categoryAllowed(enforced, signal, "analytics")) {
      capturePosthog({
        distinctId:
          readCookie(request.headers, ANON_ID_COOKIE) ?? mintedAnonId ?? `order_${outcome.orderId}`,
        tenantRef,
        event: "ORDER_CONFIRMED",
        properties: {
          order_id: outcome.orderId,
          value: outcome.totalCents / 100,
          currency: outcome.currency,
        },
      });
    }
  }

  const response = NextResponse.json(outcome);
  // Persist the first-party anon subject id when we minted one for the RUO-ack
  // consent row, so a returning shopper's future affirmations bind to the same
  // subject (mirrors the consent BFF). Not httpOnly — it carries no auth value.
  if (mintedAnonId !== null) {
    response.cookies.set(ANON_ID_COOKIE, mintedAnonId, {
      path: "/",
      maxAge: ANON_ID_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
    });
  }
  return response;
}
