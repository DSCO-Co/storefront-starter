/**
 * PostHog server-side capture — an ADDITIONAL analytics destination alongside
 * the beacon/Meta-CAPI funnel (`beacon-producer.ts`). It is deliberately
 * server-side and fired ONLY from the two consent-gated BFF fire points (the
 * `/api/track` funnel relay and the checkout ORDER_CONFIRMED fire), so it
 * inherits the exact same double-enforced cookie-consent gate and per-request
 * tenant resolution — no unconsented `posthog-js` ever ships to the browser,
 * and there is no second consent surface to keep in sync.
 *
 * QUIET BY DESIGN: unconfigured (`POSTHOG_KEY` unset) → a no-op singleton;
 * every capture is wrapped so a client throw can never break the page. Exactly
 * the fail-closed, non-essential posture the beacon producer takes.
 */

import { PostHog } from "posthog-node";
import { createLogger } from "@/lib/logger";

const logger = createLogger("posthog-producer");

/** `undefined` = not yet resolved; `null` = resolved-but-unconfigured. */
let cached: PostHog | null | undefined;

/** Singleton PostHog server client, or `null` when unconfigured. */
export function getPostHog(): PostHog | null {
  if (cached !== undefined) return cached;
  const key = process.env.POSTHOG_KEY;
  if (key === undefined || key.length === 0) {
    cached = null;
    return null;
  }
  const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
  cached = new PostHog(key, { host });
  return cached;
}

/** Whether PostHog server capture is configured (for tests / diagnostics). */
export function isPostHogConfigured(): boolean {
  return getPostHog() !== null;
}

/** The storefront funnel vocabulary, 1:1 with the beacon funnel + the purchase. */
export type PosthogEvent =
  | "VIEW_CONTENT"
  | "ADD_TO_CART"
  | "INITIATE_CHECKOUT"
  | "SEARCH"
  | "LEAD_CAPTURED"
  | "ORDER_CONFIRMED";

/** Stable, human-readable PostHog event names (the beacon keeps its own vocab). */
const EVENT_NAME: Record<PosthogEvent, string> = {
  VIEW_CONTENT: "product_viewed",
  ADD_TO_CART: "product_added_to_cart",
  INITIATE_CHECKOUT: "checkout_started",
  SEARCH: "search_performed",
  LEAD_CAPTURED: "lead_captured",
  ORDER_CONFIRMED: "order_completed",
};

/**
 * Fire-and-forget capture. NEVER throws and NEVER awaits — tracking is
 * non-essential and must not add latency to (or fail) the BFF response. The
 * store is attached as a PostHog group so per-tenant analytics slice cleanly.
 */
export function capturePosthog(params: {
  distinctId: string;
  tenantRef: string;
  event: PosthogEvent;
  properties?: Record<string, unknown>;
}): void {
  const client = getPostHog();
  if (client === null) return;
  try {
    client.capture({
      distinctId: params.distinctId,
      event: EVENT_NAME[params.event],
      groups: { store: params.tenantRef },
      properties: {
        tenant_ref: params.tenantRef,
        ...params.properties,
      },
    });
  } catch (err) {
    logger.error("posthog capture threw; ignoring (tracking is non-essential)", {
      tenantRef: params.tenantRef,
      event: params.event,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
