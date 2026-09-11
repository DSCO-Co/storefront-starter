import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();
const getCheckoutGatewayMock = vi.fn();
const recordConsentMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));
vi.mock("@/lib/checkout", () => ({
  getCheckoutGateway: () => getCheckoutGatewayMock(),
}));
vi.mock("@/lib/consent-store", () => ({
  getConsentGateway: () => ({ record: recordConsentMock }),
}));

async function importRoute() {
  return import("./route");
}

/** The httpOnly cookie the `/api/ruo-ack` route sets on a server-validated
 *  affirmation. Present by default so existing assertions exercise the placed
 *  path; the no-ack tests deliberately omit it. */
const RUO_COOKIE = "fd_ruo_ok=1";

function req(body: unknown, { ruoAck = true }: { ruoAck?: boolean } = {}) {
  return new Request("http://storefront.test/api/checkout", {
    method: "POST",
    headers: ruoAck ? { cookie: RUO_COOKIE } : {},
    body: JSON.stringify(body),
  });
}

const LIVE_RESOLUTION = {
  tenantRef: "acme-labs",
  storeId: "store-1",
  status: "live" as const,
  manifest: { store: { status: "live" }, catalog: { storeKey: "acme-labs" } },
};

const VALID_BODY = {
  customerRef: "guest:jane@example.test",
  idempotencyKey: "checkout:store-a:var-1:1:4500:1",
  items: [{ variantId: "var-1", quantity: 1 }],
  card: { ccnumber: "4111111111111111", ccexp: "1230" },
  cartTotalCents: 4500,
  cartCurrency: "usd",
};

describe("POST /api/checkout", () => {
  beforeEach(() => {
    // Default: the RUO-ack consent row persists. Individual tests override.
    recordConsentMock.mockResolvedValue({ outcome: "recorded", id: "consent-1" });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("404s an unknown host rather than guessing a tenant", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it("404s a non-live store rather than placing an order for it", async () => {
    getRequestManifestMock.mockResolvedValue({
      ...LIVE_RESOLUTION,
      manifest: { store: { status: "draft" } },
    });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(404);
    expect(getCheckoutGatewayMock).not.toHaveBeenCalled();
  });

  it("400s an invalid body without ever calling the checkout gateway", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    const { POST } = await importRoute();
    const res = await POST(req({ ...VALID_BODY, card: { ccnumber: "4111" } }));
    expect(res.status).toBe(400);
    expect(getCheckoutGatewayMock).not.toHaveBeenCalled();
  });

  it("400s a non-integer quantity item", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    const { POST } = await importRoute();
    const res = await POST(req({ ...VALID_BODY, items: [{ variantId: "var-1", quantity: 1.5 }] }));
    expect(res.status).toBe(400);
  });

  it("resolves tenantRef from the request's Host — a client-supplied tenantRef in the body is ignored", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    const submit = vi.fn().mockResolvedValue({
      outcome: "placed",
      orderId: "order-1",
      orderNumber: 1000,
      totalCents: 4500,
      currency: "usd",
    });
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(req({ ...VALID_BODY, tenantRef: "someone-elses-tenant" }));

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ tenantRef: "acme-labs" }));
  });

  it("resolves the manifest shipping/tax policy server-side and forwards it to the gateway", async () => {
    // A manifest declaring flat_rate tax + shipping — the BFF must resolve
    // this from the HOST (trusted) and forward it, so a live store actually
    // charges shipping + tax (SEAM 1). The client body never supplies pricing.
    getRequestManifestMock.mockResolvedValue({
      ...LIVE_RESOLUTION,
      manifest: {
        store: { status: "live" },
        catalog: { storeKey: "acme-labs" },
        behavior: {
          shipping: {
            flatRateCents: 895,
            expeditedRateCents: 1995,
            maxCents: 10000,
          },
          tax: { provider: "flat_rate", rateBps: 825 },
        },
      },
    });
    const submit = vi.fn().mockResolvedValue({
      outcome: "placed",
      orderId: "order-1",
      orderNumber: 1000,
      totalCents: 10637,
      currency: "usd",
    });
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(req({ ...VALID_BODY, expedited: true }));

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        pricing: expect.objectContaining({
          shipping: expect.objectContaining({ flatRateCents: 895, expeditedRateCents: 1995 }),
          tax: { provider: "flat_rate", rateBps: 825 },
          expedited: true,
        }),
      }),
    );
  });

  it("passes the gateway's outcome through verbatim on success", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    const outcome = {
      outcome: "placed",
      orderId: "order-1",
      orderNumber: 1042,
      totalCents: 4500,
      currency: "usd",
    };
    getCheckoutGatewayMock.mockReturnValue({ submit: vi.fn().mockResolvedValue(outcome) });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(outcome);
  });

  // ── RUO acknowledgment (server-enforced, always-on) ───────────────────────

  it("refuses checkout with 403 ruo_ack_required when the RUO affirmation cookie is absent (a scripted POST cannot skip it)", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    const submit = vi.fn();
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY, { ruoAck: false }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ruo_ack_required" });
    // Never a silent pass: the order is never even attempted.
    expect(submit).not.toHaveBeenCalled();
  });

  it("places the order when the RUO affirmation cookie is present", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    const outcome = {
      outcome: "placed",
      orderId: "order-9",
      orderNumber: 1099,
      totalCents: 4500,
      currency: "usd",
    };
    getCheckoutGatewayMock.mockReturnValue({ submit: vi.fn().mockResolvedValue(outcome) });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "placed" });
  });

  it("persists an append-only RUO-ack consent row bound to the placed order (disclosure version + order source)", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    getCheckoutGatewayMock.mockReturnValue({
      submit: vi.fn().mockResolvedValue({
        outcome: "placed",
        orderId: "order-42",
        orderNumber: 1142,
        totalCents: 4500,
        currency: "usd",
      }),
    });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(recordConsentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantRef: "acme-labs",
        categories: { researchUseOnly: true },
        disclosureRef: "ruo-ack-v1",
        source: "checkout:order_order-42",
      }),
    );
  });

  it("does NOT persist a consent row when the order is not placed (declined)", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    getCheckoutGatewayMock.mockReturnValue({
      submit: vi.fn().mockResolvedValue({ outcome: "declined", message: "card declined" }),
    });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(recordConsentMock).not.toHaveBeenCalled();
  });

  it("still returns the placed order when the RUO-ack persistence FAILS (never un-places an already-charged order)", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    getCheckoutGatewayMock.mockReturnValue({
      submit: vi.fn().mockResolvedValue({
        outcome: "placed",
        orderId: "order-7",
        orderNumber: 1077,
        totalCents: 4500,
        currency: "usd",
      }),
    });
    recordConsentMock.mockResolvedValue({ outcome: "error", message: "db down" });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "placed" });
  });
});

