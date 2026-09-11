import { createLogger } from "@/lib/logger";

/**
 * Storefront beacon producer (LOO-3050 item 1) — the server-side fire of a
 * marketing/analytics event into the `beacon` module (Meta CAPI + the
 * per-destination dispatch ledger). Today it fires ONE event: an
 * `ORDER_CONFIRMED` (Purchase) on a placed checkout, from the checkout BFF
 * route.
 *
 * This is NON-ESSENTIAL tracking: it exists to attribute a conversion to an
 * ad platform. The checkout BFF gates every call to `dispatch()` on cookie
 * consent (`nonEssentialAllowed`) BEFORE constructing/sending it — so with
 * no consent, nothing here ever runs and no event leaves the BFF. The
 * producer itself is deliberately consent-UNAWARE: the gate lives at the
 * call site so the suppression is impossible to forget by adding a second
 * event type that skips an internal check.
 *
 * Live/fixture seam mirrors `lib/checkout.ts`: `FLIGHTDECK_API_URL` set →
 * `LiveBeaconProducer` (POSTs the batch to beacon's tenant-authed
 * `/v1/events` with a `bik_` ingest token); unset → `FixtureBeaconProducer`
 * (records dispatched events in-memory for tests, sends nothing).
 */

const logger = createLogger("beacon-producer");

const GLOBAL_TOKEN_VAR = "FLIGHTDECK_BEACON_INGEST_TOKEN";

/**
 * The per-tenant env var name holding a tenant's `bik_` beacon ingest token,
 * e.g. tenant `acme-labs` → `FLIGHTDECK_BEACON_INGEST_TOKEN_ACME_LABS`. The
 * storefront serves MANY tenants from ONE deployment (Host→tenant), so a
 * single global token can only ever be correct for one store — SEAM 3
 * resolves the token PER TENANT, mirroring the checkout `fdk_`/storefront-token
 * follow-up. Non-alphanumeric chars in the ref normalize to `_`.
 */
