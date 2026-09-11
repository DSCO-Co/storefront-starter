import type { OrderPricingConfig } from "@dscodotco-shared/order-totals";
import { createLogger } from "@/lib/logger";
import { previewOrderTotals } from "@/lib/pricing";

/**
 * Checkout gateway — the storefront's server-side call into `@dscodotco/checkout`
 * (ADR 0003: checkout is a PLATFORM-SERVED compliance boundary; a headless
 * store embeds it, never reimplements it — see docs/decisions/
 * 0003-storefront-rendering-strategy.md's "Preconditions for launching
 * headless"). This is why card fields are POSTed from the shopper's browser
 * to THIS surface's own Route Handler (`app/api/checkout/route.ts`), which
 * then calls `@dscodotco/checkout` server-side — never a client-side call
 * straight to the checkout module, and never a form action that could be
 * pointed at a merchant-controlled endpoint.
 *
 * Selection mirrors every other live/fixture seam in this surface
 * (manifest-source.ts, catalog-source.ts): `FLIGHTDECK_API_URL` set ->
 * `LiveCheckoutGateway`; unset (local dev / tests) -> `FixtureCheckoutGateway`.
 *
 * B7-4 FIXED-interim (docs/audits/batch7-review-2026-08-31.md, MED):
 * `LiveCheckoutGateway` used to authenticate with `FLIGHTDECK_OPERATOR_TOKEN`
 * — the SAME broad, platform-wide operator secret every other operator
 * route accepts (stores/commerce/payments/provisioning/merchant-api all
 * share ONE `OPERATOR_API_TOKEN`). That was real, disproportionate blast
 * radius for a public checkout form's server-side credential: a compromise
 * of this public Next process could reach every operator route on every
 * module (create/disable users, void invoices, redrive webhooks), not just
 * place orders.
 *
 * It now authenticates with `FLIGHTDECK_STOREFRONT_TOKEN` — a DISTINCT
 * credential, sent on its own `x-storefront-token` header (never
 * `x-operator-token`), which `@dscodotco/checkout` (`modules/checkout/src/
 * index.ts`) accepts ONLY on the bare checkout-placement route. It is
 * REJECTED on every operator-only route, including this same module's own
 * refund route — the storefront process holding this token can place a
 * checkout and nothing else.
 *
 * `@dscodotco/checkout` has no tenant-scoped `fdk_` auth yet (its own header
 * comment: "Not yet a full tenant-self-serve surface"), and the storefront
 * serves MANY tenants from one deployment (Host->tenant resolution), so a
 * single per-tenant `fdk_` credential doesn't fit this surface without
 * wiring FD-8's tenant-credential system into the checkout module first —
 * that remains the FOLLOW-UP, tracked in the audit's disposition: fold
 * this into a per-tenant `fdk_` credential (mirrors `@dscodotco/merchant-api`'s
 * auth) with a narrow `place:checkout` scope, so the storefront eventually
 * holds a credential scoped to "place orders for THIS tenant", not
 * "place orders for any tenant this deployment serves". Until then,
 * `STOREFRONT_API_TOKEN` is the real, shippable-in-one-pass improvement:
 * it shrinks the blast radius from "operate the whole platform" to
 * "place a checkout", which is the property that mattered most.
 */

const logger = createLogger("checkout");

export type CheckoutItem = { variantId: string; quantity: number };
export type CheckoutCard = { ccnumber: string; ccexp: string; cvv?: string };

/**
 * A ship-to address selected from the signed-in shopper's address book
 * (LOO-3137 saved-address picker). Display/record-only for now — see the
 * `shipping_address` note in the module POST below.
 */
