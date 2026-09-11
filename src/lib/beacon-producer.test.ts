import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BeaconFunnelEvent,
  beaconTokenEnvKey,
  FixtureBeaconProducer,
  getBeaconProducer,
  isBeaconFunnelEventType,
  LiveBeaconProducer,
  resolveBeaconIngestToken,
} from "@/lib/beacon-producer";

const EVENT = {
  tenantRef: "acme-labs",
  eventId: "order_o-1",
  occurredAt: "2026-08-31T00:00:00.000Z",
  order: { id: "o-1", value: 45, currency: "usd", products: [{ id: "var-1", quantity: 1 }] },
};

describe("resolveBeaconIngestToken (SEAM 3: per-tenant bik_ token)", () => {
  it("derives the per-tenant env var name, normalizing the ref", () => {
    expect(beaconTokenEnvKey("acme-labs")).toBe("FLIGHTDECK_BEACON_INGEST_TOKEN_ACME_LABS");
  });

  it("prefers the per-tenant token over the global fallback", () => {
    const token = resolveBeaconIngestToken("acme-labs", {
      FLIGHTDECK_BEACON_INGEST_TOKEN: "bik_global",
      FLIGHTDECK_BEACON_INGEST_TOKEN_ACME_LABS: "bik_acme",
    });
    expect(token).toBe("bik_acme");
  });

  it("falls back to the global token for a single-tenant deployment", () => {
    const token = resolveBeaconIngestToken("acme-labs", {
      FLIGHTDECK_BEACON_INGEST_TOKEN: "bik_global",
    });
    expect(token).toBe("bik_global");
  });

  it("is null when no token is configured for the tenant (fail-closed)", () => {
    expect(resolveBeaconIngestToken("acme-labs", {})).toBeNull();
    // Another tenant's token does NOT resolve for this one.
    expect(
      resolveBeaconIngestToken("acme-labs", {
        FLIGHTDECK_BEACON_INGEST_TOKEN_OTHER_STORE: "bik_other",
      }),
    ).toBeNull();
  });
});

describe("LiveBeaconProducer (SEAM 3)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fires with the RESOLVED per-tenant token in the Authorization header", async () => {
    let sentAuth = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sentAuth = headers.authorization ?? "";
        return new Response(null, { status: 202 });
      }),
    );
    const producer = new LiveBeaconProducer("https://api.test", (t) =>
      t === "acme-labs" ? "bik_acme" : null,
    );
    const outcome = await producer.dispatch(EVENT);
    expect(outcome.outcome).toBe("accepted");
    expect(sentAuth).toBe("Bearer bik_acme");
  });

  it("FAILS CLOSED (no fetch) when the tenant has no token — never a wrong-tenant send", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const producer = new LiveBeaconProducer("https://api.test", () => null);
    const outcome = await producer.dispatch(EVENT);
    expect(outcome.outcome).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("isBeaconFunnelEventType (the track route's allowlist)", () => {
  it("accepts the five funnel types and rejects everything else", () => {
    for (const type of [
      "VIEW_CONTENT",
      "ADD_TO_CART",
      "INITIATE_CHECKOUT",
      "SEARCH",
      "LEAD_CAPTURED",
    ]) {
      expect(isBeaconFunnelEventType(type)).toBe(true);
    }
    // ORDER_CONFIRMED is a real beacon type but NOT a client-triggerable funnel one.
    expect(isBeaconFunnelEventType("ORDER_CONFIRMED")).toBe(false);
    expect(isBeaconFunnelEventType("nope")).toBe(false);
  });
});

describe("FixtureBeaconProducer.dispatchFunnel", () => {
  it("records each funnel eventType with its envelope shape", async () => {
    const producer = new FixtureBeaconProducer();
    const events: BeaconFunnelEvent[] = [
      {
        tenantRef: "acme-labs",
        eventType: "VIEW_CONTENT",
        eventId: "vc_1",
        occurredAt: "2026-09-01T00:00:00.000Z",
        order: {
          id: "var-1",
          value: 45,
          currency: "usd",
          products: [{ id: "var-1", quantity: 1, price: 45 }],
        },
      },
      {
        tenantRef: "acme-labs",
        eventType: "SEARCH",
        eventId: "srch_1",
        occurredAt: "2026-09-01T00:00:00.000Z",
        searchString: "bpc-157",
      },
      {
        tenantRef: "acme-labs",
        eventType: "LEAD_CAPTURED",
        eventId: "lead_1",
        occurredAt: "2026-09-01T00:00:00.000Z",
        customer: { email: "jane@example.test" },
      },
    ];
    for (const event of events) {
      const outcome = await producer.dispatchFunnel(event);
      expect(outcome.outcome).toBe("accepted");
    }
    expect(producer.funnelDispatched.map((e) => e.eventType)).toEqual([
      "VIEW_CONTENT",
      "SEARCH",
      "LEAD_CAPTURED",
    ]);
    expect(producer.funnelDispatched[1]?.searchString).toBe("bpc-157");
    expect(producer.funnelDispatched[2]?.customer?.email).toBe("jane@example.test");
    // The purchase channel stays separate from the funnel channel.
    expect(producer.dispatched).toHaveLength(0);
  });
});

describe("LiveBeaconProducer.dispatchFunnel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the funnel event as a batch with the resolved per-tenant token", async () => {
    let sentBody: unknown = null;
    let sentAuth = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sentAuth = headers.authorization ?? "";
        sentBody = JSON.parse(String(init?.body));
        return new Response(null, { status: 202 });
      }),
    );
    const producer = new LiveBeaconProducer("https://api.test", (t) =>
      t === "acme-labs" ? "bik_acme" : null,
    );
    const outcome = await producer.dispatchFunnel({
      tenantRef: "acme-labs",
      eventType: "ADD_TO_CART",
      eventId: "atc_1",
      occurredAt: "2026-09-01T00:00:00.000Z",
      order: {
        id: "var-1",
        value: 45,
        currency: "usd",
        products: [{ id: "var-1", quantity: 1, price: 45 }],
      },
    });
    expect(outcome.outcome).toBe("accepted");
    expect(sentAuth).toBe("Bearer bik_acme");
    expect(sentBody).toEqual({
      tenant_ref: "acme-labs",
      events: [
        {
          eventId: "atc_1",
          eventType: "ADD_TO_CART",
          occurredAt: "2026-09-01T00:00:00.000Z",
          order: {
            id: "var-1",
            value: 45,
            currency: "usd",
            products: [{ id: "var-1", quantity: 1, price: 45 }],
          },
          context: { actionSource: "website" },
        },
      ],
    });
  });
});

describe("getBeaconProducer configuration guard", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns the fixture producer when FLIGHTDECK_API_URL is unset (dev/test)", () => {
    delete process.env.FLIGHTDECK_API_URL;
    // The fixture producer records dispatches; it never sends.
    expect(getBeaconProducer()).toBeDefined();
  });

  it("throws (fail-loud) when live but NO beacon token is configured at all", () => {
    process.env.FLIGHTDECK_API_URL = "https://api.test";
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("FLIGHTDECK_BEACON_INGEST_TOKEN")) delete process.env[key];
    }
    expect(() => getBeaconProducer()).toThrow(/no beacon ingest token is configured/);
  });
});
