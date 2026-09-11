import type { OrderPricingConfig } from "@dscodotco-shared/order-totals";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "@/lib/account-client";
import { addLine, EMPTY_CART, saveCart } from "@/lib/cart";
import { CheckoutForm } from "./CheckoutForm";

const STORE_KEY = "store-a";

// Default manifest pricing for tests: standard=expedited flat $8.95, no tax
// provider (explicit $0 tax). Individual tests override to exercise shipping
// and FAIL-CLOSED tax.
const DEFAULT_PRICING: OrderPricingConfig = {
  shipping: {
    mode: "flat",
    flatRateCents: 895,
    expeditedRateCents: 895,
    maxCents: 10000,
    freeShippingThresholdCents: null,
  },
  tax: { provider: "null", rateBps: 0 },
  expedited: false,
};

function seedCart() {
  saveCart(
    STORE_KEY,
    addLine(EMPTY_CART, {
      slug: "bpc-157",
      name: "BPC-157",
      variantLabel: "10mg",
      variantId: "var-1",
      unitPriceCents: 4500,
      quantity: 2,
    }),
  );
}

async function fillAndSubmit(ccnumber: string) {
  fireEvent.change(screen.getByTestId("checkout-email"), {
    target: { value: "shopper@example.com" },
  });
  fireEvent.change(screen.getByTestId("checkout-ccnumber"), { target: { value: ccnumber } });
  fireEvent.change(screen.getByTestId("checkout-ccexp"), { target: { value: "1230" } });
  fireEvent.click(screen.getByTestId("checkout-ruo-ack"));
  fireEvent.click(screen.getByTestId("checkout-submit"));
}