export type CheckoutShippingAddress = {
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type CheckoutRequest = {
  tenantRef: string;
  customerRef: string;
  /**
   * The authenticated shopper (persons.person id) placing this order, when
   * the checkout came from a signed-in account (LOO-3041). Set ONLY from the
   * server-verified shopper session in the checkout BFF — never from client
   * input — so the order is attributed to the real account and shows up in
   * that shopper's order history. Null for a guest checkout.
   */
  personId?: string | null;
  /** Deterministic — derived from the cart's own persisted id, never randomUUID() per checkout attempt. */
  idempotencyKey: string;
  items: readonly CheckoutItem[];
  card: CheckoutCard;
  couponCode?: string | null;
  /**
   * The shopper's captured `?ref=` referral code (gap brief
   * docs/briefs/referral-capture-gap-2026-09-06.md). Read SERVER-SIDE by the
   * BFF from the httpOnly `fd_ref` cookie — never from the POST body — and
   * only when the store's `behavior.referrals.enabled` gate is on. Validated
   * downstream against real affiliate rows; an unknown code attributes
   * nothing and never fails the checkout.
   */
  referralCode?: string | null;
  /**
   * Apply the authed shopper's cash-backed store credit as PARTIAL tender
   * (LOO-3156). Only sent by the affordance when the manifest's
   * `storeCredit.enabled` gate is on AND a positive balance was actually
   * read — never speculatively. The checkout module re-reads the balance and
   * applies min(balance, remaining); this is a request, not an amount.
   */
  applyStoreCredit?: boolean;
  /**
   * Redeem a gift-card code as PARTIAL tender (FD Epic 19 / LOO-3156). Only
   * sent when the manifest's `giftCards.enabled` gate is on. The checkout
   * module validates and redeems it under a row lock.
   */
  giftCardCode?: string | null;
  /**
   * The cart's own client-computed total, in integer cents (+ currency).
   * `LiveCheckoutGateway` IGNORES this — the checkout module re-prices from
   * its own commerce catalog and that server total is the one returned.
   * `FixtureCheckoutGateway` has no priced catalog to re-derive a total
   * from, so it echoes this value back verbatim — fixture-mode orders are
   * never a source of pricing truth, only a UI-flow simulation.
   */
  cartTotalCents: number;
  cartCurrency: string;
  /**
   * The store's resolved fraud policy (FD Epic 10) — AVS/CVV modes + the
   * sliding-window velocity cap, from `resolveBehavior(...).fraud`. Forwarded
   * server-side so `@dscodotco/checkout` enforces the SAME policy the manifest
   * declares; never client-supplied. Omitted → the module's permissive
   * backend default (no AVS/CVV enforcement, velocity disabled).
   */
  fraud?: {
    avsPolicy: "off" | "warn" | "enforce";
    cvvPolicy: "off" | "warn" | "enforce";
    velocity: { maxPerWindow: number; windowMinutes: number };
  };
  /**
   * The shopper's client IP, for IP-scoped velocity + bans. Resolved
   * server-side from the request's forwarded-for chain — never from the POST
   * body — so a scripted request cannot spoof a fresh IP per attempt.
   */
  clientIp?: string | null;
  /**
   * SEAM 1 (LOO-3050): the store's manifest-resolved shipping + FAIL-CLOSED
   * tax policy, resolved SERVER-SIDE by the BFF from the request Host (never
   * client input — this is store policy, not a price). `LiveCheckoutGateway`
   * forwards it so the checkout module re-prices the authoritative total
   * INCLUDING shipping + tax; `FixtureCheckoutGateway` re-prices locally with
   * the SAME resolver. Absent → the legacy no-policy path (shipping/tax 0).
   */
  pricing?: OrderPricingConfig | null;
  /**
   * SEAM 2b (LOO-3137): the ship-to address the shopper picked from their
   * saved address book, when the store's `accounts.addressBook` gate is on.
   * Forwarded to the module for the order record. Optional — a guest, or a
   * shopper who picked nothing, omits it.
   */
  shippingAddress?: CheckoutShippingAddress | null;
  /**
   * FD Epic 7 — subscribe-and-save. When true, the checkout module ALSO starts
   * a subscription for every subscription-eligible line in the cart (vaulting
   * the card, first charge = this checkout's capture). Only sent by the form
   * when the cart has an eligible line and the shopper opted in; the module is
   * the authority on which lines are actually eligible.
   */
  subscribe?: boolean;
  /**
   * LOO-3154: the manifest gate's RESOLVED subscription policy (enabled +
   * the shopper's validated cadence and its declared discount), resolved
   * SERVER-SIDE by the BFF from the request-Host manifest — the same
   * transport as `fraud`/`pricing`, never client input. The checkout module
   * REFUSES `subscribe` without an enabled policy (fail-closed), so a
   * gated-off store can never have a subscription started against it.
   */
  subscription?: {
    enabled: boolean;
    intervalDays: number;
    discountPercent: number;
  } | null;
  /**
   * ARL consent evidence (C5, consumer-compliance remediation 2026-09-09) —
   * REQUIRED by the module whenever a checkout creates a subscription
   * (storefront-originated creation without it is rejected with a 400,
   * surfaced as an honest error, never silently retried). Built SERVER-SIDE
   * by the BFF: the sha-256 of the exact rendered disclosure text
   * (lib/arl-disclosure.tsx — one shared constant so rendered and hashed
   * copy cannot drift), the sha-256 of the client IP, and the request UA.
   * Forwarded to the module VERBATIM under the pinned `subscriptionConsent`
   * key (the contract the subscriptions backend is built to).
   */
  subscriptionConsent?: {
    disclosureRef: string;
    disclosureSha256: string;
    ipHash: string;
    userAgent: string;
  } | null;
};

/** The subscribe-and-save receipt the module returns for a placed order (FD Epic 7). */
export type CheckoutSubscriptionSummary = {
  readonly id: string;
  readonly planRef: string;
  readonly interval: string;
  readonly unitPriceCents: number;
  readonly nextBillAt: string;
};

export type CheckoutOutcome =
  | {
      readonly outcome: "placed";
      readonly orderId: string;
      readonly orderNumber: number;
      readonly totalCents: number;
      readonly currency: string;
      /** The tender split the module actually applied (LOO-3156), for the receipt. */
      readonly cardChargedCents: number;
      readonly storeCreditAppliedCents: number;
      readonly giftCardAppliedCents: number;
      /** FD Epic 7: the subscriptions started at checkout (empty when none). */
      readonly subscriptions: readonly CheckoutSubscriptionSummary[];
    }
  /** A definitive decline — the gateway said no. Safe to show a reason and let the shopper retry with a different card. */
  | { readonly outcome: "declined"; readonly message: string; readonly correlationId?: string }
  /**
   * The outcome is UNKNOWN (a transport/communication failure between
   * checkout and the payment gateway) — money may or may not have moved.
   * NEVER rendered as a decline, and the shopper is told NOT to resubmit;
   * see `@dscodotco/payments`' provider port docs for why this is a distinct
   * disposition from "declined". `correlationId` (the checkout module's
   * `x-request-id`, when the call reached it) matters MOST here — this is
   * exactly the outcome a shopper is told to contact support about.
   */
  | { readonly outcome: "indeterminate"; readonly message: string; readonly correlationId?: string }
  /** A platform-side fault unrelated to the card (bad request, order state conflict, 5xx). Never phrased as a card problem. */
  | { readonly outcome: "error"; readonly message: string; readonly correlationId?: string };

/**
 * Read-only coupon/pricing preview (money-honesty follow-up to LOO-3156):
 * lets the checkout UI show the SERVER-computed discount before pay — never
 * client math. Mirrors the placement request minus card/idempotency/tenders.
 */
export type CheckoutPreviewRequest = {
  tenantRef: string;
  /** Group pricing keys off this; "" (guest with no email yet) → list prices. */
  customerRef: string;
  items: readonly CheckoutItem[];
  couponCode: string | null;
  pricing?: OrderPricingConfig | null;
};

export type CheckoutPreviewOutcome =
  /** The authoritative totals placing this order right now would produce. */
  | {
      readonly outcome: "priced";
      readonly subtotalCents: number;
      readonly discountCents: number;
      readonly shippingCents: number;
      readonly taxCents: number;
      readonly totalCents: number;
      readonly currency: string;
      readonly couponCode: string | null;
    }
  /** The coupon would be REFUSED at placement — same code/reason, shown early. */
  | { readonly outcome: "invalid_coupon"; readonly code: string; readonly message: string }
  /**
   * The preview could not be computed (backend unreachable, fixture mode's
   * absent coupon catalog, …). HONEST UNKNOWN — never rendered as "$0
   * discount" or "invalid code"; the UI keeps its applied-at-payment copy.
   */
  | { readonly outcome: "unavailable"; readonly message: string };

export interface CheckoutGateway {
  submit(request: CheckoutRequest): Promise<CheckoutOutcome>;
  preview(request: CheckoutPreviewRequest): Promise<CheckoutPreviewOutcome>;
}

type CheckoutErrorBody = { error?: { code?: string; message?: string } };
type CheckoutOrderBody = {
  order?: { id?: string; order_number?: number; total_cents?: number; currency?: string };
  card_charged_cents?: number;
  store_credit_applied_cents?: number;
  gift_card_applied_cents?: number;
  subscriptions?: Array<{
    id?: string;
    plan_ref?: string;
    interval?: string;
    unit_price_cents?: number;
    next_bill_at?: string;
  }>;
};

/** Map the module's snake_case subscription receipt onto the surface shape. */
function parseSubscriptions(
  raw: CheckoutOrderBody["subscriptions"],
): CheckoutSubscriptionSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: CheckoutSubscriptionSummary[] = [];
  for (const s of raw) {
    if (
      typeof s?.id === "string" &&
      typeof s.plan_ref === "string" &&
      typeof s.interval === "string" &&
      typeof s.unit_price_cents === "number" &&
      typeof s.next_bill_at === "string"
    ) {
      out.push({
        id: s.id,
        planRef: s.plan_ref,
        interval: s.interval,
        unitPriceCents: s.unit_price_cents,
        nextBillAt: s.next_bill_at,
      });
    }
  }
  return out;
}

