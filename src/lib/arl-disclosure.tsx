/**
 * The auto-renewal (ARL §17600 / ROSCA / FTC Click-to-Cancel) disclosure —
 * ONE versioned source of truth for both halves of the consent evidence
 * (C5, consumer-compliance remediation 2026-09-09):
 *
 *  - `<ArlDisclosure/>` renders EXACTLY `ARL_DISCLOSURE_TEXT` at checkout
 *    (CheckoutForm, above the subscribe opt-in — F9 ordering);
 *  - the checkout BFF hashes EXACTLY `ARL_DISCLOSURE_TEXT` (sha-256) into
 *    `subscriptionConsent.disclosureSha256` on every subscription-creating
 *    checkout.
 *
 * Because both read the same constant, the rendered copy and the hashed copy
 * cannot drift — `arl-disclosure.test.tsx` pins the rendered text to the
 * constant. CHANGING THE COPY IS A NEW VERSION: bump `ARL_DISCLOSURE_REF`
 * (…-v2) in the same change, never edit the text under an existing ref.
 */

/** Versioned disclosure ref persisted with the consent evidence (C5). */
export const ARL_DISCLOSURE_REF = "arl-disclosure-v1";

/** The exact clear-and-conspicuous auto-renewal terms, as ONE plain string. */
export const ARL_DISCLOSURE_TEXT =
  "Automatic renewal terms: if you choose Subscribe & Save, this is an automatically renewing " +
  "subscription. Your payment method will be charged the subscription price each refill period " +
  "until you cancel. There is no minimum term. You can cancel anytime from your account under " +
  "Subscriptions, or by contacting support, and cancellation takes effect before your next " +
  "charge. We will email you before each renewal.";

/**
 * The rendered disclosure — clear and conspicuous, ALWAYS visible when a
 * subscription option exists (never gated on the opt-in toggle being on),
 * rendered ABOVE the subscribe control (audit F9).
 */
export function ArlDisclosure() {
  return (
    <p
      data-testid="checkout-autorenew-disclosure"
      className="text-xs leading-relaxed"
      style={{
        color: "var(--color-text)",
        border: "1px solid var(--color-line, var(--color-border))",
        borderRadius: "var(--radius-card, 8px)",
        padding: "0.625rem 0.75rem",
      }}
    >
      {ARL_DISCLOSURE_TEXT}
    </p>
  );
}
