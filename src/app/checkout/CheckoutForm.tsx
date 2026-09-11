"use client";

import type { OrderPricingConfig } from "@dscodotco-shared/order-totals";
import { useEffect, useRef, useState } from "react";
import { announce } from "@/components/live-announcer";
import type { Address } from "@/lib/account-client";
import { ArlDisclosure } from "@/lib/arl-disclosure";
import { type Cart, cartItemCount, cartTotalCents } from "@/lib/cart";
import { clearCartRef, getOrCreateCartRef, pingCartActivity } from "@/lib/cart-activity-client";
import type {
  CheckoutOutcome,
  CheckoutPreviewOutcome,
  CheckoutSubscriptionSummary,
} from "@/lib/checkout";
import { clearCouponCode, loadCouponCode, saveCouponCode } from "@/lib/coupon";
import { formatCents } from "@/lib/format";
import { forwardToPixels } from "@/lib/pixels";
import {
  applySubscriptionDiscount,
  previewOrderTotals,
  type SubscriptionCadence,
} from "@/lib/pricing";
import { RUO_ACK_STATEMENT } from "@/lib/ruo-ack";
import { clientConsentAllowsCategory, track } from "@/lib/track";
import { useCart } from "@/lib/use-cart";

/** Deterministic per-attempt idempotency key — never randomUUID(). A retry
 * after a decline mints a NEW attempt number (mirrors the parent's
 * fresh-session-on-declined-retry pattern); an indeterminate outcome does
 * NOT bump the attempt — the shopper must not be able to auto-resubmit. */
function idempotencyKeyFor(storeKey: string, cart: Cart, attempt: number): string {
  const linesPart = cart.lines
    .map((line) => `${line.variantId}:${line.quantity}:${line.unitPriceCents}`)
    .sort()
    .join("|");
  return `checkout:${storeKey}:${linesPart}:${attempt}`;
}

type Phase =
  | { step: "form"; error?: string; correlationId?: string }
  | { step: "submitting" }
  | { step: "declined"; message: string; correlationId?: string }
  | { step: "indeterminate"; message: string; correlationId?: string }
  | {
      step: "placed";
      orderNumber: number;
      totalCents: number;
      currency: string;
      cardChargedCents: number;
      storeCreditAppliedCents: number;
      giftCardAppliedCents: number;
      subscriptions: readonly CheckoutSubscriptionSummary[];
    };