export function beaconTokenEnvKey(tenantRef: string): string {
  return `${GLOBAL_TOKEN_VAR}_${tenantRef.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

/**
 * Resolve a tenant's `bik_` ingest token: the per-tenant var first, then the
 * single-tenant global fallback. Returns null when neither is set for this
 * tenant — the caller MUST NOT fire with someone else's token (fail-closed:
 * no token → no dispatch, logged, never a wrong-tenant send).
 */
export function resolveBeaconIngestToken(
  tenantRef: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const perTenant = env[beaconTokenEnvKey(tenantRef)];
  if (perTenant !== undefined && perTenant.length > 0) return perTenant;
  const global = env[GLOBAL_TOKEN_VAR];
  return global !== undefined && global.length > 0 ? global : null;
}

/** Whether ANY beacon ingest token (global or any per-tenant) is configured. */
function hasAnyBeaconToken(env: Record<string, string | undefined>): boolean {
  return Object.entries(env).some(
    ([key, value]) => key.startsWith(GLOBAL_TOKEN_VAR) && value !== undefined && value.length > 0,
  );
}

export type BeaconPurchaseEvent = {
  readonly tenantRef: string;
  /** Deterministic event id (derived from the order) — beacon dedups on it. */
  readonly eventId: string;
  readonly occurredAt: string;
  readonly order: {
    readonly id: string;
    /** Order value in DOLLARS (beacon envelope convention). */
    readonly value: number;
    readonly currency: string;
    readonly products: ReadonlyArray<{ id: string; quantity: number }>;
  };
  readonly customer?: { readonly email?: string };
};

export type BeaconDispatchOutcome =
  | { readonly outcome: "accepted" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * The marketing/analytics FUNNEL event types the storefront emits from the
 * `/api/track` BFF (LOO-3050 follow-up). A CLOSED subset of beacon's intake
 * vocabulary (`modules/beacon/.../event-types.ts`) — `ORDER_CONFIRMED`
 * (Purchase) is kept out on purpose: it is the transactional post-order fire
 * from the checkout BFF (`dispatch()` above), never something the browser
 * asks for. The track route validates a client's `eventType` against THIS
 * list, so a caller can never coax the storefront into forwarding an
 * arbitrary beacon event.
 */
export const BEACON_FUNNEL_EVENT_TYPES = [
  "VIEW_CONTENT",
  "ADD_TO_CART",
  "INITIATE_CHECKOUT",
  "SEARCH",
  "LEAD_CAPTURED",
] as const;

export type BeaconFunnelEventType = (typeof BEACON_FUNNEL_EVENT_TYPES)[number];

export function isBeaconFunnelEventType(value: string): value is BeaconFunnelEventType {
  return (BEACON_FUNNEL_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * A funnel event bound for beacon. Everything a destination adapter needs
 * arrives IN the envelope (beacon is cookieless/server-side by design):
 *   - `order` carries value/currency/products for the commerce funnel legs
 *     (VIEW_CONTENT, ADD_TO_CART, INITIATE_CHECKOUT) — beacon maps it to
 *     Meta `custom_data` (value/currency/content_ids/contents/num_items).
 *   - `searchString` is the SEARCH query.
 *   - `customer.email` is the RAW LEAD_CAPTURED address — beacon hashes every
 *     identifier per adapter on egress (its `domain/hashing.ts`), the SAME
 *     posture as the ORDER_CONFIRMED customer email above; the storefront
 *     never hashes and never sends a hashed value beacon would double-hash.
 */
export type BeaconFunnelEvent = {
  readonly tenantRef: string;
  readonly eventType: BeaconFunnelEventType;
  /** Per-instance dedup id (funnel events have no natural key — minted per fire). */
  readonly eventId: string;
  readonly occurredAt: string;
  readonly order?: {
    /** Content/cart/product ref — beacon requires a non-empty order id. */
    readonly id: string;
    /** Value in DOLLARS (beacon envelope convention). */
    readonly value: number;
    readonly currency: string;
    readonly products: ReadonlyArray<{
      readonly id: string;
      readonly quantity: number;
      /** Unit price in DOLLARS. */
      readonly price?: number;
    }>;
  };
  /** SEARCH only — the shopper's query string. */
  readonly searchString?: string;
  /** LEAD_CAPTURED only — RAW email; beacon hashes on egress. */
  readonly customer?: { readonly email?: string };
};

export interface BeaconProducer {
  dispatch(event: BeaconPurchaseEvent): Promise<BeaconDispatchOutcome>;
  dispatchFunnel(event: BeaconFunnelEvent): Promise<BeaconDispatchOutcome>;
}

function toBatch(event: BeaconPurchaseEvent) {
  return {
    tenant_ref: event.tenantRef,
    events: [
      {
        eventId: event.eventId,
        eventType: "ORDER_CONFIRMED",
        occurredAt: event.occurredAt,
        order: {
          id: event.order.id,
          value: event.order.value,
          currency: event.order.currency,
          products: event.order.products.map((p) => ({ id: p.id, quantity: p.quantity })),
        },
        ...(event.customer ? { customer: event.customer } : {}),
        context: { actionSource: "website" },
      },
    ],
  };
}

/**
 * Build the ingest batch for a funnel event — the SAME wire shape as
 * `toBatch` (`{ tenant_ref, events: [envelope] }`), differing only in which
 * envelope fields the event carries. `actionSource: "website"` throughout:
 * every funnel leg is a real browser action, never system-generated.
 */
function funnelToBatch(event: BeaconFunnelEvent) {
  return {
    tenant_ref: event.tenantRef,
    events: [
      {
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        ...(event.order
          ? {
              order: {
                id: event.order.id,
                value: event.order.value,
                currency: event.order.currency,
                products: event.order.products.map((p) => ({
                  id: p.id,
                  quantity: p.quantity,
                  ...(p.price !== undefined ? { price: p.price } : {}),
                })),
              },
            }
          : {}),
        ...(event.searchString ? { metadata: { searchString: event.searchString } } : {}),
        ...(event.customer ? { customer: event.customer } : {}),
        context: { actionSource: "website" },
      },
    ],
  };
}

export class LiveBeaconProducer implements BeaconProducer {
  constructor(
    private readonly apiBaseUrl: string,
    /**
     * Resolves the ingest token for a given tenant (SEAM 3). Injected so the
     * per-tenant resolution is testable and this one deployment can fire for
     * many stores. Returns null when the tenant has no token configured.
     */
    private readonly resolveToken: (tenantRef: string) => string | null,
  ) {}

  dispatch(event: BeaconPurchaseEvent): Promise<BeaconDispatchOutcome> {
    return this.send(event.tenantRef, toBatch(event));
  }

  dispatchFunnel(event: BeaconFunnelEvent): Promise<BeaconDispatchOutcome> {
    return this.send(event.tenantRef, funnelToBatch(event));
  }

  /**
   * The one place a batch actually leaves for beacon — shared by the
   * purchase fire and the funnel fires so the per-tenant token resolution
   * (SEAM 3), the fail-closed no-token posture, and the 202-only success
   * contract are identical for every event type and can't drift apart.
   */
  private async send(tenantRef: string, batch: unknown): Promise<BeaconDispatchOutcome> {
    // SEAM 3: resolve THIS tenant's `bik_` token. A missing token fails
    // closed — we never fire with another tenant's credential — and is a
    // logged error, not a silent drop (the caller never fails on it).
    const ingestToken = this.resolveToken(tenantRef);
    if (ingestToken === null) {
      logger.error("beacon dispatch skipped: no ingest token for tenant", { tenantRef });
      return { outcome: "error", message: "no beacon ingest token configured for this tenant" };
    }
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl}/v1/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ingestToken}`,
        },
        body: JSON.stringify(batch),
        cache: "no-store",
      });
    } catch (cause) {
      logger.error("beacon dispatch fetch failed", { tenantRef, cause });
      return { outcome: "error", message: "could not reach beacon" };
    }
    if (res.status === 202) return { outcome: "accepted" };
    logger.error("beacon dispatch returned non-202", { tenantRef, status: res.status });
    return { outcome: "error", message: `beacon returned HTTP ${res.status}` };
  }
}

