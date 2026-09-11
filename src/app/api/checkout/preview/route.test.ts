/**
 * Coupon-preview BFF (money-honesty follow-up to LOO-3156): the coupon UI's
 * discount number is the BACKEND's own preview — this route must forward
 * server-resolved policy, honor the promotions gate exactly like placement,
 * and degrade to an HONEST "unavailable" (never a $0-discount or
 * invalid-code claim it can't back).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();
const getCheckoutGatewayMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));
vi.mock("@/lib/checkout", () => ({
  getCheckoutGateway: () => getCheckoutGatewayMock(),
}));

async function importRoute() {
  return import("./route");
}

function req(body: unknown) {
  return new Request("http://storefront.test/api/checkout/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const PROMO_RESOLUTION = {
  tenantRef: "acme-labs",
  manifest: {
    store: { status: "live" },
    catalog: { storeKey: "acme-labs" },
    behavior: {
      promotions: { enabled: true },
      tax: { provider: "null", rateBps: 0 },
    },
  },
};

const VALID_BODY = {
  couponCode: "SAVE10",
  items: [{ variantId: "var-1", quantity: 2 }],
};

describe("POST /api/checkout/preview", () => {
  afterEach(() => vi.clearAllMocks());

  it("404s an unknown host", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it("forwards the Host-resolved tenant + server-resolved pricing to the gateway preview", async () => {
    getRequestManifestMock.mockResolvedValue(PROMO_RESOLUTION);
    const preview = vi.fn().mockResolvedValue({
      outcome: "priced",
      subtotalCents: 9000,
      discountCents: 900,
      shippingCents: 895,
      taxCents: 0,
      totalCents: 8995,
      currency: "usd",
      couponCode: "SAVE10",
    });
    getCheckoutGatewayMock.mockReturnValue({ preview });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "priced", discountCents: 900 });
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantRef: "acme-labs",
        couponCode: "SAVE10",
        items: [{ variantId: "var-1", quantity: 2 }],
        pricing: expect.objectContaining({ tax: { provider: "null", rateBps: 0 } }),
      }),
    );
  });

  it("refuses a coupon on a promotions-off store with the SAME posture as placement", async () => {
    getRequestManifestMock.mockResolvedValue({
      ...PROMO_RESOLUTION,
      manifest: {
        ...PROMO_RESOLUTION.manifest,
        behavior: { promotions: { enabled: false } },
      },
    });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ outcome: "invalid_coupon" });
    expect(getCheckoutGatewayMock).not.toHaveBeenCalled();
  });

  it("400s an invalid items payload without calling the gateway", async () => {
    getRequestManifestMock.mockResolvedValue(PROMO_RESOLUTION);
    const { POST } = await importRoute();
    const res = await POST(req({ couponCode: "SAVE10", items: [] }));
    expect(res.status).toBe(400);
    expect(getCheckoutGatewayMock).not.toHaveBeenCalled();
  });

  it("answers an HONEST unavailable (200) when the gateway itself throws", async () => {
    getRequestManifestMock.mockResolvedValue(PROMO_RESOLUTION);
    getCheckoutGatewayMock.mockImplementation(() => {
      throw new Error("FLIGHTDECK_STOREFRONT_TOKEN is not set");
    });
    const { POST } = await importRoute();
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "unavailable" });
  });
});