export function CheckoutForm({
  storeKey,
  ageGate,
  storeCreditEnabled = false,
  giftCardsEnabled = false,
  pricing,
  addressBookEnabled = false,
  savedAddresses = null,
  subscriptionCadences = [],
  promotionsEnabled = false,
  neverDiscountSkus = [],
  shippingIntervals,
  shippingPolicyHref = null,
}: {
  storeKey: string;
  /** Non-null only for a store whose age gate is `checkbox` mode (gates checkout). */
  ageGate?: { minAge: number } | null;
  storeCreditEnabled?: boolean;
  giftCardsEnabled?: boolean;
  /**
   * SEAM 1: the store's manifest shipping + FAIL-CLOSED tax policy (standard
   * speed). The order summary re-prices with this using the SAME resolver the
   * server uses, so the shopper sees shipping + tax + total before paying.
   */
  pricing: OrderPricingConfig;
  /** SEAM 2b: the `accounts.addressBook` gate — offers the saved-address picker. */
  addressBookEnabled?: boolean;
  /**
   * The signed-in shopper's saved addresses, or null. null means "no picker"
   * (guest, gate off, or a read that FAILED) — never rendered as "no saved
   * addresses" (honest-absence).
   */
  savedAddresses?: readonly Address[] | null;
  /**
   * The store's offered subscribe-and-save cadences (LOO-3154), resolved
   * server-side from the manifest gate (`subscriptionCadences(behavior)`).
   * EMPTY = the store's gate is off (or offers no cadence): no S&S UI
   * renders and `subscribe` is never sent — the BFF and the checkout module
   * both re-enforce this server-side.
   */
  subscriptionCadences?: readonly SubscriptionCadence[];
  /** LOO-3156: `behavior.promotions.enabled` — gates the coupon input. */
  promotionsEnabled?: boolean;
  /**
   * LOO-3156: `behavior.promotions.neverDiscountSkus` — used only for the
   * visible exclusion note next to the coupon input; the server enforces the
   * exclusion in the money math regardless.
   */
  neverDiscountSkus?: readonly string[];
  /**
   * E1 (FTC Mail Order Rule): the delivery-interval labels shown with the
   * shipping options — store config when present, else the conservative
   * platform defaults resolved by the checkout page.
   */
  shippingIntervals?: { standard: string; expedited: string };
  /** `/policies/shipping` when the manifest verifiably carries that page, else null. */
  shippingPolicyHref?: string | null;
}) {
  const intervals = shippingIntervals ?? {
    standard: "Standard (5–10 business days)",
    expedited: "Expedited (2–4 business days)",
  };
  const { cart, hydrated, clear } = useCart(storeKey);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [attempt, setAttempt] = useState(1);
  const [email, setEmail] = useState("");
  const [ccnumber, setCcnumber] = useState("");
  const [ccexp, setCcexp] = useState("");
  const [cvv, setCvv] = useState("");
  const [ruoAck, setRuoAck] = useState(false);
  const [ageAck, setAgeAck] = useState(false);
  // SEAM 1: shipping-speed choice (standard vs expedited). Only surfaced when
  // the two manifest rates differ; forwarded so the server re-prices the
  // chosen rate.
  const [expedited, setExpedited] = useState(false);
  // SEAM 2b: the saved ship-to address the shopper picked (id), when the
  // address-book picker is offered. "" = none selected.
  const [selectedAddressId, setSelectedAddressId] = useState("");
  // LOO-3156 tender affordances.
  const [applyStoreCredit, setApplyStoreCredit] = useState(false);
  const [giftCardCode, setGiftCardCode] = useState("");
  // FD Epic 7 — subscribe-and-save opt-in + chosen cadence (LOO-3154).
  const [subscribe, setSubscribe] = useState(false);
  const [cadenceDays, setCadenceDays] = useState(() =>
    subscriptionCadences.length > 0 ? String(subscriptionCadences[0]?.days ?? "") : "",
  );
  // LOO-3156 coupon code — seeded from the cart page's stash after hydration
  // (localStorage is unavailable during the first render), editable here.
  const [couponCode, setCouponCode] = useState("");
  useEffect(() => {
    if (!promotionsEnabled) return;
    const stashed = loadCouponCode(storeKey);
    if (stashed.length > 0) setCouponCode(stashed);
  }, [promotionsEnabled, storeKey]);
  // Server-computed coupon preview (money-honesty: the discount shown is the
  // backend's own `previewOrder` math, never client arithmetic). null =
  // no code entered / preview still in flight — the UI keeps its
  // applied-at-payment copy rather than inventing a number.
  const [couponPreview, setCouponPreview] = useState<CheckoutPreviewOutcome | null>(null);
  useEffect(() => {
    const code = couponCode.trim();
    if (!promotionsEnabled || !hydrated || code.length === 0 || cart.lines.length === 0) {
      setCouponPreview(null);
      return;
    }
    // Debounced + last-write-wins: a stale response for a superseded code
    // must never be rendered as the current code's verdict.
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/checkout/preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              couponCode: code,
              expedited,
              items: cart.lines.map((line) => ({
                variantId: line.variantId,
                quantity: line.quantity,
              })),
            }),
          });
          const body = (await res.json().catch(() => null)) as CheckoutPreviewOutcome | null;
          if (!stale) setCouponPreview(body?.outcome !== undefined ? body : null);
        } catch {
          // Unknown, never a verdict — keep the applied-at-payment copy.
          if (!stale) setCouponPreview(null);
        }
      })();
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [promotionsEnabled, hydrated, couponCode, expedited, cart]);
  // `null` = not yet looked up / unavailable (honest: never shown as $0
  // credit). A positive number is a KNOWN balance and the ONLY case that
  // renders the store-credit checkbox.
  const [storeCreditBalanceCents, setStoreCreditBalanceCents] = useState<number | null>(null);

  // Screen-reader announcements (D6): checkout outcomes and coupon verdicts
  // are rendered visually below — mirror them into the layout's polite
  // aria-live region so assistive tech hears state changes too.
  useEffect(() => {
    if (phase.step === "declined") {
      announce(`Your card was declined. ${phase.message} You have not been charged.`);
    } else if (phase.step === "indeterminate") {
      announce(phase.message);
    } else if (phase.step === "form" && phase.error) {
      announce(phase.error);
    } else if (phase.step === "placed") {
      announce(`Order ${phase.orderNumber} confirmed. Thank you.`);
    }
  }, [phase]);
  useEffect(() => {
    if (couponPreview === null) return;
    if (couponPreview.outcome === "priced" && couponPreview.discountCents > 0) {
      announce(`Coupon applied — saves ${formatCents(couponPreview.discountCents)} on this order.`);
    } else if (couponPreview.outcome === "invalid_coupon") {
      announce(couponPreview.message);
    }
  }, [couponPreview]);

  // INITIATE_CHECKOUT funnel fire — once, when the hydrated cart has lines.
  // The cart is client-only (localStorage), so this is where the whole-cart
  // value + lines are known; consent-gated + forwarded via /api/track. Guarded
  // by a ref so a re-render never re-fires it.
  const initiateFired = useRef(false);
  useEffect(() => {
    if (initiateFired.current || !hydrated || cart.lines.length === 0) return;
    initiateFired.current = true;
    track({
      eventType: "INITIATE_CHECKOUT",
      totalCents: cartTotalCents(cart),
      items: cart.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
    });
    // Abandoned-cart signal on CHECKOUT START (FD Epic 16): a signed-in
    // shopper's email is attached server-side by the BFF; a guest hasn't
    // typed one yet (the email-blur ping below adds it).
    const cartRef = getOrCreateCartRef(storeKey);
    if (cartRef !== null) {
      pingCartActivity({ cartRef, itemCount: cartItemCount(cart) });
    }
  }, [hydrated, cart, storeKey]);

  if (!hydrated) return null;

  if (phase.step === "placed") {
    return (
      <div data-testid="checkout-confirmation">
        <p className="text-lg font-medium">Thank you — your order is confirmed.</p>
        <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>
          Order <span className="font-medium">#{phase.orderNumber}</span>
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>
          Order total: {formatCents(phase.totalCents)}
        </p>
        {phase.storeCreditAppliedCents > 0 ? (
          <p
            className="mt-1 text-sm"
            data-testid="checkout-store-credit-applied"
            style={{ color: "var(--color-muted)" }}
          >
            Store credit applied: −{formatCents(phase.storeCreditAppliedCents)}
          </p>
        ) : null}
        {phase.giftCardAppliedCents > 0 ? (
          <p
            className="mt-1 text-sm"
            data-testid="checkout-gift-card-applied"
            style={{ color: "var(--color-muted)" }}
          >
            Gift card applied: −{formatCents(phase.giftCardAppliedCents)}
          </p>
        ) : null}
        <p className="mt-1 text-sm font-medium">
          Charged to card: {formatCents(phase.cardChargedCents)}
        </p>
        {phase.subscriptions.length > 0 ? (
          <div
            className="mt-4 px-4 py-3 text-sm"
            data-testid="checkout-subscription-confirmation"
            style={{
              border: "1px solid var(--color-line, var(--color-border))",
              borderRadius: "var(--radius-card, 8px)",
            }}
          >
            <p className="font-medium">You&apos;re subscribed &amp; saving.</p>
            <ul className="mt-1" style={{ color: "var(--color-muted)" }}>
              {phase.subscriptions.map((sub) => (
                <li key={sub.id} data-testid="checkout-subscription-item">
                  {formatCents(sub.unitPriceCents)} every {sub.interval} — next charge{" "}
                  {new Date(sub.nextBillAt).toLocaleDateString()}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <a
          href="/products"
          className="mt-6 inline-block text-sm underline"
          style={{ color: "var(--color-primary)" }}
        >
          Continue shopping
        </a>
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div data-testid="checkout-empty">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Your cart is empty.
        </p>
        <a href="/products" className="mt-4 inline-block fd-btn fd-btn-primary fd-btn-sm">
          Shop products
        </a>
      </div>
    );
  }

  // SEAM 1: re-price the order summary with the SAME resolver the server uses
  // (never re-derived). `subtotalCents` is the cart's line total; the preview
  // adds the manifest's shipping + FAIL-CLOSED tax. A `stripe_tax` store makes
  // this an ERROR (`preview.ok === false`) — the summary shows an honest
  // "can't total this" and pay is BLOCKED, so a $0-tax order is never placed
  // (the server would 422 anyway; this refuses before we even ask).
  const subtotalCents = cartTotalCents(cart);
  // FD Epic 7 / LOO-3154: the affordance requires BOTH an eligible cart line
  // AND the store's manifest gate offering at least one cadence — a
  // gated-off store renders no S&S UI even for a stale cart whose lines
  // still carry the eligibility flag.
  const subscriptionEligible =
    subscriptionCadences.length > 0 &&
    cart.lines.some((line) => line.subscriptionEligible === true);
  const selectedCadence =
    subscriptionCadences.find((c) => String(c.days) === cadenceDays) ??
    subscriptionCadences[0] ??
    null;
  const subscribeActive = subscriptionEligible && subscribe && selectedCadence !== null;
  // Preview the SAME per-line cadence discount the server applies (shared
  // floor math via @dscodotco-shared/order-totals) so the shown total matches the
  // authoritative one.
  const preview = previewOrderTotals(
    cart.lines.map((line) => ({
      unitPriceCents:
        subscribeActive && selectedCadence !== null && line.subscriptionEligible === true
          ? applySubscriptionDiscount(line.unitPriceCents, selectedCadence.percent)
          : line.unitPriceCents,
      quantity: line.quantity,
    })),
    { ...pricing, expedited },
  );
  // Server-priced coupon override: when the backend previewed this cart WITH
  // the coupon (and no subscribe-and-save discount is in play — the preview
  // endpoint doesn't model S&S, so mixing the two would show mismatched
  // math), the summary and the Pay button show the SERVER's own totals —
  // subtotal, discount, shipping, tax computed by the same code that will
  // charge. Otherwise the client-side policy preview stands, exactly as
  // before.
  const serverPriced =
    couponPreview !== null && couponPreview.outcome === "priced" && !subscribeActive
      ? couponPreview
      : null;
  const displaySubtotalCents = serverPriced
    ? serverPriced.subtotalCents
    : preview.ok
      ? preview.value.subtotalCents
      : subtotalCents;
  const taxUnavailable = !preview.ok;
  const grandTotalCents = serverPriced
    ? serverPriced.totalCents
    : preview.ok
      ? preview.value.totalCents
      : subtotalCents;
  const shippingCents = serverPriced
    ? serverPriced.shippingCents
    : preview.ok
      ? preview.value.shippingCents
      : 0;
  const taxCents = serverPriced ? serverPriced.taxCents : preview.ok ? preview.value.taxCents : 0;
  const couponDiscountCents = serverPriced !== null ? serverPriced.discountCents : null;
  const showExpedited = pricing.shipping.expeditedRateCents !== pricing.shipping.flatRateCents;
  const pickableAddresses = addressBookEnabled ? (savedAddresses ?? []) : [];
  const selectedAddress = pickableAddresses.find((a) => a.id === selectedAddressId) ?? null;

  /**
   * Look up the shopper's store-credit balance for the affordance. Honest:
   * anything but a positive, KNOWN balance leaves the checkbox hidden and
   * the flag off — an unavailable read is NEVER treated as "$0 credit".
   */
  async function refreshStoreCredit(nextEmail: string) {
    if (!storeCreditEnabled || nextEmail.trim().length === 0) {
      setStoreCreditBalanceCents(null);
      setApplyStoreCredit(false);
      return;
    }
    try {
      const customerRef = `guest:${nextEmail.trim().toLowerCase()}`;
      const res = await fetch(
        `/api/store-credit/balance?customer_ref=${encodeURIComponent(customerRef)}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => null)) as {
        available?: boolean;
        balanceCents?: number;
      } | null;
      if (
        body?.available === true &&
        typeof body.balanceCents === "number" &&
        body.balanceCents > 0
      ) {
        setStoreCreditBalanceCents(body.balanceCents);
      } else {
        setStoreCreditBalanceCents(null);
        setApplyStoreCredit(false);
      }
    } catch {
      // Unknown, never zero: hide the affordance rather than claim no credit.
      setStoreCreditBalanceCents(null);
      setApplyStoreCredit(false);
    }
  }

  async function submit(nextAttempt: number) {
    setPhase({ step: "submitting" });
    setAttempt(nextAttempt);
    try {
      // Checkbox-mode age gate: record the server-side pass BEFORE placing
      // the order. The /api/checkout route also enforces the httpOnly pass
      // cookie (defense in depth) — this is what sets it.
      if (ageGate) {
        const ageRes = await fetch("/api/age-gate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        });
        if (!ageRes.ok) {
          setPhase({ step: "form", error: "Could not verify your age. Please try again." });
          return;
        }
      }
      // RUO acknowledgment: record the server-side affirmation BEFORE placing
      // the order. The checkbox below is required client-side (UX), but the
      // server is authoritative — `/api/ruo-ack` sets the httpOnly pass cookie
      // and `/api/checkout` refuses without it, so this is what a scripted POST
      // could never skip. (The order-bound audit row is persisted server-side.)
      const ruoRes = await fetch("/api/ruo-ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!ruoRes.ok) {
        setPhase({
          step: "form",
          error: "Could not record your research-use-only acknowledgment. Please try again.",
        });
        return;
      }
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerRef: `guest:${email.trim().toLowerCase()}`,
          idempotencyKey: idempotencyKeyFor(storeKey, cart, nextAttempt),
          items: cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
          card: { ccnumber: ccnumber.replace(/\s/g, ""), ccexp, ...(cvv ? { cvv } : {}) },
          // The cart SUBTOTAL (pre shipping/tax). The server re-prices the
          // authoritative total from its own catalog + the manifest policy it
          // resolves; this is never trusted as the final total.
          cartTotalCents: subtotalCents,
          cartCurrency: "usd",
          // SEAM 1: the shopper's shipping-speed choice (a selection, not a
          // price). The server resolves the actual rates from the manifest.
          expedited,
          // SEAM 2b: the picked saved ship-to address, when the picker offered
          // one and the shopper selected it. The BFF re-gates on the store's
          // address-book flag + a signed-in shopper before forwarding it.
          ...(selectedAddress
            ? {
                shippingAddress: {
                  label: selectedAddress.label,
                  line1: selectedAddress.line1,
                  line2: selectedAddress.line2,
                  city: selectedAddress.city,
                  state: selectedAddress.state,
                  postalCode: selectedAddress.postalCode,
                  country: selectedAddress.country,
                },
              }
            : {}),
          // Only ask to apply store credit when the affordance genuinely
          // showed a positive balance; only send a gift-card code when the
          // shopper typed one.
          applyStoreCredit: storeCreditEnabled && applyStoreCredit,
          giftCardCode:
            giftCardsEnabled && giftCardCode.trim().length > 0 ? giftCardCode.trim() : null,
          // LOO-3156: only sent when the store's promotions gate is on and the
          // shopper entered one. Validated + applied server-side; a refused
          // code surfaces the backend's reason verbatim.
          ...(promotionsEnabled && couponCode.trim().length > 0
            ? { couponCode: couponCode.trim() }
            : {}),
          // FD Epic 7: only opt in when the cart truly has an eligible line and
          // the shopper checked the box. The chosen cadence (days) rides
          // along; the BFF validates it against the manifest's declared
          // cadences server-side — never trusted as a price.
          subscribe: subscribeActive,
          ...(subscribeActive && selectedCadence !== null
            ? { subscriptionIntervalDays: selectedCadence.days }
            : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as CheckoutOutcome | null;
      if (!body) {
        setPhase({ step: "form", error: "Could not reach checkout. Please try again." });
        return;
      }
      if (body.outcome === "placed") {
        // Conversion ping (FD Epic 16): flips this cart out of the
        // abandoned-cart working set (sticky server-side), then retires the
        // cart ref so the next cart is a new cart. Fire-and-forget — a ping
        // hiccup never touches the confirmation.
        const cartRef = getOrCreateCartRef(storeKey);
        if (cartRef !== null) {
          pingCartActivity({ cartRef, itemCount: 0, email, checkedOut: true });
        }
        clearCartRef(storeKey);
        clearCouponCode(storeKey);
        // Browser-pixel Purchase leg (gap brief 2026-09-06): the SAME
        // deterministic event id the checkout BFF fires at beacon
        // (`order_<orderId>` — see api/checkout/route.ts's dispatch), so
        // Meta dedupes the browser/CAPI pair and GA4 dedupes on
        // transaction_id. Consent-gated with the same predicate as every
        // other fire; a store without pixels loaded is a no-op. E5: the
        // pixel leg is ADVERTISING — gated on that category specifically.
        if (clientConsentAllowsCategory("advertising")) {
          forwardToPixels("ORDER_CONFIRMED", `order_${body.orderId}`, {
            valueDollars: body.totalCents / 100,
            currency: body.currency,
            contentIds: cart.lines.map((line) => line.variantId),
            numItems: cartItemCount(cart),
          });
        }
        clear();
        setPhase({
          step: "placed",
          orderNumber: body.orderNumber,
          totalCents: body.totalCents,
          currency: body.currency,
          cardChargedCents: body.cardChargedCents,
          storeCreditAppliedCents: body.storeCreditAppliedCents,
          giftCardAppliedCents: body.giftCardAppliedCents,
          // Default to [] for an older module/response that predates the
          // subscribe-and-save receipt — never crash the confirmation.
          subscriptions: body.subscriptions ?? [],
        });
        return;
      }
      if (body.outcome === "declined") {
        setPhase({ step: "declined", message: body.message, correlationId: body.correlationId });
        return;
      }
      if (body.outcome === "indeterminate") {
        setPhase({
          step: "indeterminate",
          message: body.message,
          correlationId: body.correlationId,
        });
        return;
      }
      setPhase({ step: "form", error: body.message, correlationId: body.correlationId });
    } catch {
      setPhase({ step: "form", error: "Could not reach checkout. Please check your connection." });
    }
  }

  return (
    <div>
      {/* SEAM 1: order summary — subtotal + computed shipping + tax + total,
          shown BEFORE the shopper pays. A `stripe_tax` store cannot be totaled
          (fail-closed) → an honest message and pay is blocked below. */}
      <div
        className="flex max-w-md flex-col gap-1 text-sm"
        style={{ color: "var(--color-muted)" }}
        data-testid="checkout-summary"
      >
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span data-testid="checkout-subtotal">{formatCents(displaySubtotalCents)}</span>
        </div>
        {couponDiscountCents !== null && couponDiscountCents > 0 ? (
          <div className="flex justify-between" data-testid="checkout-coupon-discount">
            <span>Coupon {serverPriced?.couponCode ?? couponCode.trim()}</span>
            <span>−{formatCents(couponDiscountCents)}</span>
          </div>
        ) : null}
        {taxUnavailable ? (
          <p
            className="mt-1"
            data-testid="checkout-tax-unavailable"
            style={{ color: "var(--color-error, var(--color-primary))" }}
          >
            We can&apos;t calculate tax for this order right now, so it can&apos;t be placed. Please
            contact support.
          </p>
        ) : (
          <>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span data-testid="checkout-shipping">{formatCents(shippingCents)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span data-testid="checkout-tax">{formatCents(taxCents)}</span>
            </div>
            <div className="flex justify-between font-medium" style={{ color: "var(--color-fg)" }}>
              <span>Total</span>
              <span data-testid="checkout-order-total">{formatCents(grandTotalCents)}</span>
            </div>
          </>
        )}
      </div>

      {phase.step === "declined" ? (
        <div
          className="mt-4 px-4 py-3 text-sm"
          data-testid="checkout-declined"
          style={{
            border: "1px solid var(--color-error, var(--color-primary))",
            borderRadius: "var(--radius-card, 8px)",
          }}
        >
          Your card was declined. {phase.message} You have not been charged.
          <div className="mt-2">
            <button
              type="button"
              className="fd-btn fd-btn-secondary fd-btn-sm"
              data-testid="checkout-retry"
              onClick={() => void submit(attempt + 1)}
            >
              Try a different card
            </button>
          </div>
        </div>
      ) : null}

      {phase.step === "indeterminate" ? (
        <div
          className="mt-4 px-4 py-3 text-sm"
          data-testid="checkout-indeterminate"
          style={{
            border: "1px solid var(--color-line, var(--color-border))",
            borderRadius: "var(--radius-card, 8px)",
          }}
        >
          {phase.message} Please do not resubmit — if you were charged, you will receive a
          confirmation email. Contact support if this does not resolve shortly.
          {phase.correlationId ? (
            <span
              data-testid="checkout-correlation-id"
              className="mt-2 block"
              style={{ color: "var(--color-muted)" }}
            >
              Reference: {phase.correlationId}
            </span>
          ) : null}
        </div>
      ) : null}

      {phase.step === "form" && phase.error ? (
        <p
          className="mt-4 text-sm"
          data-testid="checkout-error"
          style={{ color: "var(--color-error, var(--color-primary))" }}
        >
          {phase.error}
          {phase.correlationId ? (
            <span
              data-testid="checkout-correlation-id"
              className="ml-2"
              style={{ color: "var(--color-muted)" }}
            >
              (Reference: {phase.correlationId})
            </span>
          ) : null}
        </p>
      ) : null}

      {phase.step !== "declined" && phase.step !== "indeterminate" ? (
        <form
          className="mt-6 flex max-w-md flex-col gap-4"
          data-testid="checkout-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(attempt);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={(event) => {
                void refreshStoreCredit(event.target.value);
                // Abandoned-cart signal with the now-KNOWN email (consent is
                // re-checked server-side) — an abandoned checkout with a
                // typed address becomes recoverable.
                if (event.target.value.trim().length > 0) {
                  const cartRef = getOrCreateCartRef(storeKey);
                  if (cartRef !== null) {
                    pingCartActivity({
                      cartRef,
                      itemCount: cartItemCount(cart),
                      email: event.target.value,
                    });
                  }
                }
              }}
              className="fd-input px-3 py-2 text-sm"
              data-testid="checkout-email"
            />
          </label>

          {/* SEAM 2b: saved-address picker — offered ONLY when the store's
              address-book gate is on AND the signed-in shopper has saved
              addresses. A guest, gate-off store, or FAILED read shows nothing
              here (honest-absence: never "no saved addresses"). Manage the
              book at /account/addresses. */}
          {pickableAddresses.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm" data-testid="checkout-saved-address">
              Ship to a saved address
              <select
                value={selectedAddressId}
                onChange={(event) => setSelectedAddressId(event.target.value)}
                className="fd-select px-3 py-2 text-sm"
                data-testid="checkout-saved-address-select"
              >
                <option value="">No saved address</option>
                {pickableAddresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label} — {address.line1}, {address.city} {address.state}{" "}
                    {address.postalCode}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* SEAM 1: shipping-speed selector — only when the two manifest rates
              differ. The summary above re-prices live on change. E1 (FTC Mail
              Order Rule): every shipping option names its delivery interval,
              and the store's shipping policy is linked when it exists. */}
          {showExpedited ? (
            <label className="flex flex-col gap-1 text-sm" data-testid="checkout-shipping-speed">
              Shipping speed
              <select
                value={expedited ? "expedited" : "standard"}
                onChange={(event) => setExpedited(event.target.value === "expedited")}
                className="fd-select px-3 py-2 text-sm"
                data-testid="checkout-shipping-speed-select"
              >
                <option value="standard">
                  {intervals.standard} — {formatCents(pricing.shipping.flatRateCents)}
                </option>
                <option value="expedited">
                  {intervals.expedited} — {formatCents(pricing.shipping.expeditedRateCents)}
                </option>
              </select>
            </label>
          ) : (
            <p
              className="text-sm"
              data-testid="checkout-shipping-interval"
              style={{ color: "var(--color-muted)" }}
            >
              Shipping: {intervals.standard} — {formatCents(pricing.shipping.flatRateCents)}
            </p>
          )}
          {shippingPolicyHref ? (
            <a
              href={shippingPolicyHref}
              className="text-xs underline underline-offset-4"
              data-testid="checkout-shipping-policy-link"
              style={{ color: "var(--color-muted)" }}
            >
              Shipping policy
            </a>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            Card number
            <input
              inputMode="numeric"
              required
              value={ccnumber}
              onChange={(event) => setCcnumber(event.target.value)}
              className="fd-input px-3 py-2 text-sm"
              data-testid="checkout-ccnumber"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Expiry (MMYY)
              <input
                inputMode="numeric"
                placeholder="0129"
                required
                value={ccexp}
                onChange={(event) => setCcexp(event.target.value)}
                className="fd-input px-3 py-2 text-sm"
                data-testid="checkout-ccexp"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              CVV
              <input
                inputMode="numeric"
                value={cvv}
                onChange={(event) => setCvv(event.target.value)}
                className="fd-input px-3 py-2 text-sm"
                data-testid="checkout-cvv"
              />
            </label>
          </div>
          {/* Store-credit affordance — LOO-3156. Rendered ONLY when the
              store gate is on AND a positive, known balance was read; a
              failed/unknown read leaves this hidden (never "$0 credit"). */}
          {storeCreditEnabled && storeCreditBalanceCents !== null && storeCreditBalanceCents > 0 ? (
            <label
              className="flex items-start gap-2 text-sm"
              data-testid="checkout-store-credit"
              style={{ color: "var(--color-muted)" }}
            >
              <input
                type="checkbox"
                checked={applyStoreCredit}
                onChange={(event) => setApplyStoreCredit(event.target.checked)}
                data-testid="checkout-store-credit-toggle"
                className="fd-checkbox mt-0.5"
              />
              Apply my store credit ({formatCents(storeCreditBalanceCents)} available)
            </label>
          ) : null}

          {/* Coupon affordance — LOO-3156. Rendered ONLY when the store's
              promotions gate is on. The code is validated and applied
              SERVER-SIDE at payment (an unknown/inactive/exhausted code
              refuses the order with the backend's reason, shown verbatim
              above); no client-side discount preview is shown because the
              coupon's terms are server knowledge. */}
          {promotionsEnabled ? (
            <label className="flex flex-col gap-1 text-sm" data-testid="checkout-coupon">
              Coupon code (optional)
              <input
                value={couponCode}
                onChange={(event) => {
                  setCouponCode(event.target.value);
                  saveCouponCode(storeKey, event.target.value);
                }}
                placeholder="SAVE10"
                className="fd-input px-3 py-2 text-sm"
                data-testid="checkout-coupon-code"
              />
              {/* Server-computed verdicts only (money-honesty): a priced
                  preview shows the backend's own discount; a refused code
                  shows the backend's reason. Anything unknown (preview in
                  flight / unavailable) keeps the applied-at-payment copy —
                  never a fabricated "$0 off" or "invalid". */}
              {couponCode.trim().length > 0 &&
              couponPreview?.outcome === "priced" &&
              couponPreview.discountCents > 0 ? (
                <span
                  className="text-xs"
                  data-testid="checkout-coupon-preview"
                  style={{ color: "var(--color-muted)" }}
                >
                  {couponPreview.couponCode ?? couponCode.trim()} saves you{" "}
                  {formatCents(couponPreview.discountCents)} on this order — applied when you pay.
                </span>
              ) : couponCode.trim().length > 0 && couponPreview?.outcome === "invalid_coupon" ? (
                <span
                  className="text-xs"
                  data-testid="checkout-coupon-invalid"
                  style={{ color: "var(--color-error, var(--color-primary))" }}
                >
                  {couponPreview.message} Remove or correct the code to place your order.
                </span>
              ) : couponCode.trim().length > 0 ? (
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Applied when you pay — the discount shows on your confirmation. Invalid or expired
                  codes are refused before any charge.
                </span>
              ) : null}
              {(() => {
                // Visible never-discount note: name the cart lines the store's
                // policy excludes from coupon discounts (server-enforced).
                const excluded = new Set(neverDiscountSkus);
                const excludedNames = cart.lines
                  .filter((line) => line.sku !== undefined && excluded.has(line.sku))
                  .map((line) => line.name);
                if (couponCode.trim().length === 0 || excludedNames.length === 0) return null;
                return (
                  <span
                    className="text-xs"
                    data-testid="checkout-coupon-excluded-note"
                    style={{ color: "var(--color-muted)" }}
                  >
                    Not eligible for coupon discounts: {excludedNames.join(", ")}.
                  </span>
                );
              })()}
            </label>
          ) : null}

          {/* Gift-card affordance — LOO-3156. Rendered when the store gate is
              on; the code is validated and redeemed server-side. */}
          {giftCardsEnabled ? (
            <label className="flex flex-col gap-1 text-sm" data-testid="checkout-gift-card">
              Gift card code (optional)
              <input
                value={giftCardCode}
                onChange={(event) => setGiftCardCode(event.target.value)}
                placeholder="GC-XXXX-XXXX-…"
                className="fd-input px-3 py-2 text-sm"
                data-testid="checkout-gift-card-code"
              />
            </label>
          ) : null}

          {/* FD Epic 7 — subscribe-and-save. Rendered ONLY when the cart has a
              subscription-eligible line (set from the catalog). The card is
              vaulted and future billing is set up server-side; the first charge
              is this order's capture. */}
          {subscriptionEligible ? (
            <div data-testid="checkout-subscribe" className="flex flex-col gap-1">
              {/* ARL / ROSCA / FTC Click-to-Cancel auto-renew disclosure (audit
                  F9): clear & conspicuous, rendered BEFORE/ABOVE the opt-in
                  control and ALWAYS visible while a subscription option
                  exists — never gated on the toggle being on. The exact
                  rendered text is the versioned constant the checkout BFF
                  hashes into the consent evidence (lib/arl-disclosure.tsx). */}
              <ArlDisclosure />
              <label
                className="flex items-start gap-2 text-sm"
                style={{ color: "var(--color-muted)" }}
              >
                <input
                  type="checkbox"
                  checked={subscribe}
                  onChange={(event) => setSubscribe(event.target.checked)}
                  data-testid="checkout-subscribe-toggle"
                  className="fd-checkbox mt-0.5"
                />
                Subscribe &amp; save — reorder automatically
                {selectedCadence !== null && selectedCadence.percent > 0
                  ? ` and save ${selectedCadence.percent}% on every refill.`
                  : " on every refill."}
              </label>
              {subscribe && subscriptionCadences.length > 0 ? (
                <label className="flex flex-col gap-1 pl-6 text-sm">
                  <span style={{ color: "var(--color-muted)" }}>Delivery cadence</span>
                  <select
                    value={cadenceDays}
                    onChange={(event) => setCadenceDays(event.target.value)}
                    data-testid="checkout-subscribe-cadence"
                    className="fd-select px-3 py-2 text-sm"
                  >
                    {subscriptionCadences.map((cadence) => (
                      <option key={cadence.days} value={String(cadence.days)}>
                        {cadence.percent > 0
                          ? `Every ${cadence.days} days — save ${cadence.percent}%`
                          : `Every ${cadence.days} days`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-xs" style={{ color: "var(--color-muted)" }}>
            <input
              type="checkbox"
              required
              checked={ruoAck}
              onChange={(event) => setRuoAck(event.target.checked)}
              data-testid="checkout-ruo-ack"
              className="fd-checkbox mt-0.5"
            />
            {RUO_ACK_STATEMENT}
          </label>
          {ageGate ? (
            <label
              className="flex items-start gap-2 text-xs"
              style={{ color: "var(--color-muted)" }}
            >
              <input
                type="checkbox"
                required
                checked={ageAck}
                onChange={(event) => setAgeAck(event.target.checked)}
                data-testid="checkout-age-ack"
                className="fd-checkbox mt-0.5"
              />
              I confirm that I am {ageGate.minAge} years of age or older.
            </label>
          ) : null}
          <button
            type="submit"
            className="fd-btn fd-btn-primary fd-btn-md"
            disabled={
              phase.step === "submitting" ||
              !ruoAck ||
              // SEAM 1: a store whose tax can't be computed (stripe_tax) can't
              // be checked out — never place a silent $0-tax order.
              taxUnavailable ||
              (ageGate !== null && ageGate !== undefined && !ageAck)
            }
            data-testid="checkout-submit"
          >
            {phase.step === "submitting"
              ? "Placing order…"
              : taxUnavailable
                ? "Unavailable"
                : `Pay ${formatCents(grandTotalCents)}`}
          </button>
        </form>
      ) : null}
    </div>
  );
}