describe("POST /api/checkout — ARL consent evidence (C5, 2026-09-09 wave 2)", () => {
  afterEach(() => vi.clearAllMocks());

  const SUBS_RESOLUTION = {
    ...LIVE_RESOLUTION,
    manifest: {
      store: { status: "live" },
      catalog: { storeKey: "acme-labs" },
      behavior: { subscriptions: { enabled: true, discounts: { "30": 10 } } },
    },
  };
  const placed = {
    outcome: "placed",
    orderId: "order-1",
    orderNumber: 1000,
    totalCents: 4500,
    currency: "usd",
  };

  it("attaches the pinned subscriptionConsent evidence to a subscription-creating checkout", async () => {
    getRequestManifestMock.mockResolvedValue(SUBS_RESOLUTION);
    recordConsentMock.mockResolvedValue({ outcome: "recorded", id: "c1" });
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();

    const request = new Request("http://storefront.test/api/checkout", {
      method: "POST",
      headers: {
        cookie: RUO_COOKIE,
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
        "user-agent": "vitest-agent/1.0",
      },
      body: JSON.stringify({ ...VALID_BODY, subscribe: true, subscriptionIntervalDays: 30 }),
    });
    await POST(request);

    const { createHash } = await import("node:crypto");
    const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
    const { ARL_DISCLOSURE_REF, ARL_DISCLOSURE_TEXT } = await import("@/lib/arl-disclosure");
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        subscribe: true,
        subscription: { enabled: true, intervalDays: 30, discountPercent: 10 },
        subscriptionConsent: {
          disclosureRef: ARL_DISCLOSURE_REF,
          disclosureSha256: sha(ARL_DISCLOSURE_TEXT),
          // ipHash = sha-256 of the LEFTMOST forwarded-for hop, server-side.
          ipHash: sha("203.0.113.9"),
          userAgent: "vitest-agent/1.0",
        },
      }),
    );
  });

  it("sends NO subscriptionConsent on a plain (non-subscription) checkout", async () => {
    getRequestManifestMock.mockResolvedValue(SUBS_RESOLUTION);
    recordConsentMock.mockResolvedValue({ outcome: "recorded", id: "c1" });
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(req(VALID_BODY));
    const sent = submit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.subscriptionConsent).toBeUndefined();
  });

  it("surfaces the module's missing-consent 400 as an honest error outcome (no silent retry)", async () => {
    getRequestManifestMock.mockResolvedValue(SUBS_RESOLUTION);
    recordConsentMock.mockResolvedValue({ outcome: "recorded", id: "c1" });
    // The gateway maps a module 400 to an error outcome with the backend's
    // message — assert the BFF passes it through verbatim as JSON.
    const submit = vi.fn().mockResolvedValue({
      outcome: "error",
      message: "subscription consent evidence required",
    });
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    const res = await POST(req({ ...VALID_BODY, subscribe: true, subscriptionIntervalDays: 30 }));
    expect(await res.json()).toMatchObject({
      outcome: "error",
      message: "subscription consent evidence required",
    });
  });
});

