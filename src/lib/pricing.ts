import {
  applySubscriptionDiscount,
  computeOrderTotals,
  type OrderPricingConfig,
  type OrderTotals,
} from "@dscodotco-shared/order-totals";
import type { ResolvedBehavior } from "@/lib/manifest";

/**
 * The ONE place the storefront turns a resolved store manifest's
 * `behavior.shipping` / `behavior.tax` into the checkout pricing config, so
 * the BFF forward, the fixture re-price, and the UI preview can never drift.
 *
 * SEAM 1 (tax-shipping BFF forwarding, LOO-3050): the commerce+checkout
 * backend already re-prices from a manifest pricing policy (shipping +
 * FAIL-CLOSED tax — see modules/commerce/src/domain/order-totals.ts), but a
 * live store still charged $0 tax / no shipping because the storefront BFF
 * never forwarded that policy. These helpers close that: the BFF resolves
 * the request-Host manifest's shipping/tax (server-trusted, ADR 0003) and
 * forwards it; the shopper sees the same computed shipping+tax+total before
 * paying. NONE of this is a price the client is trusted for — the server
 * always re-prices from commerce's own catalog; this is store POLICY.
 */

/** The shipping/tax policy fields (camelCase) as `computeOrderTotals` consumes them. */
export function resolvedPricingConfig(
  behavior: ResolvedBehavior,
  expedited: boolean,
): OrderPricingConfig {
  return {
    shipping: {
      mode: "flat",
      flatRateCents: behavior.shipping.flatRateCents,
      expeditedRateCents: behavior.shipping.expeditedRateCents,
      maxCents: behavior.shipping.maxCents,
      freeShippingThresholdCents: behavior.shipping.freeShippingThresholdCents,
    },
    tax: { provider: behavior.tax.provider, rateBps: behavior.tax.rateBps },
    expedited,
    // LOO-3156 promotions: the manifest's never-discount SKU list rides with
    // the pricing policy so the commerce money math excludes those lines
    // from any coupon's discountable base — enforced server-side, always.
    neverDiscountSkus: behavior.promotions.neverDiscountSkus,
  };
}

/**
 * Preview the authoritative order totals for the checkout order-summary,
 * reusing the SAME resolver the server re-prices with (never re-derived).
 * Returns a `Result`: an unsupported tax provider (`stripe_tax`) is an ERROR,
 * not a $0 tax — so the UI shows an honest "we can't total this" and blocks
 * pay, exactly as the server would 422. `coupon` is null here: the storefront
 * checkout BFF applies no coupon (the module owns any promo re-pricing).
 */
export function previewOrderTotals(
  lines: ReadonlyArray<{ unitPriceCents: number; quantity: number }>,
  config: OrderPricingConfig,
): ReturnType<typeof computeOrderTotals> {
  return computeOrderTotals(lines, null, config);
}

export type { OrderTotals };

/**
 * One offered subscribe-and-save cadence: an interval in days plus the
 * manifest-declared percent off (LOO-3154). The `behavior.subscriptions.
 * discounts` map IS the cadence catalog — the gate resolver below is the
 * ONE place it is turned into options, shared by the PDP badge, the
 * checkout selector, the BFF's server-side validation and the fixture
 * gateway, so client affordance and server enforcement can never drift.
 */
export interface SubscriptionCadence {
  readonly days: number;
  readonly percent: number;
}

/**
 * The store's offered cadences, or [] when subscribe-and-save is OFF for
 * this store (gate disabled, or an empty/garbage discounts map — "enabled
 * with no cadences" offers nothing, per the resolver's contract). 100%-off
 * cadences are dropped: a zero-price recurring commitment is refused by
 * the backend, so it must never be offered.
 */
export function subscriptionCadences(behavior: ResolvedBehavior): SubscriptionCadence[] {
  if (!behavior.subscriptions.enabled) return [];
  return Object.entries(behavior.subscriptions.discounts)
    .map(([days, percent]) => ({ days: Number(days), percent }))
    .filter(
      (c) =>
        Number.isInteger(c.days) &&
        c.days > 0 &&
        Number.isInteger(c.percent) &&
        c.percent >= 0 &&
        c.percent < 100,
    )
    .sort((a, b) => a.days - b.days);
}

/**
 * The subscribe-and-save unit price for one line — literally the backend's
 * own `applySubscriptionDiscount` (via the `@dscodotco-shared/order-totals`
 * alias, the same shared-resolver route `previewOrderTotals` uses), so the
 * previewed discount and the authoritative order total can never drift.
 */
export { applySubscriptionDiscount };