export class LiveCheckoutGateway implements CheckoutGateway {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly storefrontToken: string,
  ) {}

  async submit(request: CheckoutRequest): Promise<CheckoutOutcome> {
    let res: Response;
    try {
      res = await fetch(
        `${this.apiBaseUrl}/checkout/v1/tenants/${encodeURIComponent(request.tenantRef)}/checkout`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-storefront-token": this.storefrontToken,
            "idempotency-key": request.idempotencyKey,
          },
          body: JSON.stringify({
            customer_ref: request.customerRef,
            ...(request.personId ? { person_id: request.personId } : {}),
            coupon_code: request.couponCode ?? null,
            referral_code: request.referralCode ?? null,
            items: request.items.map((item) => ({
              variant_id: item.variantId,
              quantity: item.quantity,
            })),
            card: request.card,
            apply_store_credit: request.applyStoreCredit === true,
            gift_card_code: request.giftCardCode ?? null,
            // FD Epic 7: opt into starting a subscription for eligible lines.
            ...(request.subscribe ? { subscribe: true } : {}),
            ...(request.subscription
              ? {
                  subscription: {
                    enabled: request.subscription.enabled,
                    interval_days: request.subscription.intervalDays,
                    discount_percent: request.subscription.discountPercent,
                  },
                }
              : {}),
            // C5: ARL consent evidence rides with a subscription-creating
            // checkout — pinned camelCase contract, forwarded verbatim.
            ...(request.subscriptionConsent
              ? { subscriptionConsent: request.subscriptionConsent }
              : {}),
            ...(request.fraud ? { fraud: request.fraud } : {}),
            ...(request.clientIp ? { ip: request.clientIp } : {}),
            // SEAM 1: forward the manifest shipping/tax policy (snake_case,
            // top-level — the shape `parseOrderPricingConfig` validates). The
            // module re-prices the authoritative total from it and FAILS
            // CLOSED on `stripe_tax` (surfaced as a 422 → an honest error
            // below, never a silent $0-tax order). Omitted entirely when
            // there is no policy, preserving the legacy path.
            ...(request.pricing
              ? {
                  shipping: {
                    mode: request.pricing.shipping.mode,
                    flat_rate_cents: request.pricing.shipping.flatRateCents,
                    expedited_rate_cents: request.pricing.shipping.expeditedRateCents,
                    max_cents: request.pricing.shipping.maxCents,
                    free_shipping_threshold_cents:
                      request.pricing.shipping.freeShippingThresholdCents,
                  },
                  tax: {
                    provider: request.pricing.tax.provider,
                    rate_bps: request.pricing.tax.rateBps,
                  },
                  expedited: request.pricing.expedited,
                  // LOO-3156: the manifest's never-discount SKU list rides
                  // with the pricing policy — commerce excludes those lines
                  // from the coupon's discountable base server-side.
                  ...(request.pricing.neverDiscountSkus !== undefined &&
                  request.pricing.neverDiscountSkus.length > 0
                    ? {
                        promotions: {
                          never_discount_skus: request.pricing.neverDiscountSkus,
                        },
                      }
                    : {}),
                }
              : {}),
            // SEAM 2b: the picked saved ship-to address, when present.
            ...(request.shippingAddress
              ? {
                  shipping_address: {
                    label: request.shippingAddress.label,
                    line1: request.shippingAddress.line1,
                    line2: request.shippingAddress.line2 ?? null,
                    city: request.shippingAddress.city,
                    state: request.shippingAddress.state,
                    postal_code: request.shippingAddress.postalCode,
                    country: request.shippingAddress.country,
                  },
                }
              : {}),
          }),
          cache: "no-store",
        },
      );
    } catch (cause) {
      // A network failure talking to our OWN checkout module — this is
      // never a card decline, so it must never be rendered as one. No
      // response ever arrived, so there's no x-request-id to report.
      logger.error("checkout submit fetch failed", { tenantRef: request.tenantRef, cause });
      return { outcome: "error", message: "Could not reach checkout. Please try again." };
    }

    // The app's onError boundary assigns/echoes `x-request-id` on every
    // response — capture it so a declined/indeterminate/error outcome can
    // carry the same id a backend log line/Sentry event was tagged with.
    const correlationId = res.headers.get("x-request-id") ?? undefined;

    if (res.status === 201 || res.status === 200) {
      const body = (await res.json().catch(() => null)) as CheckoutOrderBody | null;
      const order = body?.order;
      if (
        order === undefined ||
        typeof order.id !== "string" ||
        typeof order.order_number !== "number" ||
        typeof order.total_cents !== "number" ||
        typeof order.currency !== "string"
      ) {
        logger.error("checkout placed response missing expected fields", {
          tenantRef: request.tenantRef,
          status: res.status,
        });
        return {
          outcome: "error",
          message: "Your order may have been placed, but we couldn't confirm it. Contact support.",
          correlationId,
        };
      }
      return {
        outcome: "placed",
        orderId: order.id,
        orderNumber: order.order_number,
        totalCents: order.total_cents,
        currency: order.currency,
        // Fall back to "all on the card" for an older module that predates
        // the tender split — never invent a store-credit/gift-card number.
        cardChargedCents:
          typeof body?.card_charged_cents === "number"
            ? body.card_charged_cents
            : order.total_cents,
        storeCreditAppliedCents:
          typeof body?.store_credit_applied_cents === "number"
            ? body.store_credit_applied_cents
            : 0,
        giftCardAppliedCents:
          typeof body?.gift_card_applied_cents === "number" ? body.gift_card_applied_cents : 0,
        subscriptions: parseSubscriptions(body?.subscriptions),
      };
    }

    const body = (await res.json().catch(() => null)) as CheckoutErrorBody | null;
    const message = body?.error?.message ?? `checkout failed with HTTP ${res.status}`;

    if (res.status === 402) {
      return { outcome: "declined", message, correlationId };
    }
    if (res.status === 502 || body?.error?.code === "payment_outcome_indeterminate") {
      return {
        outcome: "indeterminate",
        message: "We could not confirm whether your payment went through. Do not resubmit.",
        correlationId,
      };
    }
    logger.error("checkout submit returned a non-payment error", {
      tenantRef: request.tenantRef,
      status: res.status,
      code: body?.error?.code,
    });
    return { outcome: "error", message, correlationId };
  }

  /**
   * Read-only preview against the module's `/checkout/preview` route — the
   * same commerce coupon/pricing legs placement runs, no writes. Every
   * failure (transport, non-coupon error) is an HONEST "unavailable", never
   * an invalid-coupon claim the server didn't make.
   */
  async preview(request: CheckoutPreviewRequest): Promise<CheckoutPreviewOutcome> {
    let res: Response;
    try {
      res = await fetch(
        `${this.apiBaseUrl}/checkout/v1/tenants/${encodeURIComponent(request.tenantRef)}/checkout/preview`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-storefront-token": this.storefrontToken,
          },
          body: JSON.stringify({
            customer_ref: request.customerRef,
            coupon_code: request.couponCode,
            items: request.items.map((item) => ({
              variant_id: item.variantId,
              quantity: item.quantity,
            })),
            ...(request.pricing
              ? {
                  shipping: {
                    mode: request.pricing.shipping.mode,
                    flat_rate_cents: request.pricing.shipping.flatRateCents,
                    expedited_rate_cents: request.pricing.shipping.expeditedRateCents,
                    max_cents: request.pricing.shipping.maxCents,
                    free_shipping_threshold_cents:
                      request.pricing.shipping.freeShippingThresholdCents,
                  },
                  tax: {
                    provider: request.pricing.tax.provider,
                    rate_bps: request.pricing.tax.rateBps,
                  },
                  expedited: request.pricing.expedited,
                  ...(request.pricing.neverDiscountSkus !== undefined &&
                  request.pricing.neverDiscountSkus.length > 0
                    ? { promotions: { never_discount_skus: request.pricing.neverDiscountSkus } }
                    : {}),
                }
              : {}),
          }),
          cache: "no-store",
        },
      );
    } catch (cause) {
      logger.error("checkout preview fetch failed", { tenantRef: request.tenantRef, cause });
      return { outcome: "unavailable", message: "could not reach checkout" };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        subtotal_cents?: number;
        discount_cents?: number;
        shipping_cents?: number;
        tax_cents?: number;
        total_cents?: number;
        currency?: string;
        coupon_code?: string | null;
      } | null;
      if (
        body === null ||
        typeof body.subtotal_cents !== "number" ||
        typeof body.discount_cents !== "number" ||
        typeof body.shipping_cents !== "number" ||
        typeof body.tax_cents !== "number" ||
        typeof body.total_cents !== "number" ||
        typeof body.currency !== "string"
      ) {
        return { outcome: "unavailable", message: "preview response malformed" };
      }
      return {
        outcome: "priced",
        subtotalCents: body.subtotal_cents,
        discountCents: body.discount_cents,
        shippingCents: body.shipping_cents,
        taxCents: body.tax_cents,
        totalCents: body.total_cents,
        currency: body.currency,
        couponCode: typeof body.coupon_code === "string" ? body.coupon_code : null,
      };
    }
    const errorBody = (await res.json().catch(() => null)) as CheckoutErrorBody | null;
    const code = errorBody?.error?.code ?? "";
    if (code === "coupon_not_found" || code === "coupon_inactive" || code === "coupon_exhausted") {
      return {
        outcome: "invalid_coupon",
        code,
        message: errorBody?.error?.message ?? "this coupon cannot be applied",
      };
    }
    logger.error("checkout preview returned a non-coupon error", {
      tenantRef: request.tenantRef,
      status: res.status,
      code,
    });
    return { outcome: "unavailable", message: `preview failed with HTTP ${res.status}` };
  }
}

