/**
 * Middleware half of the draft-preview handshake: `?__preview=` either sets
 * the httpOnly cookie and redirects to the clean URL, or REFUSES explicitly
 * (410 expired / 503 unverifiable / 403 wrong store) — never a silent
 * fall-through where the merchant mistakes the live site for their draft.
 * Token RESOLUTION is mocked (it has its own tests in lib/preview.test.ts);
 * the tenant-match decision runs for real.
 */
import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewResolveOutcome } from "@/lib/preview";

const resolveManifestMock = vi.fn();
vi.mock("@/lib/manifest-source", () => ({
  resolveManifest: (host: string) => resolveManifestMock(host),
}));

const resolvePreviewByTokenMock = vi.fn();
vi.mock("@/lib/preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/preview")>();
  return {
    ...actual,
    resolvePreviewByToken: (token: string) => resolvePreviewByTokenMock(token),
  };
});

async function importMiddleware() {
  return import("./middleware");
}

function req(host: string, path: string): NextRequest {
  const url = new URL(`https://${host}${path}`);
  return {
    nextUrl: {
      pathname: url.pathname,
      searchParams: url.searchParams,
      protocol: url.protocol,
      clone: () => new URL(url.toString()),
    },
    headers: new Headers({ host }),
  } as unknown as NextRequest;
}

function resolved(tenantRef: string): PreviewResolveOutcome {
  return {
    kind: "resolved",
    resolution: {
      storeId: "store-1",
      tenantRef,
      status: "draft",
      manifest: {} as never,
      preview: { version: 3, expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() },
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("preview handshake", () => {
  it("valid token on the shared onrender host: cookie set, redirect to the clean URL", async () => {
    resolvePreviewByTokenMock.mockResolvedValue(resolved("acme-labs"));
    resolveManifestMock.mockResolvedValue(null); // shared host resolves nothing
    const { middleware } = await importMiddleware();

    const res = await middleware(
      req("flightdeck-storefront.onrender.com", "/products/nad?__preview=fdpv_a.b"),
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/products/nad");
    expect(location.searchParams.has("__preview")).toBe(false);
    const cookie = res.cookies.get("fd_preview");
    expect(cookie?.value).toBe("fdpv_a.b");
    expect(cookie?.httpOnly).toBe(true);
    expect((cookie?.maxAge ?? 0) > 0).toBe(true);
  });

  it("valid token on the store's OWN domain: allowed when tenants match", async () => {
    resolvePreviewByTokenMock.mockResolvedValue(resolved("acme-labs"));
    resolveManifestMock.mockResolvedValue({ tenantRef: "acme-labs" });
    const { middleware } = await importMiddleware();

    const res = await middleware(req("acme-labs.com", "/?__preview=fdpv_a.b"));
    expect(res.headers.get("location")).toBeTruthy();
    expect(res.cookies.get("fd_preview")?.value).toBe("fdpv_a.b");
  });

  it("cross-tenant refusal: someone else's domain gets an explicit 403, no cookie", async () => {
    resolvePreviewByTokenMock.mockResolvedValue(resolved("acme-labs"));
    resolveManifestMock.mockResolvedValue({ tenantRef: "leo-research" });
    const { middleware } = await importMiddleware();

    const res = await middleware(req("leo-research.com", "/?__preview=fdpv_a.b"));
    expect(res.status).toBe(403);
    expect(res.cookies.get("fd_preview")).toBeUndefined();
  });

  it("an unresolvable NON-shared host is refused too", async () => {
    resolvePreviewByTokenMock.mockResolvedValue(resolved("acme-labs"));
    resolveManifestMock.mockResolvedValue(null);
    const { middleware } = await importMiddleware();

    const res = await middleware(req("random-unverified.example", "/?__preview=fdpv_a.b"));
    expect(res.status).toBe(403);
  });

  it("invalid/expired token: explicit 410, no cookie, no silent live render", async () => {
    resolvePreviewByTokenMock.mockResolvedValue({ kind: "invalid" });
    const { middleware } = await importMiddleware();

    const res = await middleware(req("acme-labs.com", "/?__preview=fdpv_stale.b"));
    expect(res.status).toBe(410);
    expect(res.cookies.get("fd_preview")).toBeUndefined();
  });

  it("unverifiable token (backend down): 503, never treated as expired or as live", async () => {
    resolvePreviewByTokenMock.mockResolvedValue({ kind: "unavailable" });
    const { middleware } = await importMiddleware();

    const res = await middleware(req("acme-labs.com", "/?__preview=fdpv_a.b"));
    expect(res.status).toBe(503);
  });

  it("requests without the param never enter the handshake", async () => {
    resolveManifestMock.mockResolvedValue(null);
    const { middleware } = await importMiddleware();
    await middleware(req("acme-labs.com", "/some-page"));
    expect(resolvePreviewByTokenMock).not.toHaveBeenCalled();
  });
});
