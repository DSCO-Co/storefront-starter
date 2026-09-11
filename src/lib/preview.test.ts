/**
 * Draft-preview primitives: the cross-tenant refusal decision, the shared-
 * host allowance, and the honest three-way outcome of token resolution —
 * `invalid` (a real 404 from the API) is never conflated with `unavailable`
 * (we could not find out), and neither ever renders as a live resolution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bioArchetype from "@/fixtures/manifests/store-0-bio-archetype.json";
import { isSharedPreviewHost, previewAllowedOnHost, resolvePreviewByToken } from "./preview";

describe("isSharedPreviewHost", () => {
  it("allows the shared onrender surface and local dev, with ports stripped", () => {
    expect(isSharedPreviewHost("flightdeck-storefront.onrender.com")).toBe(true);
    expect(isSharedPreviewHost("anything.onrender.com")).toBe(true);
    expect(isSharedPreviewHost("localhost:3600")).toBe(true);
    expect(isSharedPreviewHost("127.0.0.1:3600")).toBe(true);
  });

  it("refuses merchant domains", () => {
    expect(isSharedPreviewHost("acme-labs.com")).toBe(false);
    expect(isSharedPreviewHost("shop.acme-labs.com")).toBe(false);
    expect(isSharedPreviewHost("evil-onrender.com")).toBe(false);
  });
});

describe("previewAllowedOnHost", () => {
  it("on a host that resolves to a tenant, only that tenant's token is allowed", () => {
    const base = { hostname: "acme-labs.com", hostTenant: "acme-labs", pinnedTenant: null };
    expect(previewAllowedOnHost({ ...base, previewTenant: "acme-labs" })).toBe(true);
    expect(previewAllowedOnHost({ ...base, previewTenant: "leo-research" })).toBe(false);
  });

  it("on the shared onrender host (resolves nothing) any tenant's token is allowed", () => {
    const base = {
      hostname: "flightdeck-storefront.onrender.com",
      hostTenant: null,
      pinnedTenant: null,
    };
    expect(previewAllowedOnHost({ ...base, previewTenant: "acme-labs" })).toBe(true);
  });

  it("on an unresolvable NON-shared host nothing is allowed", () => {
    expect(
      previewAllowedOnHost({
        previewTenant: "acme-labs",
        hostname: "random-unverified.example",
        hostTenant: null,
        pinnedTenant: null,
      }),
    ).toBe(false);
  });

  it("an env-pinned deploy only previews its own store", () => {
    const base = { hostname: "whatever.vercel.app", hostTenant: null, pinnedTenant: "acme-labs" };
    expect(previewAllowedOnHost({ ...base, previewTenant: "acme-labs" })).toBe(true);
    expect(previewAllowedOnHost({ ...base, previewTenant: "leo-research" })).toBe(false);
  });
});

describe("resolvePreviewByToken", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("FLIGHTDECK_API_URL", "https://api.example");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function apiResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("resolves a valid token to the tokened manifest version — with no-store", async () => {
    fetchMock.mockResolvedValue(
      apiResponse(200, {
        tenantRef: "acme-labs",
        storeNumber: 1,
        status: "live",
        manifestVersion: 4,
        manifest: bioArchetype,
        preview: { version: 4, expiresAt: "2026-09-06T13:00:00.000Z" },
      }),
    );
    const outcome = await resolvePreviewByToken("fdpv_abc.def");
    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.resolution.tenantRef).toBe("acme-labs");
    expect(outcome.resolution.preview).toEqual({
      version: 4,
      expiresAt: "2026-09-06T13:00:00.000Z",
    });
    // The one fetch is no-store — preview must never populate a cache.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/stores/v1/preview-resolve?token=fdpv_abc.def",
      { cache: "no-store" },
    );
  });

  it("a 404 (expired/tampered) is `invalid` — a real refusal, not an error", async () => {
    fetchMock.mockResolvedValue(
      apiResponse(404, { error: { code: "invalid_preview_token", message: "expired" } }),
    );
    expect((await resolvePreviewByToken("fdpv_stale.tok")).kind).toBe("invalid");
  });

  it("transport failures and 5xx are `unavailable`, never `invalid`", async () => {
    fetchMock.mockRejectedValue(new Error("connect refused"));
    expect((await resolvePreviewByToken("fdpv_a.b")).kind).toBe("unavailable");

    fetchMock.mockResolvedValue(apiResponse(503, { error: { code: "resolve_unavailable" } }));
    expect((await resolvePreviewByToken("fdpv_a.b")).kind).toBe("unavailable");
  });

  it("an unparseable manifest payload is `unavailable` — never rendered", async () => {
    fetchMock.mockResolvedValue(
      apiResponse(200, {
        tenantRef: "acme-labs",
        manifest: { not: "a manifest" },
        preview: { version: 1, expiresAt: "2026-09-06T13:00:00.000Z" },
      }),
    );
    expect((await resolvePreviewByToken("fdpv_a.b")).kind).toBe("unavailable");
  });

  it("with no FLIGHTDECK_API_URL (fixture mode) preview is `unavailable`", async () => {
    vi.stubEnv("FLIGHTDECK_API_URL", "");
    expect((await resolvePreviewByToken("fdpv_a.b")).kind).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
