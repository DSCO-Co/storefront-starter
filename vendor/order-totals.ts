/**
 * Order money math — pure, integer cents throughout (FD money rule). No IO,
 * no ambient time/randomness. Ported (simplified) from the parent's
 * checkout/totals.ts + checkout/discounts/allocate.ts, now EXTENDED into a
 * full order-total resolver: line totals + one coupon, PLUS manifest-driven
 * shipping and FAIL-CLOSED tax.
 *
 * THE SPEC IS THE MANIFEST. `ShippingConfig` and `TaxConfig` below are the
 * verbatim shapes the resolved store manifest declares (see
 * surfaces/storefront/src/lib/manifest.ts's `ResolvedBehavior.shipping` /
 * `.tax`) — this module consumes exactly those, in integer cents / basis
 * points, and computes the authoritative server total. A client-supplied
 * total is never trusted; every caller re-prices through here.
 *
 * FAIL-CLOSED is the whole point of the tax leg (this file's reason to
 * exist): a store whose manifest declares a tax provider this port cannot
 * actually compute (`stripe_tax`) must make total computation return an
 * ERROR — so the order refuses rather than silently charging $0 tax. A
 * `provider: "null"` store gets an EXPLICIT zero (it declared no tax); an
 * absent/garbage provider is treated as unsupported, never as zero.
 */
import { fail, ok, type Result } from "@dscodotco/core";

export interface OrderLineInput {
  readonly unitPriceCents: number;
  readonly quantity: number;
  /**
   * The line's SKU, when the caller knows it. Consumed ONLY by the
   * never-discount exclusion (`OrderPricingConfig.neverDiscountSkus`): a line
   * whose sku is on that list contributes nothing to the coupon's
   * discountable base. Optional for back-compat — a caller that omits it
   * (legacy operator/test path, which also carries no manifest promotions
   * policy) prices exactly as before.
   */
  readonly sku?: string;
}

export interface PricedLine extends OrderLineInput {
  readonly lineTotalCents: number;
}

export interface CouponTerms {
  readonly kind: "percent" | "fixed";
  /** percent points (1..100) OR integer cents off the subtotal, per `kind`. */
  readonly value: number;
}

/**
 * Shipping policy — the resolved manifest's `behavior.shipping` shape
 * (integer cents). Only the fields the shopper-charge calculation needs are
 * modeled here; `labelPolicy` (the commerce-only carrier label-buying
 * policy) is deliberately absent — it never affects what the shopper is
 * charged for shipping.
 */
export interface ShippingConfig {
  readonly mode: "flat";
  readonly flatRateCents: number;
  readonly expeditedRateCents: number;
  /** Hard ceiling on the shipping charge — the selected rate is clamped to it. */
  readonly maxCents: number;
  /**
   * When non-null, an order whose discounted subtotal reaches this threshold
   * ships free. `null` means no free-shipping tier exists (the manifest's
   * own default) — NOT "free".
   */
  readonly freeShippingThresholdCents: number | null;
}

/**
 * Tax policy — the resolved manifest's `behavior.tax` shape. `provider`
 * decides the whole computation; `rateBps` is basis points (1% = 100 bps),
 * consumed only by `flat_rate`.
 */
export interface TaxConfig {
  readonly provider: "null" | "flat_rate" | "stripe_tax";
  readonly rateBps: number;
}

/**
 * The extra inputs that turn the back-compat `computeOrderTotals(items,
 * coupon)` into the full resolver. All-or-nothing: a caller either prices
 * with NO fulfillment policy (subtotal − discount only, shipping/tax 0 — the
 * legacy operator/test path) or supplies BOTH shipping and tax.
 */
export interface OrderPricingConfig {
  readonly shipping: ShippingConfig;
  readonly tax: TaxConfig;
  /** Shopper chose the expedited shipping speed. Defaults to false. */
  readonly expedited: boolean;
  /**
   * The manifest's `behavior.promotions.neverDiscountSkus` — SKUs a coupon
   * must NEVER discount (LOO-3156). Enforced server-side here: excluded
   * lines are removed from the coupon's discountable base, so a percent
   * coupon discounts only the eligible lines and a fixed coupon is capped
   * at the eligible subtotal. Absent/empty ⇒ every line is discountable.
   */
  readonly neverDiscountSkus?: readonly string[];
}

