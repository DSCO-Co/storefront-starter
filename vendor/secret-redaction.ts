/**
 * Secret redaction — flightdeck's extension to @dscodotco/core's `scrubPhi`.
 *
 * `scrubPhi` (packages/core/src/phi-redaction.ts) is the ONE canonical PHI/PII
 * redactor and this file does not fork it — it composes with it. What it adds
 * is a second, orthogonal class of sensitive value that isn't PHI at all:
 * platform credentials and payment-card material. Both must be gone before
 * anything leaves the process via Sentry, so `scrubSecretsAndPhi` (used by
 * sentry-scrub.ts's `beforeSend`) runs both passes.
 *
 * Shapes covered (see .env.example + modules/payments' NMI provider +
 * modules/merchant-billing's Stripe provider for where these live):
 *   - `fdk_...`  — merchant API credentials (modules/stores / provisioning)
 *   - `bik_...`  — beacon ingest tokens
 *   - `sk_...` / `rk_...` / `whsec_...` — Stripe secret/restricted/webhook keys
 *   - `Authorization: Bearer <token>` headers (any bearer value, not just the
 *     prefixes above — a future credential shape must not need a scrubber
 *     update to be covered)
 *   - `x-operator-token` / `x-storefront-token` header values
 *   - Postgres/Redis connection strings with embedded credentials
 *     (`postgres://user:pass@host`, `redis://user:pass@host`)
 *   - Card numbers (13-19 digits, optionally grouped) and CVV-shaped values —
 *     modules/payments' NMI provider posts `ccnumber`/`cvv` fields directly.
 */

export const SECRET_REDACTED = "[REDACTED_SECRET]";

const CREDENTIAL_TOKEN_PATTERN = /\b(?:fdk|bik|sk|rk|whsec)_[A-Za-z0-9_-]{6,}\b/g;
const BEARER_HEADER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const CONNECTION_STRING_PATTERN =
  /\b(postgres(?:ql)?|redis|mysql):\/\/[^\s"'<>]*:[^\s"'<>@]*@[^\s"'<>]+/gi;
const CARD_NUMBER_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const CVV_KEY_PATTERN = /\bcvv2?\b\s*[:=]?\s*\d{3,4}\b/gi;

const SECRET_STRING_PATTERNS = [
  CONNECTION_STRING_PATTERN,
  BEARER_HEADER_PATTERN,
  CREDENTIAL_TOKEN_PATTERN,
  CVV_KEY_PATTERN,
  CARD_NUMBER_PATTERN,
] as const;

/**
 * Header/field names whose VALUE is masked wholesale regardless of shape.
 * `[_-]` between words so both header casing (`x-operator-token`) and
 * object-key casing (`x_operator_token` / `xOperatorToken` normalized to
 * lowercase first) match the same entry.
 */
const SECRET_KEY_PATTERN =
  /(^|[_-])(authorization|x[_-]operator[_-]token|x[_-]storefront[_-]token|operator[_-]api[_-]token|storefront[_-]api[_-]token|session[_-]secret|nmi[_-]security[_-]key|stripe[_-].*key|outbound[_-]webhooks[_-]kek|resend[_-]api[_-]key|ccnumber|cvv2?|card[_-]?number)($|[_-])/i;

/** True when a key name itself identifies a secret/credential field. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key.toLowerCase());
}

/** Mask secret-shaped substrings (tokens, bearer headers, DSNs, card/cvv) in a string. */
export function redactSecretPatterns(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_STRING_PATTERNS) {
    redacted = redacted.replace(pattern, SECRET_REDACTED);
  }
  return redacted;
}

/**
 * Recursively scrub secret-shaped values from an arbitrary value. Mirrors
 * `scrubPhi`'s shape (key-based wholesale masking + value-based pattern
 * masking) so the two compose cleanly in sentry-scrub.ts.
 */
export function scrubSecrets(value: unknown, key?: string): unknown {
  if (key !== undefined && isSecretKey(key)) {
    return SECRET_REDACTED;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactSecretPatterns(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubSecrets(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const scrubbed: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(record)) {
      scrubbed[childKey] = scrubSecrets(childValue, childKey);
    }
    return scrubbed;
  }

  return value;
}
