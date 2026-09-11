import { createLogger } from "@/lib/logger";

/**
 * Cart-activity signal (FD Epic 16, abandoned-cart) — the storefront's
 * server-side write of a cart-changed ping into `marketing.cart_activity`.
 * The storefront cart is client-only (localStorage, lib/cart.ts), so
 * abandonment is undetectable server-side without this ping. Mirrors
 * `consent-store.ts`'s live/fixture seam exactly: `FLIGHTDECK_API_URL` set →
 * `LiveMarketingCartActivityGateway` (POSTs to the marketing module's
 * `/marketing/v1/marketing/cart-activity`, authenticated with the SAME
 * narrow `FLIGHTDECK_STOREFRONT_TOKEN` the checkout/consent BFFs hold —
 * never the platform-wide operator token); unset → `FixtureGateway`
 * (in-memory, so `pnpm dev`/`pnpm test` need no running app or DB).
 *
 * A storefront/surface owns NO schema (repo rule) — it never opens a DB
 * connection; the row is written by the marketing module over HTTP.
 *
 * EMAIL IS REQUIRED to record a signal: an abandoned cart is only
 * recoverable if there is an address to email. An anonymous cart with no
 * email yet is NOT recorded (the BFF route reports `recorded:false`) — an
 * honest "nothing to recover", never a row that can never be acted on.
 */

const logger = createLogger("cart-activity-store");

export interface CartActivityInput {
  readonly tenantRef: string;
  /** Stable per-cart id — the storefront's namespaced cart key / anon id. */
  readonly cartRef: string;
  /** The shopper subject id (anon id cookie today; a persons id once shopper-auth lands). */
  readonly subjectRef: string;
  readonly email: string;
  readonly itemCount: number;
  /** True on a conversion ping — flips the cart out of the abandonment set. */
  readonly checkedOut: boolean;
}

export type CartActivityOutcome =
  | { readonly outcome: "recorded" }
  /** The write FAILED — never rendered to the shopper as recorded. */
  | { readonly outcome: "error"; readonly message: string };

export interface CartActivityGateway {
  record(input: CartActivityInput): Promise<CartActivityOutcome>;
}

export class LiveMarketingCartActivityGateway implements CartActivityGateway {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly storefrontToken: string,
  ) {}

  async record(input: CartActivityInput): Promise<CartActivityOutcome> {
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl}/marketing/v1/marketing/cart-activity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-storefront-token": this.storefrontToken,
        },
        body: JSON.stringify({
          tenant_ref: input.tenantRef,
          cart_ref: input.cartRef,
          subject_ref: input.subjectRef,
          email: input.email,
          item_count: input.itemCount,
          checked_out: input.checkedOut,
        }),
        cache: "no-store",
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "cart-activity request failed";
      logger.error("cart-activity ping failed", { tenantRef: input.tenantRef, message });
      return { outcome: "error", message };
    }
    if (res.status === 201) return { outcome: "recorded" };
    logger.error("cart-activity ping returned non-201", {
      tenantRef: input.tenantRef,
      status: res.status,
    });
    return { outcome: "error", message: `cart-activity store returned HTTP ${res.status}` };
  }
}

/**
 * In-memory gateway for dev/tests. Records are retained so a test can assert
 * a ping WAS sent (never silently dropped). Deterministic — no randomness.
 */
export class FixtureCartActivityGateway implements CartActivityGateway {
  readonly records: CartActivityInput[] = [];

  record(input: CartActivityInput): Promise<CartActivityOutcome> {
    this.records.push(input);
    return Promise.resolve({ outcome: "recorded" });
  }
}

let liveGateway: LiveMarketingCartActivityGateway | null = null;
let fixtureGateway: FixtureCartActivityGateway | null = null;

/**
 * The single place that decides which gateway the storefront uses. Like
 * `getConsentGateway()`, live mode requires the storefront token — fails
 * loud (throws, naming the variable) rather than silently degrading to a
 * fixture that would drop the signal on the floor in production.
 */
export function getCartActivityGateway(): CartActivityGateway {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (!apiBaseUrl) {
    fixtureGateway ??= new FixtureCartActivityGateway();
    return fixtureGateway;
  }
  const storefrontToken = process.env.FLIGHTDECK_STOREFRONT_TOKEN;
  if (!storefrontToken) {
    throw new Error(
      "FLIGHTDECK_API_URL is set but FLIGHTDECK_STOREFRONT_TOKEN is not — refusing to send the cart-activity signal without it rather than silently dropping it",
    );
  }
  liveGateway ??= new LiveMarketingCartActivityGateway(
    apiBaseUrl.replace(/\/+$/, ""),
    storefrontToken,
  );
  return liveGateway;
}
