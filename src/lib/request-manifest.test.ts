/**
 * The request-manifest preview path: with a valid `fd_preview` cookie the
 * request renders the TOKENED draft (resolution carries `preview`), a
 * cross-tenant token falls back to the live resolution, and a stale token
 * renders live with NO preview marker — the banner's absence is the honest
 * signal, and nothing here may fake it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewResolveOutcome } from "@/lib/preview";

const headersMock = vi.fn();
const cookiesMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
  cookies: () => cookiesMock(),
}));

const resolveManifestMock = vi.fn();
vi.mock("@/lib/manifest-source", () => ({
  resolveManifest: (host: string) => resolveManifestMock(host),
  resolveManifestByTenant: vi.fn(),
}));

const resolvePreviewByTokenMock = vi.fn();
vi.mock("@/lib/preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/preview")>();
  return {
    ...actual,
    resolvePreviewByToken: (token: string) => resolvePreviewByTokenMock(token),
  };
});

// React's cache() memoizes per-request via async storage; in tests each
// dynamic import shares one cache scope, so re-import per test for isolation.
async function freshGetRequestManifest() {
  vi.resetModules();
  const mod = await import("./request-manifest");
  return mod.getRequestManifest;
}

function stubRequest(host: string, previewCookie: string | null) {
  headersMock.mockResolvedValue(new Headers({ host }));
  cookiesMock.mockResolvedValue({
    get: (name: string) =>
      name === "fd_preview" && previewCookie !== null ? { value: previewCookie } : undefined,
  });
}

function liveResolution(tenantRef: string) {
  return { storeId: "s-live", tenantRef, status: "live", manifest: { live: true } };
}

function previewOutcome(tenantRef: string): PreviewResolveOutcome {
  return {
    kind: "resolved",
    resolution: {
      storeId: "s-draft",
      tenantRef,
      status: "live",
      manifest: { draft: true } as never,
      preview: { version: 9, expiresAt: "2026-09-06T13:00:00.000Z" },
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("getRequestManifest preview mode", () => {
  it("a valid cookie on the store's own domain renders the draft, marked as preview", async () => {
    stubRequest("acme-labs.com", "fdpv_tok");
    resolvePreviewByTokenMock.mockResolvedValue(previewOutcome("acme-labs"));
    resolveManifestMock.mockResolvedValue(liveResolution("acme-labs"));
    const getRequestManifest = await freshGetRequestManifest();

    const resolution = await getRequestManifest();
    expect(resolution?.preview).toEqual({ version: 9, expiresAt: "2026-09-06T13:00:00.000Z" });
    expect(resolution?.manifest).toEqual({ draft: true });
  });

  it("a cross-tenant cookie on someone else's domain renders THEIR live site, unmarked", async () => {
    stubRequest("leo-research.com", "fdpv_tok");
    resolvePreviewByTokenMock.mockResolvedValue(previewOutcome("acme-labs"));
    resolveManifestMock.mockResolvedValue(liveResolution("leo-research"));
    const getRequestManifest = await freshGetRequestManifest();

    const resolution = await getRequestManifest();
    expect(resolution?.tenantRef).toBe("leo-research");
    expect(resolution?.manifest).toEqual({ live: true });
    expect(resolution?.preview).toBeUndefined();
  });

  it("on the shared onrender host the cookie previews even though the host resolves nothing", async () => {
    stubRequest("flightdeck-storefront.onrender.com", "fdpv_tok");
    resolvePreviewByTokenMock.mockResolvedValue(previewOutcome("acme-labs"));
    resolveManifestMock.mockResolvedValue(null);
    const getRequestManifest = await freshGetRequestManifest();

    const resolution = await getRequestManifest();
    expect(resolution?.tenantRef).toBe("acme-labs");
    expect(resolution?.preview?.version).toBe(9);
  });

  it("a stale token falls back to live with no preview marker", async () => {
    stubRequest("acme-labs.com", "fdpv_stale");
    resolvePreviewByTokenMock.mockResolvedValue({ kind: "invalid" });
    resolveManifestMock.mockResolvedValue(liveResolution("acme-labs"));
    const getRequestManifest = await freshGetRequestManifest();

    const resolution = await getRequestManifest();
    expect(resolution?.manifest).toEqual({ live: true });
    expect(resolution?.preview).toBeUndefined();
  });

  it("without the cookie the preview machinery is never invoked", async () => {
    stubRequest("acme-labs.com", null);
    resolveManifestMock.mockResolvedValue(liveResolution("acme-labs"));
    const getRequestManifest = await freshGetRequestManifest();

    const resolution = await getRequestManifest();
    expect(resolution?.tenantRef).toBe("acme-labs");
    expect(resolvePreviewByTokenMock).not.toHaveBeenCalled();
  });
});
