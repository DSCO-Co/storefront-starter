import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  type BeaconFunnelEvent,
  type BeaconFunnelEventType,
  getBeaconProducer,
  isBeaconFunnelEventType,
} from "@/lib/beacon-producer";
import { ANON_ID_COOKIE, readCookie } from "@/lib/compliance-cookies";
import {
  CONSENT_COOKIE,
  categoryAllowed,
  gpcHeaderDenied,
  parseConsentCookie,
} from "@/lib/consent";
import { createLogger } from "@/lib/logger";
import { resolveBehavior, storeHasBrowserTracking } from "@/lib/manifest";
import { capturePosthog } from "@/lib/posthog-producer";
import { cookieConsentEnforced, resolveRequestGeo } from "@/lib/region";
import { getRequestManifest } from "@/lib/request-manifest";
import { getVisitorGateway } from "@/lib/visitor-store";

const logger = createLogger("api-track");

/** The storefront default currency (integer-cents money, "usd" everywhere). */
const DEFAULT_CURRENCY = "usd";

/**
 * Funnel-tracking BFF (marketing-funnel wiring, LOO-3050 follow-up). The
 * client `track()` helper (`lib/track.ts`) POSTs a funnel event here; this
 * route is the ONE place the server-only `bik_` beacon ingest token is used,
 * so it never ships to the browser — the same platform-served posture the
 * checkout/cart-activity BFFs take.
 *
 * DOUBLE-ENFORCED CONSENT: the client short-circuits without consent, but the
 * server is the authority — it RE-DERIVES the exact same gate the checkout
 * ORDER_CONFIRMED fire uses (`cookieConsentEnforced` × `nonEssentialAllowed`)
 * from the request headers, never trusting the client. No consent ⇒ nothing
 * leaves this BFF.
 *
 * TENANCY: `tenantRef` is resolved HERE from the request Host via
 * `getRequestManifest()` (fail-closed `Host → verified mapping → tenant_ref`),
 * never from the POST body.
 *
 * QUIET BY DESIGN: tracking is non-essential, so anything that isn't a valid,
 * consented, well-formed funnel event is a quiet `204` no-op — an unknown
 * `eventType`, a malformed payload, a suppressed-by-consent event, or a beacon
 * send failure all return 204 and never surface an error that could break the
 * page. Only an unknown Host is a hard 404 (it isn't a tracking decision — we
 * genuinely can't resolve a store).
 */