describe("POST /api/checkout — coupon (LOO-3156)", () => {
  afterEach(() => vi.clearAllMocks());

  const placed = {
    outcome: "placed",
    orderId: "order-1",
    orderNumber: 1000,
    totalCents: 4050,
    currency: "usd",
  };

  it("forwards a typed coupon code to the gateway (promotions default ON)", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    recordConsentMock.mockResolvedValue({ outcome: "recorded", id: "c1" });
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(req({ ...VALID_BODY, couponCode: " SAVE10 " }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ couponCode: "SAVE10" }));
  });

  it("no coupon in the body → couponCode null (unchanged behavior)", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    recordConsentMock.mockResolvedValue({ outcome: "recorded", id: "c1" });
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(req(VALID_BODY));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ couponCode: null }));
  });

  it("REFUSES a coupon when the store's promotions gate is off — never silently drops the code", async () => {
    getRequestManifestMock.mockResolvedValue({
      ...LIVE_RESOLUTION,
      manifest: {
        store: { status: "live" },
        catalog: { storeKey: "acme-labs" },
        behavior: { promotions: { enabled: false } },
      },
    });
    const { POST } = await importRoute();
    const res = await POST(req({ ...VALID_BODY, couponCode: "SAVE10" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ outcome: "error" });
    expect(getCheckoutGatewayMock).not.toHaveBeenCalled();
  });

  it("forwards the manifest's never-discount SKU list with the pricing policy", async () => {
    getRequestManifestMock.mockResolvedValue({
      ...LIVE_RESOLUTION,
      manifest: {
        store: { status: "live" },
        catalog: { storeKey: "acme-labs" },
        behavior: {
          promotions: { enabled: true, neverDiscountSkus: ["NEVER-1"] },
          tax: { provider: "null", rateBps: 0 },
        },
      },
    });
    recordConsentMock.mockResolvedValue({ outcome: "recorded", id: "c1" });
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(req({ ...VALID_BODY, couponCode: "SAVE10" }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        pricing: expect.objectContaining({ neverDiscountSkus: ["NEVER-1"] }),
      }),
    );
  });

  // ── referral capture hop (gap brief 2026-09-06) ─────────────────────────

  const REFERRALS_ON_RESOLUTION = {
    ...LIVE_RESOLUTION,
    manifest: {
      store: { status: "live" },
      catalog: { storeKey: "acme-labs" },
      behavior: { referrals: { enabled: true } },
    },
  };

  function reqWithRefCookie(refValue: string | null, resolutionBody: unknown = VALID_BODY) {
    return new Request("http://storefront.test/api/checkout", {
      method: "POST",
      headers: {
        cookie: refValue !== null ? `${RUO_COOKIE}; fd_ref=${refValue}` : RUO_COOKIE,
      },
      body: JSON.stringify(resolutionBody),
    });
  }

  it("forwards the fd_ref cookie's referral code to the gateway when the store's referrals gate is on", async () => {
    getRequestManifestMock.mockResolvedValue(REFERRALS_ON_RESOLUTION);
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(reqWithRefCookie("lori-h"));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ referralCode: "lori-h" }));
  });

  it("forwards NO referral code when the referrals gate is off — even with a stale fd_ref cookie", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION); // referrals default: disabled
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(reqWithRefCookie("lori-h"));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ referralCode: null }));
  });

  it("drops a malformed fd_ref cookie value (never blocks the checkout)", async () => {
    getRequestManifestMock.mockResolvedValue(REFERRALS_ON_RESOLUTION);
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    const res = await POST(reqWithRefCookie(encodeURIComponent("x".repeat(200))));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ referralCode: null }));
    expect(res.status).toBe(200);
  });

  it("never reads a referral code from the POST body", async () => {
    getRequestManifestMock.mockResolvedValue(REFERRALS_ON_RESOLUTION);
    const submit = vi.fn().mockResolvedValue(placed);
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();
    await POST(reqWithRefCookie(null, { ...VALID_BODY, referralCode: "spoofed" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ referralCode: null }));
  });
});
