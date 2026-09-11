import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FixtureBeaconProducer, getBeaconProducer } from "@/lib/beacon-producer";

const getRequestManifestMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));

async function importRoute() {
  return import("./route");
}

function req(body: unknown, cookie?: string, extraHeaders?: Record<string, string>) {
  return new Request("http://storefront.test/api/track", {
    method: "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(extraHeaders ?? {}) },
    body: JSON.stringify(body),
  });
}

/** A live store that does NOT enforce cookie consent — non-essential allowed
 *  by the open-ecommerce default (mirrors `nonEssentialAllowed(false, …)`). */
const CONSENT_OPEN = {
  tenantRef: "acme-labs",
  manifest: {
    store: { status: "live" },
    catalog: { storeKey: "acme-labs" },
    behavior: { compliance: { cookieConsent: { enabled: false } } },
  },
};

/** A live store that ENFORCES cookie consent for all regions — nothing fires
 *  without an explicit `granted` cookie. */
const CONSENT_ENFORCED = {
  tenantRef: "acme-labs",
  manifest: {
    store: { status: "live" },
    catalog: { storeKey: "acme-labs" },
    behavior: { compliance: { cookieConsent: { enabled: true, regions: "all" } } },
  },
};

// The route (FLIGHTDECK_API_URL unset in tests) shares this in-memory producer.
const fixture = getBeaconProducer() as FixtureBeaconProducer;

