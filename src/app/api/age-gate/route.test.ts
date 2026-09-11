import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));

async function importRoute() {
  return import("./route");
}

function req(body: unknown) {
  return new Request("http://storefront.test/api/age-gate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resolution(ageGate: Record<string, unknown>) {
  return {
    tenantRef: "acme-labs",
    storeId: "store-1",
    status: "live" as const,
    manifest: {
      store: { status: "live" },
      catalog: { storeKey: "acme-labs" },
      behavior: { compliance: { ageGate } },
    },
  };
}

describe("POST /api/age-gate (LOO-3050 item 3)", () => {
  afterEach(() => vi.clearAllMocks());

  it("404s an unknown host", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    expect((await POST(req({ confirmed: true }))).status).toBe(404);
  });

  it("400s a store with no age gate (never mints a pass for a store that didn't ask)", async () => {
    getRequestManifestMock.mockResolvedValue(resolution({ enabled: false }));
    const { POST } = await importRoute();
    const res = await POST(req({ confirmed: true }));
    expect(res.status).toBe(400);
    expect(res.cookies.get("fd_age_ok")).toBeUndefined();
  });

  it("400s without an explicit confirmation", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolution({ enabled: true, minAge: 21, mode: "interstitial" }),
    );
    const { POST } = await importRoute();
    expect((await POST(req({ confirmed: false }))).status).toBe(400);
  });

  it("sets an httpOnly fd_age_ok cookie on a confirmed pass", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolution({ enabled: true, minAge: 21, mode: "interstitial" }),
    );
    const { POST } = await importRoute();
    const res = await POST(req({ confirmed: true }));

    expect(res.status).toBe(200);
    const cookie = res.cookies.get("fd_age_ok");
    expect(cookie?.value).toBe("1");
    expect(cookie?.httpOnly).toBe(true);
  });
});