/**
 * Deterministic dev/test order number and id — a simple string hash, NOT
 * `Math.random()`/`randomUUID()` (repo-wide convention: idempotency-derived
 * identifiers stay deterministic). Same idempotencyKey -> same fake order,
 * every time, in-process.
 */
function deterministicOrderNumber(idempotencyKey: string): number {
  let hash = 0;
  for (let i = 0; i < idempotencyKey.length; i++) {
    hash = (hash * 31 + idempotencyKey.charCodeAt(i)) >>> 0;
  }
  return 1000 + (hash % 9000);
}

/**
 * Fixture checkout — no network, no backend required (`pnpm dev` / `pnpm
 * test` need no running flightdeck app, same promise every other fixture
 * source in this surface makes). Reuses `@dscodotco/payments`'
 * `FakePaymentProvider`'s EXACT magic-card convention (card number ending
 * "0002" -> declined, "0003" -> indeterminate) so the same test cards
 * exercise the same three outcomes whether the storefront is pointed at a
 * live app running `PAYMENTS_PROVIDER=fake` or at no backend at all.
 */
export class FixtureCheckoutGateway implements CheckoutGateway {
  // NOTE (LOO-3156): fixture mode has no coupon catalog, so `couponCode` is
  // accepted but applies NO discount — the echoed total is the undiscounted
  // cart total. Coupon validation/refusal paths are live-backend behavior
  // (see the commerce module's createOrder + api/checkout route tests).
  async submit(request: CheckoutRequest): Promise<CheckoutOutcome> {
    // SEAM 1: re-price with the SAME resolver the server uses so fixture-mode
    // orders honor the manifest's shipping + FAIL-CLOSED tax — the total the
    // shopper is charged INCLUDES them, and a `stripe_tax` store refuses
    // (honest error) rather than placing a silent $0-tax order. `cartTotalCents`
    // is the pre-shipping/tax subtotal (the client cart total); model it as a
    // single line so the resolver sums the right subtotal.
    let totalCents = request.cartTotalCents;
    if (request.pricing) {
      const priced = previewOrderTotals(
        [{ unitPriceCents: request.cartTotalCents, quantity: 1 }],
        request.pricing,
      );
      if (!priced.ok) {
        return {
          outcome: "error",
          message:
            "We couldn't calculate tax for this order, so it was not placed. Please contact support.",
        };
      }
      totalCents = priced.value.totalCents;
    }

    if (request.card.ccnumber.endsWith("0002")) {
      return { outcome: "declined", message: "fixture: card declined (magic ccnumber ...0002)" };
    }
    if (request.card.ccnumber.endsWith("0003")) {
      return {
        outcome: "indeterminate",
        message: "We could not confirm whether your payment went through. Do not resubmit.",
      };
    }
    return {
      outcome: "placed",
      orderId: `fixture-order-${deterministicOrderNumber(request.idempotencyKey)}`,
      orderNumber: deterministicOrderNumber(request.idempotencyKey),
      totalCents,
      currency: request.cartCurrency,
      // Fixture mode has no priced ledgers to draw a real tender from — the
      // whole total sits on the card. It never fabricates a store-credit or
      // gift-card amount (that would be a fake balance rendered as real).
      cardChargedCents: totalCents,
      storeCreditAppliedCents: 0,
      giftCardAppliedCents: 0,
      // FD Epic 7: fixture mode simulates the subscribe-and-save flow (no
      // backend) — when the shopper opted in it echoes ONE simulated
      // subscription so the confirmation UI renders, billed a month out at the
      // cart total. It is a UI-flow simulation, never a real vaulted schedule
      // (same contract as the fixture's order id/number).
      subscriptions:
        request.subscribe && request.subscription?.enabled === true
          ? [
              {
                id: `fixture-sub-${deterministicOrderNumber(request.idempotencyKey)}`,
                planRef: "fixture-plan",
                interval: `${request.subscription.intervalDays} days`,
                unitPriceCents: totalCents,
                nextBillAt: new Date(
                  Date.now() + request.subscription.intervalDays * 24 * 60 * 60 * 1000,
                ).toISOString(),
              },
            ]
          : [],
    };
  }