/** A 204 with no body — the quiet no-op every non-fire path returns. */
function noop(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

function optString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optCents(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Short, EVENT_ID_RE-safe per-type prefix for the minted dedup id. */
const EVENT_ID_PREFIX: Record<BeaconFunnelEventType, string> = {
  VIEW_CONTENT: "vc",
  ADD_TO_CART: "atc",
  INITIATE_CHECKOUT: "ic",
  SEARCH: "srch",
  LEAD_CAPTURED: "lead",
};

/**
 * Beacon's own event-id shape (modules/beacon/src/domain/envelope.ts
 * EVENT_ID_RE) — anything else would be rejected at ingest anyway.
 */
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/**
 * Browser-pixel dedup (gap brief 2026-09-06, seam step 4): `track()` now
 * mints the dedup event id CLIENT-side and fires it at both the browser
 * pixel and this route, so the destination (Meta CAPI) dedupes the pair.
 * Accept the client's id only when it is beacon-shape-valid AND carries this
 * event type's own prefix (a caller can't smuggle a cross-type or arbitrary
 * id); otherwise mint server-side exactly as before — the fire still goes
 * out, just without a browser twin to dedup against.
 */
function resolveEventId(eventType: BeaconFunnelEventType, raw: unknown): string {
  if (
    typeof raw === "string" &&
    EVENT_ID_RE.test(raw) &&
    raw.startsWith(`${EVENT_ID_PREFIX[eventType]}_`)
  ) {
    return raw;
  }
  return `${EVENT_ID_PREFIX[eventType]}_${randomUUID()}`;
}

/**
 * Map a validated client payload to the beacon funnel envelope, minting a
 * per-fire dedup event id. Returns null for a malformed payload (→ quiet 204):
 * a funnel event we can't shape faithfully is never sent half-formed.
 */
function buildFunnelEvent(
  eventType: BeaconFunnelEventType,
  tenantRef: string,
  body: Record<string, unknown>,
): BeaconFunnelEvent | null {
  const base = {
    tenantRef,
    eventType,
    eventId: resolveEventId(eventType, body.eventId),
    occurredAt: new Date().toISOString(),
  } as const;
  const currency = optString(body.currency) || DEFAULT_CURRENCY;

  switch (eventType) {
    case "VIEW_CONTENT": {
      const productId = optString(body.productId);
      const priceCents = optCents(body.priceCents);
      if (productId.length === 0 || priceCents === null) return null;
      const price = priceCents / 100;
      return {
        ...base,
        order: {
          id: productId,
          value: price,
          currency,
          products: [{ id: productId, quantity: 1, price }],
        },
      };
    }
    case "ADD_TO_CART": {
      const variantId = optString(body.variantId);
      const unitPriceCents = optCents(body.unitPriceCents);
      const quantity =
        typeof body.quantity === "number" && Number.isInteger(body.quantity) && body.quantity > 0
          ? body.quantity
          : null;
      if (variantId.length === 0 || unitPriceCents === null || quantity === null) return null;
      const unitPrice = unitPriceCents / 100;
      return {
        ...base,
        order: {
          id: variantId,
          value: unitPrice * quantity,
          currency,
          products: [{ id: variantId, quantity, price: unitPrice }],
        },
      };
    }
    case "INITIATE_CHECKOUT": {
      const totalCents = optCents(body.totalCents);
      const rawItems = Array.isArray(body.items) ? body.items : null;
      if (totalCents === null || rawItems === null || rawItems.length === 0) return null;
      const products: Array<{ id: string; quantity: number; price: number }> = [];
      for (const raw of rawItems) {
        if (raw === null || typeof raw !== "object") return null;
        const item = raw as Record<string, unknown>;
        const variantId = optString(item.variantId);
        const unitPriceCents = optCents(item.unitPriceCents);
        const quantity =
          typeof item.quantity === "number" && Number.isInteger(item.quantity) && item.quantity > 0
            ? item.quantity
            : null;
        if (variantId.length === 0 || unitPriceCents === null || quantity === null) return null;
        products.push({ id: variantId, quantity, price: unitPriceCents / 100 });
      }
      const cartRef = optString(body.cartRef);
      return {
        ...base,
        order: {
          id: cartRef.length > 0 ? cartRef : "cart",
          value: totalCents / 100,
          currency,
          products,
        },
      };
    }
    case "SEARCH": {
      const query = optString(body.query);
      if (query.length === 0) return null;
      // Cap the forwarded query — an unbounded string is neither useful for
      // ad match nor safe to relay verbatim.
      return { ...base, searchString: query.slice(0, 200) };
    }
    case "LEAD_CAPTURED": {
      const email = optString(body.email);
      if (email.length === 0) return null;
      // RAW email — beacon hashes every identifier per adapter on egress.
      return { ...base, customer: { email } };
    }
  }
}

export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    // The only hard error: we can't resolve a store from this Host.
    return NextResponse.json({ outcome: "error", message: "unknown store" }, { status: 404 });
  }
  // A non-live store has no funnel worth tracking — quiet no-op, not an error.
  if (resolution.manifest.store.status !== "live") return noop();

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const eventType = optString(body?.eventType);
  if (body === null || !isBeaconFunnelEventType(eventType)) return noop();

  // ── CONSENT RE-CHECK (server authority) ─────────────────────────────────
  // Identical gate to the checkout ORDER_CONFIRMED fire: enforced for this
  // region AND the visitor granted. No consent ⇒ nothing leaves.
  const behavior = resolveBehavior(resolution.manifest);
  const geo = resolveRequestGeo(request.headers);
  // Kill-switch tightening (wave 2): a store with browser tracking cannot
  // opt out of enforcement via `cookieConsent.enabled: false`.
  const enforced = cookieConsentEnforced(
    behavior.compliance.cookieConsent,
    geo,
    storeHasBrowserTracking(resolution.manifest, behavior),
  );
  const signal = parseConsentCookie(readCookie(request.headers, CONSENT_COOKIE));
  // Global Privacy Control (F1): `Sec-GPC: 1` is a stateless non-essential
  // opt-out that wins over any cookie — including a prior "granted" — and
  // applies even on stores that don't enforce the banner. It denies BOTH
  // consent categories.
  //
  // E5 granularity: the beacon dispatch (→ Meta CAPI / Klaviyo — the
  // advertising leg) and the visitor fingerprint gate on ADVERTISING; the
  // PostHog capture (measurement) gates on ANALYTICS. Neither ⇒ quiet 204.
  const gpc = gpcHeaderDenied(request.headers);
  const advertisingAllowed = !gpc && categoryAllowed(enforced, signal, "advertising");
  const analyticsAllowed = !gpc && categoryAllowed(enforced, signal, "analytics");
  if (!advertisingAllowed && !analyticsAllowed) {
    // Deliberate, logged suppression (never a silent drop) — mirrors checkout.
    logger.warn("beacon funnel event suppressed: no cookie consent", {
      tenantRef: resolution.tenantRef,
      eventType,
      ...(gpc ? { reason: "gpc" } : {}),
    });
    return noop();
  }

  const event = buildFunnelEvent(eventType, resolution.tenantRef, body);
  if (event === null) return noop();

  // ── VISITOR FINGERPRINT TOUCH (P7) ──────────────────────────────────────
  // Past the SAME consent gate as the beacon fire — a visitor is only ever
  // fingerprinted on the legal footing that lets us track them at all. The
  // CDP row is keyed by the first-party anon id; UA/IP are hashed
  // server-side. Fire-and-forget: a touch failure is logged in the gateway
  // and must never gate the funnel event or the response.
  const visitorRef = readCookie(request.headers, ANON_ID_COOKIE);
  if (visitorRef !== null && advertisingAllowed) {
    const forwardedFor = request.headers.get("x-forwarded-for");
    void getVisitorGateway().touch({
      tenantRef: resolution.tenantRef,
      visitorRef,
      userAgent: request.headers.get("user-agent"),
      clientIp: forwardedFor?.split(",")[0]?.trim() ?? null,
      language: request.headers.get("accept-language")?.split(",")[0]?.trim() ?? null,
    });
  }

  // PostHog (additional destination) shares this exact consent-passed path.
  // Fire-and-forget, no-op when unconfigured, throw-safe — never gates the
  // beacon dispatch below nor the response. distinct_id = the first-party anon
  // visitor id (the same subject the consent record binds to), falling back to
  // the per-fire event id when the cookie is somehow absent.
  if (analyticsAllowed) {
    capturePosthog({
      distinctId: readCookie(request.headers, ANON_ID_COOKIE) ?? event.eventId,
      tenantRef: resolution.tenantRef,
      event: eventType,
      properties: {
        ...("order" in event && event.order
          ? { value: event.order.value, currency: event.order.currency }
          : {}),
        ...("searchString" in event && event.searchString
          ? { search_string: event.searchString }
          : {}),
      },
    });
  }

  // The fire NEVER breaks the page — swallow both a dispatch error and a THROW
  // from getBeaconProducer() (it throws when misconfigured, e.g. no ingest
  // token). Logged, then a plain 204. E5: the beacon dispatch is the
  // advertising leg (CAPI/Klaviyo forwarding) — analytics-only consent
  // suppresses it while the PostHog capture above still ran.
  if (advertisingAllowed) {
    try {
      const dispatched = await getBeaconProducer().dispatchFunnel(event);
      if (dispatched.outcome === "error") {
        logger.error("beacon funnel dispatch failed", {
          tenantRef: resolution.tenantRef,
          eventType,
          message: dispatched.message,
        });
      }
    } catch (err) {
      logger.error("beacon funnel fire threw; ignoring (tracking is non-essential)", {
        tenantRef: resolution.tenantRef,
        eventType,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.warn("beacon funnel dispatch suppressed: no advertising consent", {
      tenantRef: resolution.tenantRef,
      eventType,
    });
  }
  return noop();
}
