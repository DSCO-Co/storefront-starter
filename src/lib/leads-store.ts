import { createLogger } from "@/lib/logger";

/**
 * Lead-capture signal (LOO-3132) — the storefront's server-side forward of an
 * email-capture submit into marketing's emailable `subjects` registry (and,
 * when the store's manifest names a welcome sequence, enrollment into it).
 * Mirrors `cart-activity-store.ts`'s live/fixture seam exactly:
 * `FLIGHTDECK_API_URL` set → `LiveMarketingLeadsGateway` (POSTs to the
 * marketing module's `/marketing/v1/marketing/leads`, authenticated with the
 * SAME narrow `FLIGHTDECK_STOREFRONT_TOKEN` the checkout/consent/cart BFFs
 * hold — never the platform-wide operator token); unset → `FixtureGateway`
 * (in-memory, so `pnpm dev`/`pnpm test` need no running app or DB).
 *
 * A storefront/surface owns NO schema (repo rule) — it never opens a DB
 * connection; the row is written by the marketing module over HTTP. A failed
 * forward is an ERROR outcome the route surfaces honestly — the shopper is
 * never told "you're on the list" over a write that didn't land.
 */

const logger = createLogger("leads-store");

export interface LeadInput {
  readonly tenantRef: string;
  readonly email: string;
  /** The shopper subject id (anon id cookie today; a persons id once shopper-auth lands). */
  readonly subjectRef: string;
  /** The store's welcome sequence (behavior.comms.emailCapture.sequenceRef), if any. */
  readonly campaignRef: string | null;
}

export type LeadOutcome =
  | { readonly outcome: "recorded" }
  /** The write FAILED — never rendered to the shopper as signed up. */
  | { readonly outcome: "error"; readonly message: string };

export interface LeadsGateway {
  record(input: LeadInput): Promise<LeadOutcome>;
}

export class LiveMarketingLeadsGateway implements LeadsGateway {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly storefrontToken: string,
  ) {}

  async record(input: LeadInput): Promise<LeadOutcome> {
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl}/marketing/v1/marketing/leads`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-storefront-token": this.storefrontToken,
        },
        body: JSON.stringify({
          tenant_ref: input.tenantRef,
          email: input.email,
          subject_ref: input.subjectRef,
          ...(input.campaignRef !== null ? { campaign_ref: input.campaignRef } : {}),
        }),
        cache: "no-store",
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "lead-capture request failed";
      logger.error("lead capture failed", { tenantRef: input.tenantRef, message });
      return { outcome: "error", message };
    }
    if (res.status === 201) return { outcome: "recorded" };
    logger.error("lead capture returned non-201", {
      tenantRef: input.tenantRef,
      status: res.status,
    });
    return { outcome: "error", message: `marketing leads route returned HTTP ${res.status}` };
  }
}

/**
 * In-memory gateway for dev/tests. Records are retained so a test can assert
 * a lead WAS forwarded (never silently dropped). Deterministic — no randomness.
 */
export class FixtureLeadsGateway implements LeadsGateway {
  readonly records: LeadInput[] = [];

  record(input: LeadInput): Promise<LeadOutcome> {
    this.records.push(input);
    return Promise.resolve({ outcome: "recorded" });
  }
}

let liveGateway: LiveMarketingLeadsGateway | null = null;
let fixtureGateway: FixtureLeadsGateway | null = null;

/**
 * The single place that decides which gateway the storefront uses. Like
 * `getCartActivityGateway()`, live mode requires the storefront token — fails
 * loud (throws, naming the variable) rather than silently degrading to a
 * fixture that would drop the signup on the floor in production.
 */
export function getLeadsGateway(): LeadsGateway {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (!apiBaseUrl) {
    fixtureGateway ??= new FixtureLeadsGateway();
    return fixtureGateway;
  }
  const storefrontToken = process.env.FLIGHTDECK_STOREFRONT_TOKEN;
  if (!storefrontToken) {
    throw new Error(
      "FLIGHTDECK_API_URL is set but FLIGHTDECK_STOREFRONT_TOKEN is not — refusing to forward the lead without it rather than silently dropping it",
    );
  }
  liveGateway ??= new LiveMarketingLeadsGateway(apiBaseUrl.replace(/\/+$/, ""), storefrontToken);
  return liveGateway;
}