  /**
   * Fixture mode has NO coupon catalog, so a discount preview would be an
   * invented number — honestly "unavailable" (never "$0 off", never
   * "invalid code"). The coupon UI keeps its applied-at-payment copy, which
   * matches what fixture `submit` actually does (accepts the code, applies
   * no discount).
   */
  preview(_request: CheckoutPreviewRequest): Promise<CheckoutPreviewOutcome> {
    return Promise.resolve({
      outcome: "unavailable",
      message: "fixture mode has no coupon catalog to preview against",
    });
  }
}

let liveGateway: LiveCheckoutGateway | null = null;
let fixtureGateway: FixtureCheckoutGateway | null = null;

/**
 * The single place that decides which CheckoutGateway the storefront uses.
 * Unlike `getCatalogSource()`/`getManifestSource()`, live mode ALSO
 * requires `FLIGHTDECK_STOREFRONT_TOKEN` — fails loud (throws, naming the
 * variable) rather than silently falling back to fixture mode, which would
 * otherwise let a misconfigured production deploy quietly "place orders"
 * that never reach the real checkout module. B7-4: this is the narrow
 * `x-storefront-token` credential, NOT the platform-wide operator token —
 * see the module docblock above.
 */
export function getCheckoutGateway(): CheckoutGateway {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (!apiBaseUrl) {
    fixtureGateway ??= new FixtureCheckoutGateway();
    return fixtureGateway;
  }
  const storefrontToken = process.env.FLIGHTDECK_STOREFRONT_TOKEN;
  if (!storefrontToken) {
    throw new Error(
      "FLIGHTDECK_API_URL is set but FLIGHTDECK_STOREFRONT_TOKEN is not — refusing to run checkout without it rather than silently degrading to fixture mode",
    );
  }
  liveGateway ??= new LiveCheckoutGateway(apiBaseUrl.replace(/\/+$/, ""), storefrontToken);
  return liveGateway;
}
