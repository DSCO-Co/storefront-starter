import type { OrderPricingConfig } from "@dscodotco-shared/order-totals";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureCheckoutGateway, LiveCheckoutGateway } from "@/lib/checkout";

const REQUEST_BASE = {
  tenantRef: "acme-labs",
  customerRef: "guest-cart-abc123",
  idempotencyKey: "cart-abc123",
  items: [{ variantId: "var-1", quantity: 2 }],
  couponCode: null,
  cartTotalCents: 9000,
  cartCurrency: "usd",
};

const PRICING_FLAT_TAX: OrderPricingConfig = {
  shipping: {
    mode: "flat",
    flatRateCents: 895,
    expeditedRateCents: 1995,
    maxCents: 10000,
    freeShippingThresholdCents: null,
  },
  tax: { provider: "flat_rate", rateBps: 825 },
  expedited: false,
};

describe("FixtureCheckoutGateway", () => {
  const gateway = new FixtureCheckoutGateway();

  it("places an order for an ordinary card, echoing the cart's own total", async () => {
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
    });
    expect(outcome.outcome).toBe("placed");
    if (outcome.outcome === "placed") {
      expect(outcome.totalCents).toBe(9000);
      expect(outcome.currency).toBe("usd");
      expect(outcome.orderNumber).toBeGreaterThanOrEqual(1000);
    }
  });

  it("is deterministic: the SAME idempotencyKey always yields the SAME fake order", async () => {
    const a = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
    });
    const b = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
    });
    expect(a).toEqual(b);
  });

  it("declines the magic 0002 card, matching @dscodotco/payments' FakePaymentProvider convention", async () => {
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111110002", ccexp: "1230" },
    });
    expect(outcome.outcome).toBe("declined");
  });

  it("is indeterminate on the magic 0003 card and tells the shopper not to resubmit", async () => {
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111110003", ccexp: "1230" },
    });
    expect(outcome.outcome).toBe("indeterminate");
    if (outcome.outcome === "indeterminate") {
      expect(outcome.message.toLowerCase()).toContain("not resubmit");
    }
  });

  // SEAM 1: fixture-mode re-prices with the manifest policy, so shipping + tax
  // are actually charged (not $0), using the SAME resolver the server uses.
  it("applies the manifest shipping + tax to the fixture total", async () => {
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
      pricing: PRICING_FLAT_TAX,
    });
    expect(outcome.outcome).toBe("placed");
    if (outcome.outcome === "placed") {
      // 9000 subtotal + 895 shipping + floor(9000×825/10000)=742 tax = 10637.
      expect(outcome.totalCents).toBe(10637);
      expect(outcome.cardChargedCents).toBe(10637);
    }
  });

  it("charges the expedited shipping rate when the shopper chose it", async () => {
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
      pricing: { ...PRICING_FLAT_TAX, expedited: true },
    });
    expect(outcome.outcome).toBe("placed");
    // 9000 + 1995 shipping + 742 tax = 11737.
    if (outcome.outcome === "placed") expect(outcome.totalCents).toBe(11737);
  });

  it("FAILS CLOSED on a stripe_tax store: an honest error, never a placed $0-tax order", async () => {
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
      pricing: { ...PRICING_FLAT_TAX, tax: { provider: "stripe_tax", rateBps: 0 } },
    });
    expect(outcome.outcome).toBe("error");
  });
});

describe("LiveCheckoutGateway", () => {
  const gateway = new LiveCheckoutGateway("https://api.example.test", "storefront-token");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the storefront token (never the operator token) + idempotency-key headers and maps a 201 to 'placed'", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      // B7-4 (docs/audits/batch7-review-2026-08-31.md): this is the whole
      // point of the fix — the storefront's server-side gateway must send
      // its own narrow credential, not the platform-wide operator token.
      expect(headers["x-storefront-token"]).toBe("storefront-token");
      expect(headers["x-operator-token"]).toBeUndefined();
      expect(headers["idempotency-key"]).toBe("cart-abc123");
      return new Response(
        JSON.stringify({
          order: { id: "order-1", order_number: 1042, total_cents: 9000, currency: "usd" },
        }),
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
    });
    expect(outcome).toEqual({
      outcome: "placed",
      orderId: "order-1",
      orderNumber: 1042,
      totalCents: 9000,
      currency: "usd",
      // No tender fields in this (older-shape) response body -> the gateway
      // falls back to "all on the card", never a fabricated tender amount.
      cardChargedCents: 9000,
      storeCreditAppliedCents: 0,
      giftCardAppliedCents: 0,
      // No subscribe-and-save receipt in this (older-shape) response body.
      subscriptions: [],
    });
  });

  it("forwards the manifest shipping/tax policy + picked address on the wire (snake_case)", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse((init?.body as string) ?? "{}");
      return new Response(
        JSON.stringify({
          order: { id: "order-1", order_number: 1042, total_cents: 10637, currency: "usd" },
        }),
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
      pricing: { ...PRICING_FLAT_TAX, expedited: true },
      shippingAddress: {
        label: "Home",
        line1: "1 Test St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
      },
    });

    expect(sentBody.shipping).toMatchObject({
      mode: "flat",
      flat_rate_cents: 895,
      expedited_rate_cents: 1995,
      max_cents: 10000,
      free_shipping_threshold_cents: null,
    });
    expect(sentBody.tax).toMatchObject({ provider: "flat_rate", rate_bps: 825 });
    expect(sentBody.expedited).toBe(true);
    expect(sentBody.shipping_address).toMatchObject({
      label: "Home",
      line1: "1 Test St",
      postal_code: "78701",
      country: "US",
    });
  });

  it("maps a 402 to a declined outcome, never labeled as a platform error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "payment_declined", message: "do_not_honor" } }),
            { status: 402 },
          ),
      ),
    );
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
    });
    expect(outcome.outcome).toBe("declined");
    if (outcome.outcome === "declined") expect(outcome.message).toBe("do_not_honor");
  });

  it("maps a 502 (indeterminate) distinctly from a decline — never auto-implies retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "payment_outcome_indeterminate", message: "NMI timed out" },
            }),
            { status: 502 },
          ),
      ),
    );
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
    });
    expect(outcome.outcome).toBe("indeterminate");
  });

  it("maps a captured-but-not-placed 500 to 'error', never 'declined' — money may have moved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "captured_but_not_placed", message: "reconcile" } }),
            { status: 500 },
          ),
      ),
    );
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
    });
    expect(outcome.outcome).toBe("error");
  });

  it("a network failure maps to 'error', never 'declined'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const outcome = await gateway.submit({
      ...REQUEST_BASE,
      card: { ccnumber: "4111111111111111", ccexp: "1230" },
    });
    expect(outcome.outcome).toBe("error");
  });
});
