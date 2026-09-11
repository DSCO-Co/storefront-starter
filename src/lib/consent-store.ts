import { createLogger } from "@/lib/logger";

/**
 * Consent-record persistence (LOO-3050 item 2) — the storefront's
 * server-side write of a compliance artifact into `persons.consent_records`
 * (append-only). Mirrors `lib/checkout.ts`'s live/fixture seam exactly:
 * `FLIGHTDECK_API_URL` set → `LivePersonsConsentGateway` (POSTs to the
 * persons module's `/persons/v1/persons/consent`, authenticated with the SAME
 * narrow `FLIGHTDECK_STOREFRONT_TOKEN` the checkout BFF holds — never the
 * platform-wide operator token); unset → `FixtureConsentGateway`
 * (in-memory, so `pnpm dev`/`pnpm test` need no running app or DB).
 *
 * A storefront/surface owns NO schema (repo rule) — it never opens a DB
 * connection; the row is written by the persons module over HTTP.
 */

const logger = createLogger("consent-store");

export type ConsentSubject =
  /** A resolved shopper (persons.persons.id). Unused until this surface has shopper auth — the seam is here. */
  | { readonly type: "person"; readonly ref: string }
  /** An anonymous visitor bound to the first-party session/anon id cookie. */
  | { readonly type: "anon"; readonly ref: string };

export type RecordConsentInput = {
  readonly tenantRef: string;
  readonly subject: ConsentSubject;
  /**
   * The categories the subject GRANTED — a missing/false key is NOT consent.
   * The persons `consent_records.categories` column is an open string→boolean
   * map: cookie consent writes `{ analytics, marketing }`, the RUO checkout
   * acknowledgment writes `{ researchUseOnly }`. A missing/false key is not
   * consent (the persons module's `parseCategories` contract).
   */
  readonly categories: Readonly<Record<string, boolean>>;
  readonly region: string;
  readonly disclosureRef?: string | null;
  readonly source: string;
  readonly capturedAt: string;
};

export type RecordConsentOutcome =
  | { readonly outcome: "recorded"; readonly id: string }
  /** The write FAILED — never rendered to the shopper as "recorded". */
  | { readonly outcome: "error"; readonly message: string };

export interface ConsentGateway {
  record(input: RecordConsentInput): Promise<RecordConsentOutcome>;
}

export class LivePersonsConsentGateway implements ConsentGateway {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly storefrontToken: string,
  ) {}

  async record(input: RecordConsentInput): Promise<RecordConsentOutcome> {
    let res: Response;
    try {
      // NOTE(P7 fix): the app mounts every module under /<name> — this URL was
      // missing the /persons prefix, so live-mode banner consent 404'd and the
      // compliance row never persisted. The gateway logged it as an error (the
      // honest-failure contract held) but the evidence was still absent.
      res = await fetch(`${this.apiBaseUrl}/persons/v1/persons/consent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-storefront-token": this.storefrontToken,
        },
        body: JSON.stringify({
          tenant_ref: input.tenantRef,
          subject_type: input.subject.type,
          subject_ref: input.subject.ref,
          categories: input.categories,
          region: input.region,
          disclosure_ref: input.disclosureRef ?? null,
          source: input.source,
          captured_at: input.capturedAt,
        }),
        cache: "no-store",
      });
    } catch (cause) {
      logger.error("consent record fetch failed", { tenantRef: input.tenantRef, cause });
      return { outcome: "error", message: "could not reach consent store" };
    }
    if (res.status === 201) {
      const body = (await res.json().catch(() => null)) as { consent?: { id?: string } } | null;
      const id = body?.consent?.id;
      if (typeof id !== "string") {
        logger.error("consent record response missing id", { tenantRef: input.tenantRef });
        return { outcome: "error", message: "consent store returned no id" };
      }
      return { outcome: "recorded", id };
    }
    logger.error("consent record returned non-201", {
      tenantRef: input.tenantRef,
      status: res.status,
    });
    return { outcome: "error", message: `consent store returned HTTP ${res.status}` };
  }
}

/**
 * In-memory consent store for dev/tests. Records are retained on the
 * instance so a test can assert a row WAS appended (never silently
 * dropped). Deterministic ids — no randomUUID().
 */
export class FixtureConsentGateway implements ConsentGateway {
  readonly records: RecordConsentInput[] = [];
  private seq = 0;

  record(input: RecordConsentInput): Promise<RecordConsentOutcome> {
    this.records.push(input);
    this.seq += 1;
    return Promise.resolve({ outcome: "recorded", id: `fixture-consent-${this.seq}` });
  }
}

let liveGateway: LivePersonsConsentGateway | null = null;
let fixtureGateway: FixtureConsentGateway | null = null;

/**
 * The single place that decides which ConsentGateway the storefront uses.
 * Like `getCheckoutGateway()`, live mode requires the storefront token —
 * fails loud (throws, naming the variable) rather than silently degrading
 * to a fixture that would drop compliance rows on the floor in production.
 */
export function getConsentGateway(): ConsentGateway {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (!apiBaseUrl) {
    fixtureGateway ??= new FixtureConsentGateway();
    return fixtureGateway;
  }
  const storefrontToken = process.env.FLIGHTDECK_STOREFRONT_TOKEN;
  if (!storefrontToken) {
    throw new Error(
      "FLIGHTDECK_API_URL is set but FLIGHTDECK_STOREFRONT_TOKEN is not — refusing to record consent without it rather than silently dropping the compliance row",
    );
  }
  liveGateway ??= new LivePersonsConsentGateway(apiBaseUrl.replace(/\/+$/, ""), storefrontToken);
  return liveGateway;
}
