/**
 * Shopper referral capture (gap brief docs/briefs/referral-capture-gap-
 * 2026-09-06.md). A `?ref=<code>` landing param is captured by the storefront
 * middleware into a per-host, httpOnly first-party cookie; the checkout BFF
 * reads it SERVER-SIDE (never from the POST body) and threads it through
 * `@dscodotco/checkout` → commerce → `commerce.order.placed.v1` → the affiliates
 * consumer, which validates it against real affiliate rows. An unknown code
 * attributes nothing and never blocks a checkout.
 *
 * GATES (both fail-closed):
 *  - `behavior.referrals.enabled` — a store that never opted into referrals
 *    captures nothing and forwards nothing.
 *  - Cookie consent — capture uses the SAME `cookieConsentEnforced` ×
 *    `nonEssentialAllowed` predicate every other non-essential cookie/pixel
 *    uses (the brief does not exempt referral capture from consent, so it is
 *    NOT exempt): when the gate is enforced for the visitor's region and no
 *    explicit grant exists, no referral cookie is written.
 */

export const REFERRAL_COOKIE = "fd_ref";

/**
 * 30 days — the CAPTURE window (landing → first checkout on this browser).
 * Deliberately far shorter than affiliates' 400-day attribution bond: once a
 * first attributed order bonds the customer, the bond (not this cookie)
 * carries later orders.
 */
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Wire shape shared with `@dscodotco/checkout`'s parseReferralCode — keep in sync. */
const REFERRAL_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Normalize a raw `?ref=` value to a storable code, or null for anything
 * absent/oversized/malformed. Null is always a silent drop — a bad referral
 * param must never surface an error to the shopper.
 */
export function parseReferralParam(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return REFERRAL_CODE_RE.test(trimmed) ? trimmed : null;
}
