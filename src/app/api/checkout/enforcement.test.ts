import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();
const getCheckoutGatewayMock = vi.fn();
const dispatchMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));
vi.mock("@/lib/checkout", () => ({
  getCheckoutGateway: () => getCheckoutGatewayMock(),
}));
vi.mock("@/lib/beacon-producer", () => ({
  getBeaconProducer: () => ({ dispatch: dispatchMock }),
}));
vi.mock("@/lib/consent-store", () => ({
  getConsentGateway: () => ({
    record: vi.fn().mockResolvedValue({ outcome: "recorded", id: "consent-1" }),
  }),
}));

async function importRoute() {
  return import("./route");
}

/**
 * Every request carries the httpOnly RUO-ack pass cookie (`fd_ruo_ok`), merged
 * with any test-supplied cookie — the RUO gate is always-on, so a request
 * without it 403s before any of the consent/age behavior under test here. The
 * dedicated `ruo_ack_required` refusal is covered in `route.test.ts`.
 */
function req(body: unknown, headers: Record<string, string> = {}) {
  const { cookie, ...rest } = headers;
  const mergedCookie = cookie ? `fd_ruo_ok=1; ${cookie}` : "fd_ruo_ok=1";
  return new Request("http://storefront.test/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: mergedCookie, ...rest },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  customerRef: "guest:jane@example.test",
  idempotencyKey: "checkout:store-a:var-1:1:4500:1",
  items: [{ variantId: "var-1", quantity: 1 }],
  card: { ccnumber: "4111111111111111", ccexp: "1230" },
  cartTotalCents: 4500,
  cartCurrency: "usd",
};

const PLACED = {
  outcome: "placed" as const,
  orderId: "order-1",
  orderNumber: 1000,
  totalCents: 4500,
  currency: "usd",
};

/** A live resolution with an explicit compliance behavior block. */
function resolutionWith(compliance: Record<string, unknown>) {
  return {
    tenantRef: "acme-labs",
    storeId: "store-1",
    status: "live" as const,
    manifest: {
      store: { status: "live" },
      catalog: { storeKey: "acme-labs" },
      behavior: { compliance },
    },
  };
}

describe("checkout cookie-consent enforcement (LOO-3050 item 1)", () => {
  afterEach(() => vi.clearAllMocks());

  it("SUPPRESSES the beacon purchase fire when consent is enforced and NOT granted", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolutionWith({ cookieConsent: { enabled: true, regions: "all" } }),
    );
    getCheckoutGatewayMock.mockReturnValue({ submit: vi.fn().mockResolvedValue(PLACED) });
    const { POST } = await importRoute();

    // No fd_consent cookie → unknown → not a grant.
    const res = await POST(req(VALID_BODY));

    expect(res.status).toBe(200); // the order still places (transactional path unaffected)
    expect(dispatchMock).not.toHaveBeenCalled(); // …but nothing leaves the BFF
  });

  it("suppresses when consent is explicitly DENIED", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolutionWith({ cookieConsent: { enabled: true, regions: "all" } }),
    );
    getCheckoutGatewayMock.mockReturnValue({ submit: vi.fn().mockResolvedValue(PLACED) });
    const { POST } = await importRoute();

    const res = await POST(req(VALID_BODY, { cookie: "fd_consent=denied|storefront-banner|x" }));

    expect(res.status).toBe(200);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("FIRES the beacon purchase when consent is granted", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolutionWith({ cookieConsent: { enabled: true, regions: "all" } }),
    );
    getCheckoutGatewayMock.mockReturnValue({ submit: vi.fn().mockResolvedValue(PLACED) });
    dispatchMock.mockResolvedValue({ outcome: "accepted" });
    const { POST } = await importRoute();

    const res = await POST(req(VALID_BODY, { cookie: "fd_consent=granted|storefront-banner|x" }));

    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantRef: "acme-labs",
        eventId: "order_order-1",
        order: expect.objectContaining({ id: "order-1", value: 45, currency: "usd" }),
      }),
    );
  });

  it("FIRES without consent when the gate is disabled (open-ecommerce default)", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolutionWith({ cookieConsent: { enabled: false, regions: "all" } }),
    );
    getCheckoutGatewayMock.mockReturnValue({ submit: vi.fn().mockResolvedValue(PLACED) });
    dispatchMock.mockResolvedValue({ outcome: "accepted" });
    const { POST } = await importRoute();

    const res = await POST(req(VALID_BODY));

    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT enforce (fires) when the visitor's region is outside the target", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolutionWith({ cookieConsent: { enabled: true, regions: "eu-uk" } }),
    );
    getCheckoutGatewayMock.mockReturnValue({ submit: vi.fn().mockResolvedValue(PLACED) });
    dispatchMock.mockResolvedValue({ outcome: "accepted" });
    const { POST } = await importRoute();

    // A US visitor: the EU-UK gate does not apply, so tracking follows the default.
    const res = await POST(req(VALID_BODY, { "x-vercel-ip-country": "US" }));

    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it("never fires for a non-placed outcome", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolutionWith({ cookieConsent: { enabled: false, regions: "all" } }),
    );
    getCheckoutGatewayMock.mockReturnValue({
      submit: vi.fn().mockResolvedValue({ outcome: "declined", message: "no" }),
    });
    const { POST } = await importRoute();

    await POST(req(VALID_BODY));
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe("checkout checkbox age-gate enforcement (LOO-3050 item 3)", () => {
  afterEach(() => vi.clearAllMocks());

  it("403s a checkbox-age-gated store's checkout without the fd_age_ok pass cookie", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolutionWith({ ageGate: { enabled: true, minAge: 21, mode: "checkbox" } }),
    );
    const submit = vi.fn();
    getCheckoutGatewayMock.mockReturnValue({ submit });
    const { POST } = await importRoute();

    const res = await POST(req(VALID_BODY));

    expect(res.status).toBe(403);
    expect(submit).not.toHaveBeenCalled(); // never even attempts the order
  });

  it("allows checkout once the fd_age_ok pass cookie is present", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolutionWith({ ageGate: { enabled: true, minAge: 21, mode: "checkbox" } }),
    );
    getCheckoutGatewayMock.mockReturnValue({ submit: vi.fn().mockResolvedValue(PLACED) });
    const { POST } = await importRoute();

    const res = await POST(req(VALID_BODY, { cookie: "fd_age_ok=1" }));

    expect(res.status).toBe(200);
  });
});
