import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();
const recordMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));
vi.mock("@/lib/consent-store", () => ({
  getConsentGateway: () => ({ record: recordMock }),
}));

async function importRoute() {
  return import("./route");
}

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://storefront.test/api/consent", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function resolution(compliance: Record<string, unknown>) {
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

describe("POST /api/consent (LOO-3050 item 2)", () => {
  afterEach(() => vi.clearAllMocks());

  it("404s an unknown host", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    expect((await POST(req({ decision: "granted" }))).status).toBe(404);
  });

  it("400s a bad decision without persisting", async () => {
    getRequestManifestMock.mockResolvedValue(resolution({}));
    const { POST } = await importRoute();
    const res = await POST(req({ decision: "maybe" }));
    expect(res.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("persists an append-only consent row on grant AND sets the fd_consent cookie", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolution({ cookieConsent: { enabled: true, regions: "all" } }),
    );
    recordMock.mockResolvedValue({ outcome: "recorded", id: "c1" });
    const { POST } = await importRoute();

    const res = await POST(req({ decision: "granted" }, { "x-vercel-ip-country": "DE" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: "granted", persisted: true });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantRef: "acme-labs",
        subject: expect.objectContaining({ type: "anon" }),
        categories: { analytics: true, marketing: true },
        region: "DE",
        source: "storefront-banner",
      }),
    );
    expect(res.cookies.get("fd_consent")?.value).toContain("granted");
    // A fresh visitor is minted a first-party anon id.
    expect(res.cookies.get("fd_sid")?.value).toMatch(/^anon_/);
  });

  it("still sets the cookie but reports persisted:false when the write fails (never laundered to success)", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolution({ acknowledgmentGate: { enabled: true, persistConsentRow: true } }),
    );
    recordMock.mockResolvedValue({ outcome: "error", message: "db down" });
    const { POST } = await importRoute();

    const res = await POST(req({ decision: "denied" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ persisted: false });
    expect(res.cookies.get("fd_consent")?.value).toContain("denied");
  });

  // ── E5 consent granularity + E3 privacy-choices (2026-09-09 wave 2) ─────

  it("records a category SPLIT: analytics-only grant → cookie 'denied…|10', record marketing:false", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolution({ cookieConsent: { enabled: true, regions: "all" } }),
    );
    recordMock.mockResolvedValue({ outcome: "recorded", id: "c1" });
    const { POST } = await importRoute();

    const res = await POST(
      req({ decision: "granted", categories: { analytics: true, advertising: false } }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      decision: "granted",
      categories: { analytics: true, advertising: false },
      persisted: true,
    });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ categories: { analytics: true, marketing: false } }),
    );
    // adTracking stays the ADVERTISING verdict; the 4th field carries the split.
    const cookie = decodeURIComponent(res.cookies.get("fd_consent")?.value ?? "");
    expect(cookie.startsWith("denied|")).toBe(true);
    expect(cookie.endsWith("|10")).toBe(true);
  });

  it("400s malformed categories without persisting (never coerced into a grant)", async () => {
    getRequestManifestMock.mockResolvedValue(resolution({}));
    const { POST } = await importRoute();
    const res = await POST(req({ decision: "granted", categories: { analytics: "yes" } }));
    expect(res.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("ALWAYS persists a privacy-choices withdrawal (E3) — the exercised right is the artifact", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolution({
        acknowledgmentGate: { enabled: false, persistConsentRow: false },
        cookieConsent: { enabled: true, regions: "all" },
      }),
    );
    recordMock.mockResolvedValue({ outcome: "recorded", id: "c2" });
    const { POST } = await importRoute();

    const res = await POST(
      req({
        decision: "denied",
        categories: { analytics: false, advertising: false },
        source: "privacy-choices",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: "denied", persisted: true });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "privacy-choices",
        categories: { analytics: false, marketing: false },
      }),
    );
    expect(decodeURIComponent(res.cookies.get("fd_consent")?.value ?? "")).toContain("denied");
  });

  it("does NOT persist a denial when the store didn't ask for a durable row", async () => {
    // persistConsentRow=false + a denial → nothing to durably record (a grant
    // would still be recorded; a declined non-durable store records nothing).
    getRequestManifestMock.mockResolvedValue(
      resolution({
        acknowledgmentGate: { enabled: false, persistConsentRow: false },
        cookieConsent: { enabled: true, regions: "all" },
      }),
    );
    const { POST } = await importRoute();
    const res = await POST(req({ decision: "denied" }));
    expect(res.status).toBe(200);
    expect(recordMock).not.toHaveBeenCalled();
  });
});
