import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();
const recordMock = vi.fn();
const getShopperSessionMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));
vi.mock("@/lib/cart-activity-store", () => ({
  getCartActivityGateway: () => ({ record: recordMock }),
}));
vi.mock("@/lib/account-session", () => ({
  getShopperSession: () => getShopperSessionMock(),
}));

async function importRoute() {
  return import("./route");
}

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://storefront.test/api/cart-activity", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function resolution(compliance: Record<string, unknown> = {}) {
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

describe("POST /api/cart-activity (FD Epic 16 abandoned-cart signal)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    getShopperSessionMock.mockResolvedValue(null);
  });

  it("404s an unknown host", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    expect((await POST(req({ cartRef: "c1", itemCount: 1 }))).status).toBe(404);
  });

  it("400s a malformed ping without forwarding", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    getShopperSessionMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    expect((await POST(req({ itemCount: 1 }))).status).toBe(400);
    expect((await POST(req({ cartRef: "c1", itemCount: 1.5 }))).status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("no email anywhere → accepted but NOT recorded (an unactionable row is never written)", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    getShopperSessionMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    const res = await POST(req({ cartRef: "c1", itemCount: 2 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "ok", recorded: false });
    expect(recordMock).not.toHaveBeenCalled();
    // A fresh visitor is still minted the stable first-party anon id.
    expect(res.cookies.get("fd_sid")?.value).toMatch(/^anon_/);
  });

  it("records with the typed email; forwards tenant/cart/conversion faithfully", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    getShopperSessionMock.mockResolvedValue(null);
    recordMock.mockResolvedValue({ outcome: "recorded" });
    const { POST } = await importRoute();
    const res = await POST(
      req({ cartRef: "c1", itemCount: 0, email: "jane@a.test", checkedOut: true }),
    );
    expect(await res.json()).toMatchObject({ recorded: true });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantRef: "acme-labs",
        cartRef: "c1",
        email: "jane@a.test",
        itemCount: 0,
        checkedOut: true,
      }),
    );
  });

  it("falls back to the SIGNED-IN shopper's session email (server-verified, tenant-matched)", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    getShopperSessionMock.mockResolvedValue({
      secret: "s",
      tenantRef: "acme-labs",
      personId: "p1",
      email: "member@a.test",
      name: null,
    });
    recordMock.mockResolvedValue({ outcome: "recorded" });
    const { POST } = await importRoute();
    const res = await POST(req({ cartRef: "c1", itemCount: 2 }));
    expect(await res.json()).toMatchObject({ recorded: true });
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ email: "member@a.test" }));
  });

  it("a session from ANOTHER store's tenant is never used for this store's cart", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    getShopperSessionMock.mockResolvedValue({
      secret: "s",
      tenantRef: "other-store",
      personId: "p1",
      email: "member@other.test",
      name: null,
    });
    const { POST } = await importRoute();
    const res = await POST(req({ cartRef: "c1", itemCount: 2 }));
    expect(await res.json()).toMatchObject({ recorded: false });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("CONSENT-ABSENT on an enforcing store: nothing recorded (deliberate suppression, server authority)", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolution({ cookieConsent: { enabled: true, regions: "all" } }),
    );
    getShopperSessionMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    const res = await POST(
      req({ cartRef: "c1", itemCount: 2, email: "jane@a.test" }, { "x-vercel-ip-country": "DE" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "ok", recorded: false });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("a FAILED forward is reported recorded:false — never laundered into success", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    getShopperSessionMock.mockResolvedValue(null);
    recordMock.mockResolvedValue({ outcome: "error", message: "marketing unreachable" });
    const { POST } = await importRoute();
    const res = await POST(req({ cartRef: "c1", itemCount: 2, email: "jane@a.test" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "ok", recorded: false });
  });
});
