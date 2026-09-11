import { createLogger } from "@/lib/logger";

/**
 * Visitor fingerprint touch (marketing-hub port P7) — the storefront's
 * server-side write into the CDP's anonymous axis (`persons.anon_visitors`).
 * Fired from `/api/track` AFTER the consent gate passes, so a visitor is
 * only ever fingerprinted on the same legal footing as tracking itself.
 * Mirrors `consent-store.ts`'s live/fixture seam: `FLIGHTDECK_API_URL` set →
 * `LivePersonsVisitorGateway` (POSTs to `/persons/v1/persons/visitors` with
 * the narrow storefront token, forwarding the shopper's IP for server-side
 * HASHING — raw values never persist); unset → in-memory fixture.
 *
 * The planned Turnstile / Cloudflare Bot Management integration will attach
 * its verdicts to the same registry rows — this gateway is the intake it
 * annotates, not something it replaces.
 *
 * HONEST FAILURE: a touch is non-essential; a failed forward is logged and
 * reported as not-recorded, never laundered into success — but it also
 * never breaks tracking or the page.
 */

const logger = createLogger("visitor-store");

export interface VisitorTouchInput {
  readonly tenantRef: string;
  /** The first-party anon id (fd_sid) — the CDP's visitor_ref. */
  readonly visitorRef: string;
  readonly userAgent: string | null;
  /** Forwarded shopper IP (hashed server-side; never stored raw). */
  readonly clientIp: string | null;
  readonly language: string | null;
}

export type VisitorTouchOutcome =
  | { readonly outcome: "recorded" }
  | { readonly outcome: "error"; readonly message: string };

export interface VisitorGateway {
  touch(input: VisitorTouchInput): Promise<VisitorTouchOutcome>;
}

export class LivePersonsVisitorGateway implements VisitorGateway {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly storefrontToken: string,
  ) {}

  async touch(input: VisitorTouchInput): Promise<VisitorTouchOutcome> {
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl}/persons/v1/persons/visitors`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-storefront-token": this.storefrontToken,
          ...(input.clientIp !== null ? { "x-flightdeck-client-ip": input.clientIp } : {}),
        },
        body: JSON.stringify({
          tenant_ref: input.tenantRef,
          visitor_ref: input.visitorRef,
          ...(input.userAgent !== null ? { user_agent: input.userAgent } : {}),
          ...(input.language !== null ? { language: input.language } : {}),
        }),
        cache: "no-store",
      });
    } catch (cause) {
      logger.error("visitor touch fetch failed", { tenantRef: input.tenantRef, cause });
      return { outcome: "error", message: "could not reach the visitor store" };
    }
    if (res.status === 201) return { outcome: "recorded" };
    logger.error("visitor touch returned non-201", {
      tenantRef: input.tenantRef,
      status: res.status,
    });
    return { outcome: "error", message: `visitor store returned HTTP ${res.status}` };
  }
}

/** In-memory fixture so `pnpm dev`/tests need no running app. */
export class FixtureVisitorGateway implements VisitorGateway {
  readonly touches: VisitorTouchInput[] = [];
  async touch(input: VisitorTouchInput): Promise<VisitorTouchOutcome> {
    this.touches.push(input);
    return { outcome: "recorded" };
  }
}

let liveGateway: VisitorGateway | null = null;
let fixtureGateway: FixtureVisitorGateway | null = null;

export function getVisitorGateway(): VisitorGateway {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (!apiBaseUrl) {
    fixtureGateway ??= new FixtureVisitorGateway();
    return fixtureGateway;
  }
  const storefrontToken = process.env.FLIGHTDECK_STOREFRONT_TOKEN;
  if (!storefrontToken) {
    logger.error(
      "FLIGHTDECK_API_URL is set but FLIGHTDECK_STOREFRONT_TOKEN is not — refusing to send visitor touches without it rather than silently dropping them",
    );
    fixtureGateway ??= new FixtureVisitorGateway();
    return fixtureGateway;
  }
  liveGateway ??= new LivePersonsVisitorGateway(apiBaseUrl.replace(/\/+$/, ""), storefrontToken);
  return liveGateway;
}