export interface OrderTotals {
  readonly lines: readonly PricedLine[];
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function isNonNegInt(v: unknown): v is number {
  return isInt(v) && v >= 0;
}

/**
 * Parse a request body's `{ shipping, tax, expedited }` block (snake_case,
 * as it arrives over HTTP) into a validated `OrderPricingConfig`, or a typed
 * failure. Pure — the ONE place the wire shape is validated, shared by every
 * route that prices an order so they can never drift.
 *
 *   - Neither `shipping` nor `tax` present  → ok(null): no fulfillment
 *     policy (the legacy operator/test path; shipping/tax persist as 0).
 *   - Both present and well-formed           → ok(config).
 *   - One present without the other, or any  → fail("invalid_pricing", …):
 *     malformed field                          all-or-nothing, fail-closed on
 *                                              a half-specified policy rather
 *                                              than defaulting the missing half.
 *
 * NOTE this validates the SHAPE only; `stripe_tax` is a WELL-FORMED provider
 * that parses fine here — it is `computeTaxCents` that fails it closed at
 * compute time. Shape-validity and provider-supportedness are deliberately
 * separate gates.
 */
export function parseOrderPricingConfig(raw: unknown): Result<OrderPricingConfig | null> {
  if (raw === null || typeof raw !== "object") return ok(null);
  const body = raw as Record<string, unknown>;
  const hasShipping = body.shipping !== undefined && body.shipping !== null;
  const hasTax = body.tax !== undefined && body.tax !== null;
  const hasPromotions = body.promotions !== undefined && body.promotions !== null;
  if (!hasShipping && !hasTax) {
    // A promotions block WITHOUT the pricing policy it rides on is refused,
    // not silently dropped — otherwise a caller could believe it enforced a
    // never-discount list that never reached the money math (fail-closed).
    if (hasPromotions) {
      return fail(
        "invalid_pricing",
        "promotions requires the shipping+tax pricing policy alongside it (a never-discount list must never be silently dropped)",
      );
    }
    return ok(null);
  }
  if (!hasShipping || !hasTax) {
    return fail(
      "invalid_pricing",
      "shipping and tax must be supplied together (a half-specified pricing policy is refused)",
    );
  }

  const s = body.shipping as Record<string, unknown>;
  if (s.mode !== "flat") {
    return fail("invalid_pricing", "shipping.mode must be 'flat'");
  }
  if (
    !isNonNegInt(s.flat_rate_cents) ||
    !isNonNegInt(s.expedited_rate_cents) ||
    !isNonNegInt(s.max_cents)
  ) {
    return fail(
      "invalid_pricing",
      "shipping.flat_rate_cents, expedited_rate_cents and max_cents must be non-negative integers",
    );
  }
  const threshold = s.free_shipping_threshold_cents;
  if (threshold !== null && threshold !== undefined && !isNonNegInt(threshold)) {
    return fail(
      "invalid_pricing",
      "shipping.free_shipping_threshold_cents must be a non-negative integer or null",
    );
  }

  const t = body.tax as Record<string, unknown>;
  if (t.provider !== "null" && t.provider !== "flat_rate" && t.provider !== "stripe_tax") {
    return fail("invalid_pricing", "tax.provider must be 'null', 'flat_rate' or 'stripe_tax'");
  }
  if (!isNonNegInt(t.rate_bps)) {
    return fail("invalid_pricing", "tax.rate_bps must be a non-negative integer");
  }

  // Optional promotions block: `{ never_discount_skus: string[] }`. Malformed
  // entries are refused (never coerced/dropped — a policy the caller declared
  // must reach the money math intact or not at all).
  let neverDiscountSkus: readonly string[] | undefined;
  if (hasPromotions) {
    const p = body.promotions as Record<string, unknown>;
    const raw = p.never_discount_skus;
    if (raw !== undefined && raw !== null) {
      if (!Array.isArray(raw) || raw.some((s) => typeof s !== "string")) {
        return fail(
          "invalid_pricing",
          "promotions.never_discount_skus must be an array of strings",
        );
      }
      neverDiscountSkus = raw as string[];
    }
  }

  return ok({
    shipping: {
      mode: "flat",
      flatRateCents: s.flat_rate_cents,
      expeditedRateCents: s.expedited_rate_cents,
      maxCents: s.max_cents,
      freeShippingThresholdCents: threshold === undefined ? null : (threshold as number | null),
    },
    tax: { provider: t.provider, rateBps: t.rate_bps },
    expedited: body.expedited === true,
    ...(neverDiscountSkus !== undefined ? { neverDiscountSkus } : {}),
  });
}

export function priceLine(line: OrderLineInput): PricedLine {
  return { ...line, lineTotalCents: line.unitPriceCents * line.quantity };
}

export function computeSubtotalCents(lines: readonly PricedLine[]): number {
  return lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
}

/**
 * Discount for one coupon against a subtotal. Always clamped to
 * [0, subtotalCents] — a coupon can never discount past zero or go
 * negative. `percent` floors (never rounds up past what was promised);
 * `fixed` is capped at the subtotal.
 */
/**
 * The coupon's discountable base: the summed line totals EXCLUDING lines
 * whose sku is on the never-discount list. A line with no sku is
 * discountable (only a caller that forwards a promotions policy also
 * forwards skus — see `OrderLineInput.sku`). Empty/absent list ⇒ the full
 * subtotal.
 */
export function computeDiscountableSubtotalCents(
  lines: readonly PricedLine[],
  neverDiscountSkus: readonly string[] | undefined,
): number {
  if (neverDiscountSkus === undefined || neverDiscountSkus.length === 0) {
    return computeSubtotalCents(lines);
  }
  const excluded = new Set(neverDiscountSkus);
  return lines.reduce(
    (sum, line) =>
      line.sku !== undefined && excluded.has(line.sku) ? sum : sum + line.lineTotalCents,
    0,
  );
}

export function computeDiscountCents(subtotalCents: number, coupon: CouponTerms | null): number {
  if (coupon === null) return 0;
  const raw =
    coupon.kind === "percent" ? Math.floor((subtotalCents * coupon.value) / 100) : coupon.value;
  return Math.max(0, Math.min(raw, subtotalCents));
}

/**
 * Shipping charge for a flat-mode store, in integer cents.
 *
 * ROUNDING / CLAMP ORDER (documented, deterministic):
 *   1. FREE-SHIPPING FIRST — if `freeShippingThresholdCents !== null` and the
 *      DISCOUNTED subtotal reaches it, the charge is 0 and nothing else runs.
 *      (Threshold is evaluated post-discount: the amount the shopper actually
 *      pays for goods is what earns free shipping.)
 *   2. RATE SELECTION — expedited ? `expeditedRateCents` : `flatRateCents`.
 *   3. CLAMP LAST — the selected rate is clamped to `[0, maxCents]`. Rates are
 *      already integer cents, so there is no rounding step; the clamp is the
 *      only adjustment, applied AFTER selection so `maxCents` caps expedited
 *      and standard alike.
 */
export function computeShippingCents(
  subtotalAfterDiscountCents: number,
  shipping: ShippingConfig,
  options: { readonly expedited: boolean },
): number {
  if (
    shipping.freeShippingThresholdCents !== null &&
    subtotalAfterDiscountCents >= shipping.freeShippingThresholdCents
  ) {
    return 0;
  }
  const selected = options.expedited ? shipping.expeditedRateCents : shipping.flatRateCents;
  return Math.max(0, Math.min(selected, shipping.maxCents));
}

/**
 * Tax charge for a taxable base, in integer cents — FAIL-CLOSED.
 *
 *   - `flat_rate`  → floor(base * rateBps / 10000). Floors so we never
 *     over-collect a fractional cent the store never declared.
 *   - `null`       → an EXPLICIT ok(0): the store DECLARED "no tax provider".
 *     This is the ONLY zero this function ever returns, and only because the
 *     manifest asked for it — never a laundered "we couldn't figure it out".
 *   - `stripe_tax` → this port has NO Stripe Tax integration. Returns a typed
 *     error, NEVER a silent 0, so the order refuses rather than under-charges.
 *   - anything else → same fail-closed error (an unknown provider is unknown
 *     tax, not zero tax).
 *
 * The taxable base is the caller's choice; every caller here passes
 * (subtotal − discount) and does NOT include shipping (see
 * `computeOrderTotals`) — shipping is not taxed in this port. If a future
 * jurisdiction requires taxing shipping, pass a base that includes it; the
 * function itself is base-agnostic.
 */
export function computeTaxCents(taxableBaseCents: number, tax: TaxConfig): Result<number> {
  switch (tax.provider) {
    case "flat_rate":
      return ok(Math.floor((taxableBaseCents * tax.rateBps) / 10000));
    case "null":
      return ok(0);
    case "stripe_tax":
      return fail(
        "tax_provider_unsupported",
        "tax provider 'stripe_tax' has no integration in this port — refusing to compute $0 tax (fail-closed)",
      );
    default:
      return fail(
        "tax_provider_unsupported",
        `unknown tax provider '${String(tax.provider)}' — refusing to under-charge tax (fail-closed)`,
      );
  }
}

/**
 * Back-compat form: line totals + one coupon, NO shipping/tax. Shipping and
 * tax are an explicit 0 (this is the operator/test path where no store
 * fulfillment policy is in play). Never fails.
 */
export function computeOrderTotals(
  items: readonly OrderLineInput[],
  coupon: CouponTerms | null,
): OrderTotals;
/**
 * Full resolver: line totals + coupon + manifest-driven shipping + tax.
 * Returns a `Result` because the tax leg is FAIL-CLOSED — an unsupported tax
 * provider makes the whole total un-computable, which is exactly what forces
 * checkout to refuse instead of charging $0 tax.
 *
 * total = subtotal − discount + shipping + tax.
 * taxable base = subtotal − discount (shipping is NOT taxed — see
 * `computeTaxCents`).
 */
export function computeOrderTotals(
  items: readonly OrderLineInput[],
  coupon: CouponTerms | null,
  pricing: OrderPricingConfig,
): Result<OrderTotals>;
export function computeOrderTotals(
  items: readonly OrderLineInput[],
  coupon: CouponTerms | null,
  pricing?: OrderPricingConfig,
): OrderTotals | Result<OrderTotals> {
  const lines = items.map(priceLine);
  const subtotalCents = computeSubtotalCents(lines);
  // Never-discount enforcement (LOO-3156): the coupon runs against the
  // DISCOUNTABLE base only (lines not on the manifest's never-discount list),
  // so an excluded sku's line total can never be touched by a coupon —
  // percent or fixed. Without a pricing policy (2-arg legacy path) there is
  // no exclusion list and the base is the full subtotal, exactly as before.
  const discountableCents = computeDiscountableSubtotalCents(lines, pricing?.neverDiscountSkus);
  const discountCents = computeDiscountCents(discountableCents, coupon);
  const afterDiscountCents = subtotalCents - discountCents;

  if (pricing === undefined) {
    return {
      lines,
      subtotalCents,
      discountCents,
      shippingCents: 0,
      taxCents: 0,
      totalCents: afterDiscountCents,
    };
  }

  const shippingCents = computeShippingCents(afterDiscountCents, pricing.shipping, {
    expedited: pricing.expedited,
  });
  // Taxable base excludes shipping (documented default: shipping is not
  // taxed in this port).
  const taxResult = computeTaxCents(afterDiscountCents, pricing.tax);
  if (!taxResult.ok) return taxResult;
  const taxCents = taxResult.value;

  return ok({
    lines,
    subtotalCents,
    discountCents,
    shippingCents,
    taxCents,
    totalCents: afterDiscountCents + shippingCents + taxCents,
  });
}

/**
 * Subscribe-and-save percent validation: integer percent points, 0..100.
 * (100 is legal — a store may comp the first cycle — but never beyond; a
 * discount can no more go negative than a coupon can.)
 */
export function isValidDiscountPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * A subscription-cadence discount applied to ONE unit price, integer cents.
 * FLOORS (never rounds up past what the manifest promised), mirroring
 * `computeDiscountCents`'s percent semantics, and never goes below zero.
 */
export function applySubscriptionDiscount(unitPriceCents: number, percentOff: number): number {
  const discounted = Math.floor((unitPriceCents * (100 - percentOff)) / 100);
  return Math.max(0, discounted);
}