describe("POST /api/track", () => {
  beforeEach(() => {
    fixture.funnelDispatched.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("404s an unknown host rather than guessing a tenant", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    const res = await POST(req({ eventType: "SEARCH", query: "bpc" }));
    expect(res.status).toBe(404);
    expect(fixture.funnelDispatched).toHaveLength(0);
  });

  it("forwards a funnel event to beacon WITH consent (store not enforcing)", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "VIEW_CONTENT", productId: "var-1", priceCents: 4500 }),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(1);
    const event = fixture.funnelDispatched[0];
    expect(event?.tenantRef).toBe("acme-labs");
    expect(event?.eventType).toBe("VIEW_CONTENT");
    // Cents → dollars in the envelope; content id lines up with the product.
    expect(event?.order).toEqual({
      id: "var-1",
      value: 45,
      currency: "usd",
      products: [{ id: "var-1", quantity: 1, price: 45 }],
    });
  });

  it("forwards a SEARCH event's query string", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    const res = await POST(req({ eventType: "SEARCH", query: "  bpc-157  " }));
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched[0]?.searchString).toBe("bpc-157");
  });

  it("forwards a LEAD_CAPTURED event's RAW email (beacon hashes on egress)", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    await POST(req({ eventType: "LEAD_CAPTURED", email: "jane@example.test" }));
    expect(fixture.funnelDispatched[0]?.customer).toEqual({ email: "jane@example.test" });
  });

  it("suppresses (204, nothing forwarded) when consent is enforced and NOT granted", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_ENFORCED);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "VIEW_CONTENT", productId: "var-1", priceCents: 4500 }),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(0);
  });

  it("forwards when consent is enforced AND explicitly granted", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_ENFORCED);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "SEARCH", query: "tb500" }, "fd_consent=granted|banner|2026-01-01"),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(1);
  });

  // ── E5 consent granularity (2026-09-09 wave 2) ──────────────────────────

  it("analytics-only consent suppresses the beacon (advertising/CAPI) dispatch", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_ENFORCED);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "SEARCH", query: "tb500" }, "fd_consent=denied|banner|2026-01-01|10"),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(0);
  });

  it("advertising consent (split cookie '01') still dispatches to beacon", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_ENFORCED);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "SEARCH", query: "tb500" }, "fd_consent=granted|banner|2026-01-01|01"),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(1);
  });

  // ── kill-switch tightening (2026-09-09 wave 2) ──────────────────────────

  it("a store WITH pixels cannot opt out of enforcement via cookieConsent.enabled:false", async () => {
    getRequestManifestMock.mockResolvedValue({
      tenantRef: "acme-labs",
      manifest: {
        store: { status: "live" },
        catalog: { storeKey: "acme-labs" },
        refs: { secretsRef: "s", pixels: { meta: "123456789" } },
        behavior: {
          compliance: { cookieConsent: { enabled: false } },
          analytics: { browserPixelEnabled: true },
        },
      },
    });
    const { POST } = await importRoute();
    // No consent cookie → enforcement (forced on by the tracking config)
    // suppresses the fire; the old enabled:false shortcut no longer applies.
    const res = await POST(req({ eventType: "SEARCH", query: "bpc" }));
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(0);
    // An explicit grant still fires.
    const granted = await POST(
      req({ eventType: "SEARCH", query: "bpc" }, "fd_consent=granted|banner|2026-01-01"),
    );
    expect(granted.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(1);
  });

  // ── Global Privacy Control (compliance remediation 2026-09-09, F1/D1) ───

  it("suppresses (204, nothing forwarded) on Sec-GPC: 1 with no consent cookie — even on a non-enforcing store", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "VIEW_CONTENT", productId: "var-1", priceCents: 4500 }, undefined, {
        "sec-gpc": "1",
      }),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(0);
  });

  it("Sec-GPC: 1 wins over a GRANTED consent cookie (stateless opt-out, per-request)", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_ENFORCED);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "SEARCH", query: "tb500" }, "fd_consent=granted|banner|2026-01-01", {
        "sec-gpc": "1",
      }),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(0);
  });

  it("a non-'1' Sec-GPC value is not an opt-out", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "SEARCH", query: "bpc" }, undefined, { "sec-gpc": "0" }),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(1);
  });

  it("no-ops (204, nothing forwarded) an unknown eventType", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    const res = await POST(req({ eventType: "ORDER_CONFIRMED", order: { id: "o-1" } }));
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(0);
  });

  it("no-ops a malformed payload rather than sending a half-formed envelope", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    // VIEW_CONTENT with no productId — can't be shaped faithfully.
    const res = await POST(req({ eventType: "VIEW_CONTENT", priceCents: 4500 }));
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(0);
  });

  // ── client-minted dedup event id (browser-pixel gap brief 2026-09-06) ───

  it("uses the client-minted eventId verbatim so the browser pixel and CAPI legs dedupe", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    const eventId = "srch_2f1f5a1e-0000-4000-8000-000000000001";
    const res = await POST(req({ eventType: "SEARCH", query: "bpc", eventId }));
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(1);
    expect(fixture.funnelDispatched[0]?.eventId).toBe(eventId);
  });

  it("rejects a client eventId with the WRONG per-type prefix and mints its own", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "SEARCH", query: "bpc", eventId: "vc_smuggled-cross-type-id" }),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched[0]?.eventId).toMatch(/^srch_/);
    expect(fixture.funnelDispatched[0]?.eventId).not.toBe("vc_smuggled-cross-type-id");
  });

  it("rejects a beacon-shape-invalid client eventId and mints its own", async () => {
    getRequestManifestMock.mockResolvedValue(CONSENT_OPEN);
    const { POST } = await importRoute();
    const res = await POST(
      req({ eventType: "SEARCH", query: "bpc", eventId: `srch_${"x".repeat(100)}` }),
    );
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched[0]?.eventId).toMatch(/^srch_/);
    expect((fixture.funnelDispatched[0]?.eventId ?? "").length).toBeLessThanOrEqual(64);
  });

  it("no-ops a non-live store without ever tracking", async () => {
    getRequestManifestMock.mockResolvedValue({
      ...CONSENT_OPEN,
      manifest: { ...CONSENT_OPEN.manifest, store: { status: "draft" } },
    });
    const { POST } = await importRoute();
    const res = await POST(req({ eventType: "SEARCH", query: "bpc" }));
    expect(res.status).toBe(204);
    expect(fixture.funnelDispatched).toHaveLength(0);
  });
});