describe("CheckoutForm", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedCart();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows the empty-cart state when there is nothing to check out", async () => {
    window.localStorage.clear();
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    expect(await screen.findByTestId("checkout-empty")).toBeInTheDocument();
  });

  it("disables submit until the RUO acknowledgment is checked", async () => {
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    expect(screen.getByTestId("checkout-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("checkout-ruo-ack"));
    expect(screen.getByTestId("checkout-submit")).not.toBeDisabled();
  });

  it("renders the confirmed order on a 'placed' outcome and clears the cart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              outcome: "placed",
              orderId: "o-1",
              orderNumber: 1042,
              totalCents: 9000,
              currency: "usd",
              cardChargedCents: 9000,
              storeCreditAppliedCents: 0,
              giftCardAppliedCents: 0,
            }),
            { status: 200 },
          ),
      ),
    );
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    await fillAndSubmit("4111111111111111");

    await waitFor(() => expect(screen.getByTestId("checkout-confirmation")).toBeInTheDocument());
    expect(screen.getByText(/#1042/)).toBeInTheDocument();
    expect(window.localStorage.getItem("fd_cart:store-a")).toBeNull();
  });

  it("offers subscribe-and-save for an eligible line, forwards `subscribe`, and confirms the subscription", async () => {
    // A subscription-eligible cart line (set from the catalog).
    window.localStorage.clear();
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
        subscriptionEligible: true,
      }),
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            outcome: "placed",
            orderId: "o-sub",
            orderNumber: 2001,
            totalCents: 4500,
            currency: "usd",
            cardChargedCents: 4500,
            storeCreditAppliedCents: 0,
            giftCardAppliedCents: 0,
            subscriptions: [
              {
                id: "sub-1",
                planRef: "prod-1",
                interval: "month",
                unitPriceCents: 4000,
                nextBillAt: "2026-04-15T12:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        subscriptionCadences={[
          { days: 30, percent: 10 },
          { days: 60, percent: 15 },
        ]}
      />,
    );
    await screen.findByTestId("checkout-form");

    // The affordance is offered; opt-in and the chosen cadence are forwarded.
    fireEvent.click(screen.getByTestId("checkout-subscribe-toggle"));
    fireEvent.change(screen.getByTestId("checkout-subscribe-cadence"), {
      target: { value: "60" },
    });
    await fillAndSubmit("4111111111111111");

    await waitFor(() =>
      expect(screen.getByTestId("checkout-subscription-confirmation")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("checkout-subscription-item")).toBeInTheDocument();

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const checkoutCall = calls.find(([url]) => url === "/api/checkout");
    if (!checkoutCall) throw new Error("expected a POST to /api/checkout");
    const sentBody = JSON.parse(checkoutCall[1].body as string);
    expect(sentBody.subscribe).toBe(true);
    expect(sentBody.subscriptionIntervalDays).toBe(60);
  });

  it("hides subscribe-and-save entirely when the store gate offers no cadences (LOO-3154)", async () => {
    // Same eligible cart line as above — but the store's
    // behavior.subscriptions gate is off (no cadences prop), so no S&S UI
    // renders even though the line is catalog-eligible.
    window.localStorage.clear();
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
        subscriptionEligible: true,
      }),
    );
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    expect(screen.queryByTestId("checkout-subscribe")).toBeNull();
  });

  it("previews the cadence discount on eligible lines with the server's own floor math", async () => {
    window.localStorage.clear();
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
        subscriptionEligible: true,
      }),
    );
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        subscriptionCadences={[{ days: 30, percent: 10 }]}
      />,
    );
    await screen.findByTestId("checkout-form");
    // Before opting in: full price.
    expect(screen.getByTestId("checkout-subtotal").textContent).toContain("45.00");
    fireEvent.click(screen.getByTestId("checkout-subscribe-toggle"));
    // After opting in: floor(4500 * 90 / 100) = 4050.
    expect(screen.getByTestId("checkout-subtotal").textContent).toContain("40.50");
  });

  it("does NOT offer subscribe-and-save when no cart line is subscription-eligible", async () => {
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    expect(screen.queryByTestId("checkout-subscribe")).toBeNull();
  });

  // ── ARL disclosure ordering (audit F9, 2026-09-09 wave 2) ───────────────

  it("shows the auto-renew disclosure ABOVE the opt-in, ALWAYS — not gated on the toggle", async () => {
    window.localStorage.clear();
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
        subscriptionEligible: true,
      }),
    );
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        subscriptionCadences={[{ days: 30, percent: 10 }]}
      />,
    );
    await screen.findByTestId("checkout-form");
    // Visible BEFORE any interaction with the (unchecked) opt-in toggle.
    const disclosure = screen.getByTestId("checkout-autorenew-disclosure");
    expect(disclosure).toBeInTheDocument();
    const toggle = screen.getByTestId<HTMLInputElement>("checkout-subscribe-toggle");
    expect(toggle.checked).toBe(false);
    // Ordering: the disclosure precedes the opt-in control in the DOM.
    expect(
      disclosure.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // ── shipping intervals + policy link (E1, 2026-09-09 wave 2) ────────────

  it("labels both shipping options with their delivery interval (conservative defaults)", async () => {
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={{
          ...DEFAULT_PRICING,
          shipping: { ...DEFAULT_PRICING.shipping, expeditedRateCents: 1495 },
        }}
      />,
    );
    await screen.findByTestId("checkout-form");
    const select = screen.getByTestId("checkout-shipping-speed-select");
    expect(select.textContent).toContain("Standard (5–10 business days)");
    expect(select.textContent).toContain("Expedited (2–4 business days)");
  });

  it("shows the standard interval + honors store-configured labels when rates don't differ", async () => {
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        shippingIntervals={{
          standard: "Ground (4–8 business days)",
          expedited: "Express (1–2 business days)",
        }}
      />,
    );
    await screen.findByTestId("checkout-form");
    expect(screen.getByTestId("checkout-shipping-interval").textContent).toContain(
      "Ground (4–8 business days)",
    );
  });

  it("links the shipping policy at checkout when the manifest carries one — and not otherwise", async () => {
    const { unmount } = render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        shippingPolicyHref="/policies/shipping"
      />,
    );
    await screen.findByTestId("checkout-form");
    expect(screen.getByTestId("checkout-shipping-policy-link")).toHaveAttribute(
      "href",
      "/policies/shipping",
    );
    unmount();

    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    expect(screen.queryByTestId("checkout-shipping-policy-link")).toBeNull();
  });

  it("shows a distinct declined state (never charged) with a retry action, on a 'declined' outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ outcome: "declined", message: "do_not_honor" }), {
            status: 200,
          }),
      ),
    );
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    await fillAndSubmit("4111111111110002");

    await waitFor(() => expect(screen.getByTestId("checkout-declined")).toBeInTheDocument());
    expect(screen.getByText(/not been charged/)).toBeInTheDocument();
    expect(screen.getByTestId("checkout-retry")).toBeInTheDocument();
  });

  it("shows a distinct indeterminate state that tells the shopper NOT to resubmit — no retry button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              outcome: "indeterminate",
              message: "We could not confirm whether your payment went through.",
            }),
            { status: 200 },
          ),
      ),
    );
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    await fillAndSubmit("4111111111110003");

    await waitFor(() => expect(screen.getByTestId("checkout-indeterminate")).toBeInTheDocument());
    expect(screen.getByText(/do not resubmit/i)).toBeInTheDocument();
    expect(screen.queryByTestId("checkout-retry")).not.toBeInTheDocument();
    // The form is not re-shown for an indeterminate outcome — resubmitting
    // an unknown-outcome charge must be a deliberate, separate action.
    expect(screen.queryByTestId("checkout-submit")).not.toBeInTheDocument();
  });

  it("a platform error (never a card message) leaves the form resubmittable with an error banner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ outcome: "error", message: "order_not_payable" }), {
            status: 200,
          }),
      ),
    );
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    await fillAndSubmit("4111111111111111");

    await waitFor(() => expect(screen.getByTestId("checkout-error")).toBeInTheDocument());
    expect(screen.getByTestId("checkout-form")).toBeInTheDocument();
  });

  // ── SEAM 1: shipping + tax in the order summary, before paying ─────────────

  it("shows the computed shipping and tax in the order summary and a total that includes them", async () => {
    // subtotal = 2 × $45.00 = $90.00; shipping $8.95; tax 8.25% of $90.00 =
    // floor(9000 × 825 / 10000) = 742 = $7.42; total = $106.37.
    const pricing: OrderPricingConfig = {
      ...DEFAULT_PRICING,
      tax: { provider: "flat_rate", rateBps: 825 },
    };
    render(<CheckoutForm storeKey={STORE_KEY} pricing={pricing} />);
    await screen.findByTestId("checkout-form");

    expect(screen.getByTestId("checkout-subtotal")).toHaveTextContent("$90.00");
    expect(screen.getByTestId("checkout-shipping")).toHaveTextContent("$8.95");
    expect(screen.getByTestId("checkout-tax")).toHaveTextContent("$7.42");
    expect(screen.getByTestId("checkout-order-total")).toHaveTextContent("$106.37");
    expect(screen.getByTestId("checkout-submit")).toHaveTextContent("$106.37");
  });

  it("re-prices the summary when the shopper picks expedited shipping", async () => {
    const pricing: OrderPricingConfig = {
      ...DEFAULT_PRICING,
      shipping: { ...DEFAULT_PRICING.shipping, flatRateCents: 895, expeditedRateCents: 1995 },
    };
    render(<CheckoutForm storeKey={STORE_KEY} pricing={pricing} />);
    await screen.findByTestId("checkout-form");
    expect(screen.getByTestId("checkout-shipping")).toHaveTextContent("$8.95");

    fireEvent.change(screen.getByTestId("checkout-shipping-speed-select"), {
      target: { value: "expedited" },
    });
    expect(screen.getByTestId("checkout-shipping")).toHaveTextContent("$19.95");
    // total = 9000 + 1995 = $109.95
    expect(screen.getByTestId("checkout-order-total")).toHaveTextContent("$109.95");
  });

  it("renders every visible form control through the themed fd-* recipe (no default UA boxes)", async () => {
    const pricing: OrderPricingConfig = {
      ...DEFAULT_PRICING,
      shipping: { ...DEFAULT_PRICING.shipping, flatRateCents: 895, expeditedRateCents: 1995 },
    };
    render(<CheckoutForm storeKey={STORE_KEY} pricing={pricing} promotionsEnabled />);
    await screen.findByTestId("checkout-form");

    expect(screen.getByTestId("checkout-email")).toHaveClass("fd-input");
    expect(screen.getByTestId("checkout-ccnumber")).toHaveClass("fd-input");
    expect(screen.getByTestId("checkout-ccexp")).toHaveClass("fd-input");
    expect(screen.getByTestId("checkout-cvv")).toHaveClass("fd-input");
    expect(screen.getByTestId("checkout-coupon-code")).toHaveClass("fd-input");
    expect(screen.getByTestId("checkout-shipping-speed-select")).toHaveClass("fd-select");
    expect(screen.getByTestId("checkout-ruo-ack")).toHaveClass("fd-checkbox");
  });

  it("FAILS CLOSED on a stripe_tax store: honest error, submit blocked — never a $0-tax order", async () => {
    const submit = vi.fn();
    vi.stubGlobal("fetch", submit);
    const pricing: OrderPricingConfig = {
      ...DEFAULT_PRICING,
      tax: { provider: "stripe_tax", rateBps: 0 },
    };
    render(<CheckoutForm storeKey={STORE_KEY} pricing={pricing} />);
    await screen.findByTestId("checkout-form");

    expect(screen.getByTestId("checkout-tax-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("checkout-order-total")).not.toBeInTheDocument();
    // Blocked even after the RUO ack — an uncomputable-tax order can't be placed.
    fireEvent.click(screen.getByTestId("checkout-ruo-ack"));
    expect(screen.getByTestId("checkout-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("checkout-submit"));
    // No ORDER placed — assert on the /api/checkout call specifically (the
    // INITIATE_CHECKOUT funnel fire to /api/track on mount is separate and
    // expected).
    const checkoutCalls = (submit.mock.calls as Array<[string, RequestInit]>).filter(
      ([url]) => url === "/api/checkout",
    );
    expect(checkoutCalls).toHaveLength(0);
  });

  // ── SEAM 2b: saved-address picker ──────────────────────────────────────────

  const SAVED_ADDRESS: Address = {
    id: "addr-1",
    label: "Home",
    line1: "1 Test St",
    line2: null,
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    country: "US",
    isDefault: true,
  };

  it("offers the signed-in shopper's saved addresses when the address book is on", async () => {
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        addressBookEnabled
        savedAddresses={[SAVED_ADDRESS]}
      />,
    );
    await screen.findByTestId("checkout-form");
    expect(screen.getByTestId("checkout-saved-address")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Home — 1 Test St, Austin TX 78701/ }),
    ).toBeInTheDocument();
  });

  it("hides the address picker for a guest / gate-off / failed read (never 'no saved addresses')", async () => {
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        addressBookEnabled
        savedAddresses={null}
      />,
    );
    await screen.findByTestId("checkout-form");
    expect(screen.queryByTestId("checkout-saved-address")).not.toBeInTheDocument();
  });

  it("forwards the picked saved address in the checkout POST", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            outcome: "placed",
            orderId: "o-1",
            orderNumber: 1042,
            totalCents: 9895,
            currency: "usd",
            cardChargedCents: 9895,
            storeCreditAppliedCents: 0,
            giftCardAppliedCents: 0,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        addressBookEnabled
        savedAddresses={[SAVED_ADDRESS]}
      />,
    );
    await screen.findByTestId("checkout-form");
    fireEvent.change(screen.getByTestId("checkout-saved-address-select"), {
      target: { value: "addr-1" },
    });
    await fillAndSubmit("4111111111111111");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/checkout");
    if (call === undefined) throw new Error("expected a POST to /api/checkout");
    const posted = JSON.parse((call[1] as RequestInit).body as string);
    expect(posted.shippingAddress).toMatchObject({
      label: "Home",
      line1: "1 Test St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US",
    });
    expect(posted.expedited).toBe(false);
  });
});

