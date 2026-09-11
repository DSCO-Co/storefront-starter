import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();
const getShopperSessionMock = vi.fn();
const clientMock = {
  listWishlist: vi.fn(),
  addWishlistItem: vi.fn(),
  removeWishlistItem: vi.fn(),
  mergeWishlist: vi.fn(),
};

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));
vi.mock("@/lib/account-session", () => ({
  getShopperSession: () => getShopperSessionMock(),
}));
vi.mock("@/lib/account-client", () => ({
  getAccountClient: () => clientMock,
}));

async function importRoute() {
  return import("./route");
}

function resolution(wishlistEnabled: boolean) {
  return {
    tenantRef: "acme-labs",
    manifest: {
      store: { status: "live" },
      catalog: { storeKey: "acme-labs" },
      behavior: { wishlist: { enabled: wishlistEnabled } },
    },
  };
}

const session = { secret: "sess-secret", tenantRef: "acme-labs", personId: "p1", email: "a@x.com" };

function req(method: string, url = "http://storefront.test/api/wishlist", body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("wishlist BFF gate (LOO-3138)", () => {
  afterEach(() => vi.clearAllMocks());

  it("gate-off (wishlist disabled) → the surface answers as absent: 404, backend never called", async () => {
    getRequestManifestMock.mockResolvedValue(resolution(false));
    getShopperSessionMock.mockResolvedValue(session);
    const { GET, POST, DELETE } = await importRoute();

    expect((await GET()).status).toBe(404);
    expect((await POST(req("POST", undefined, { ref: "x" }))).status).toBe(404);
    expect((await DELETE(req("DELETE", "http://storefront.test/api/wishlist?ref=x"))).status).toBe(
      404,
    );

    expect(clientMock.listWishlist).not.toHaveBeenCalled();
    expect(clientMock.addWishlistItem).not.toHaveBeenCalled();
    expect(clientMock.removeWishlistItem).not.toHaveBeenCalled();
  });

  it("unknown host → 404", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { GET } = await importRoute();
    expect((await GET()).status).toBe(404);
  });

  it("enabled but no session → 401", async () => {
    getRequestManifestMock.mockResolvedValue(resolution(true));
    getShopperSessionMock.mockResolvedValue(null);
    const { GET } = await importRoute();
    expect((await GET()).status).toBe(401);
    expect(clientMock.listWishlist).not.toHaveBeenCalled();
  });

  it("enabled + signed in → adds and returns 201", async () => {
    getRequestManifestMock.mockResolvedValue(resolution(true));
    getShopperSessionMock.mockResolvedValue(session);
    clientMock.addWishlistItem.mockResolvedValue({ ok: true, value: undefined });
    const { POST } = await importRoute();

    const res = await POST(req("POST", undefined, { ref: "bpc-157" }));
    expect(res.status).toBe(201);
    expect(clientMock.addWishlistItem).toHaveBeenCalledWith("sess-secret", "bpc-157");
  });

  it("honest absence — a failed list read is a 502, never an empty list", async () => {
    getRequestManifestMock.mockResolvedValue(resolution(true));
    getShopperSessionMock.mockResolvedValue(session);
    clientMock.listWishlist.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "db down" },
    });
    const { GET } = await importRoute();
    const res = await GET();
    expect(res.status).toBe(502);
  });
});
