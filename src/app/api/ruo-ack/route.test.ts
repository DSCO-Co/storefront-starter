import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));

async function importRoute() {
  return import("./route");
}

function req(body: unknown) {
  return new Request("http://storefront.test/api/ruo-ack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const LIVE_RESOLUTION = {
  tenantRef: "acme-labs",
  storeId: "store-1",
  status: "live" as const,
  manifest: { store: { status: "live" }, catalog: { storeKey: "acme-labs" } },
};

describe("POST /api/ruo-ack", () => {
  afterEach(() => vi.clearAllMocks());

  it("404s an unknown host", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    expect((await POST(req({ confirmed: true }))).status).toBe(404);
  });

  it("400s without an explicit confirmation (never mints a pass cookie)", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    const { POST } = await importRoute();
    const res = await POST(req({ confirmed: false }));
    expect(res.status).toBe(400);
    expect(res.cookies.get("fd_ruo_ok")).toBeUndefined();
  });

  it("sets an httpOnly fd_ruo_ok cookie on a confirmed affirmation", async () => {
    getRequestManifestMock.mockResolvedValue(LIVE_RESOLUTION);
    const { POST } = await importRoute();
    const res = await POST(req({ confirmed: true }));

    expect(res.status).toBe(200);
    const cookie = res.cookies.get("fd_ruo_ok");
    expect(cookie?.value).toBe("1");
    expect(cookie?.httpOnly).toBe(true);
  });
});