describe("CheckoutForm — coupon (LOO-3156)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedCart();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("hides the coupon input when the store's promotions gate is off", async () => {
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} />);
    await screen.findByTestId("checkout-form");
    expect(screen.queryByTestId("checkout-coupon")).toBeNull();
  });

  it("submits the typed coupon code with the checkout POST when promotions are on", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/checkout") {
        return new Response(
          JSON.stringify({
            outcome: "placed",
            orderId: "order-1",
            orderNumber: 1000,
            totalCents: 8995,
            currency: "usd",
            cardChargedCents: 8995,
            storeCreditAppliedCents: 0,
            giftCardAppliedCents: 0,
            subscriptions: [],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} promotionsEnabled />);
    await screen.findByTestId("checkout-form");
    fireEvent.change(screen.getByTestId("checkout-coupon-code"), { target: { value: "SAVE10" } });
    await fillAndSubmit("4111111111111111");
    await screen.findByTestId("checkout-confirmation");

    const checkoutCall = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/checkout") as
      | [RequestInfo | URL, RequestInit]
      | undefined;
    if (checkoutCall === undefined) throw new Error("no /api/checkout call was made");
    const body = JSON.parse(String(checkoutCall[1].body));
    expect(body.couponCode).toBe("SAVE10");
  });

  it("shows the never-discount note ONLY when an excluded sku is in the cart and a code is typed", async () => {
    // Re-seed with a sku on the exclusion list.
    window.localStorage.clear();
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bac-water",
        name: "Bacteriostatic Water",
        variantLabel: "30ml",
        variantId: "var-2",
        unitPriceCents: 1500,
        quantity: 1,
        sku: "NEVER-1",
      }),
    );
    render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={DEFAULT_PRICING}
        promotionsEnabled
        neverDiscountSkus={["NEVER-1"]}
      />,
    );
    await screen.findByTestId("checkout-form");
    expect(screen.queryByTestId("checkout-coupon-excluded-note")).toBeNull();
    fireEvent.change(screen.getByTestId("checkout-coupon-code"), { target: { value: "SAVE10" } });
    const note = await screen.findByTestId("checkout-coupon-excluded-note");
    expect(note.textContent).toContain("Bacteriostatic Water");
  });

  it("surfaces a refused coupon verbatim as the form error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: RequestInfo | URL) =>
          new Response(
            String(url) === "/api/checkout"
              ? JSON.stringify({
                  outcome: "error",
                  message: "coupon SAVE10 is not active",
                })
              : "{}",
            { status: String(url) === "/api/checkout" ? 412 : 200 },
          ),
      ),
    );
    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} promotionsEnabled />);
    await screen.findByTestId("checkout-form");
    fireEvent.change(screen.getByTestId("checkout-coupon-code"), { target: { value: "SAVE10" } });
    await fillAndSubmit("4111111111111111");
    const error = await screen.findByTestId("checkout-error");
    expect(error.textContent).toContain("coupon SAVE10 is not active");
  });

  // ── server-computed coupon preview (money-honesty follow-up) ────────────

  it("shows the SERVER-computed discount + server totals once /api/checkout/preview prices the code", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/checkout/preview") {
        return new Response(
          JSON.stringify({
            outcome: "priced",
            subtotalCents: 9000,
            discountCents: 900,
            shippingCents: 895,
            taxCents: 0,
            totalCents: 8995,
            currency: "usd",
            couponCode: "SAVE10",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} promotionsEnabled />);
    await screen.findByTestId("checkout-form");
    fireEvent.change(screen.getByTestId("checkout-coupon-code"), { target: { value: "SAVE10" } });

    // Debounced fetch → server verdict renders (waitFor covers the 350ms).
    const previewNote = await screen.findByTestId("checkout-coupon-preview", undefined, {
      timeout: 2000,
    });
    expect(previewNote.textContent).toContain("$9.00");
    // The summary shows the discount ROW and the server's own total —
    // subtotal 90.00 − 9.00 + shipping 8.95 = 89.95.
    expect(screen.getByTestId("checkout-coupon-discount").textContent).toContain("$9.00");
    expect(screen.getByTestId("checkout-order-total").textContent).toBe("$89.95");
    expect(screen.getByTestId("checkout-submit").textContent).toContain("$89.95");
  });

  it("shows the server's refusal for an invalid code before pay (and never a fabricated discount)", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/checkout/preview") {
        return new Response(
          JSON.stringify({
            outcome: "invalid_coupon",
            code: "coupon_not_found",
            message: "no such coupon: TYPO",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} promotionsEnabled />);
    await screen.findByTestId("checkout-form");
    fireEvent.change(screen.getByTestId("checkout-coupon-code"), { target: { value: "TYPO" } });

    const invalidNote = await screen.findByTestId("checkout-coupon-invalid", undefined, {
      timeout: 2000,
    });
    expect(invalidNote.textContent).toContain("no such coupon: TYPO");
    expect(screen.queryByTestId("checkout-coupon-discount")).toBeNull();
  });

  it("keeps the applied-at-payment copy when the preview is UNAVAILABLE (honest unknown, no $0 claim)", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/checkout/preview") {
        return new Response(
          JSON.stringify({ outcome: "unavailable", message: "preview unavailable" }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutForm storeKey={STORE_KEY} pricing={DEFAULT_PRICING} promotionsEnabled />);
    await screen.findByTestId("checkout-form");
    fireEvent.change(screen.getByTestId("checkout-coupon-code"), { target: { value: "SAVE10" } });

    await waitFor(
      () =>
        expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/checkout/preview")).toBe(
          true,
        ),
      { timeout: 2000 },
    );
    expect(screen.queryByTestId("checkout-coupon-preview")).toBeNull();
    expect(screen.queryByTestId("checkout-coupon-invalid")).toBeNull();
    expect(screen.queryByTestId("checkout-coupon-discount")).toBeNull();
    expect(screen.getByText(/Applied when you pay/)).toBeInTheDocument();
  });
});