/**
 * In-memory beacon producer for dev/tests — records dispatched events so a
 * test can assert a fire DID (or, when consent-suppressed, did NOT) happen.
 * Sends nothing over the network.
 */
export class FixtureBeaconProducer implements BeaconProducer {
  readonly dispatched: BeaconPurchaseEvent[] = [];
  readonly funnelDispatched: BeaconFunnelEvent[] = [];

  dispatch(event: BeaconPurchaseEvent): Promise<BeaconDispatchOutcome> {
    this.dispatched.push(event);
    return Promise.resolve({ outcome: "accepted" });
  }

  dispatchFunnel(event: BeaconFunnelEvent): Promise<BeaconDispatchOutcome> {
    this.funnelDispatched.push(event);
    return Promise.resolve({ outcome: "accepted" });
  }
}

let liveProducer: LiveBeaconProducer | null = null;
let fixtureProducer: FixtureBeaconProducer | null = null;

/**
 * The single place that decides which BeaconProducer the storefront uses.
 * Live mode resolves a PER-TENANT `bik_` ingest token at dispatch time (SEAM
 * 3) via `resolveBeaconIngestToken` — the per-tenant var, then the global
 * fallback. If the deployment has NO beacon token configured at ALL (neither
 * global nor any per-tenant), we DON'T silently degrade to a no-op — that
 * means beacon egress is entirely unwired in production, so we throw (naming
 * the convention), the same fail-loud posture checkout.ts takes. A deployment
 * that has SOME tokens but is missing one for a particular tenant fails closed
 * per-dispatch (logged, order unaffected) rather than firing with the wrong
 * store's credential.
 */
export function getBeaconProducer(): BeaconProducer {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (!apiBaseUrl) {
    fixtureProducer ??= new FixtureBeaconProducer();
    return fixtureProducer;
  }
  if (!hasAnyBeaconToken(process.env)) {
    throw new Error(
      "FLIGHTDECK_API_URL is set but no beacon ingest token is configured (neither FLIGHTDECK_BEACON_INGEST_TOKEN nor any per-tenant FLIGHTDECK_BEACON_INGEST_TOKEN_<TENANT>) — refusing to run the beacon producer without it rather than silently degrading to a no-op",
    );
  }
  liveProducer ??= new LiveBeaconProducer(apiBaseUrl.replace(/\/+$/, ""), (tenantRef) =>
    resolveBeaconIngestToken(tenantRef),
  );
  return liveProducer;
}
