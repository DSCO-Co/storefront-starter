/**
 * The httpOnly / first-party cookies behind server-aware compliance
 * enforcement (LOO-3050). Kept in one place so the BFF routes that SET them
 * and the layout/checkout that READ them can never drift on a name.
 */

/**
 * Age-gate pass marker. httpOnly + set ONLY by the `/api/age-gate` route on
 * a server-validated affirmation — so client JS cannot forge it and a
 * reload re-checks it server-side (a cleared sessionStorage / reload cannot
 * bypass the gate). Value is an opaque marker; the fact of the cookie is
 * the signal.
 */
export const AGE_OK_COOKIE = "fd_age_ok";
export const AGE_OK_VALUE = "1";
/** 30 days — a passed age check persists across sessions on this device. */
export const AGE_OK_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * RUO-acknowledgment pass marker. httpOnly + set ONLY by the `/api/ruo-ack`
 * route on a server-validated affirmation — so client JS cannot forge it and a
 * scripted POST straight to `/api/checkout` cannot skip the affirmation (the
 * defect this closes: the RUO checkbox used to be client-only). Value is an
 * opaque marker; the fact of the cookie is the signal. Mirrors the age-gate
 * cookie exactly — the RUO disclaimer is a non-removable compliance surface
 * (see `RUO_DISCLAIMER`), so this gate is always-on, not per-store-configurable.
 */
export const RUO_OK_COOKIE = "fd_ruo_ok";
export const RUO_OK_VALUE = "1";
/** 30 days — a returning shopper's affirmation persists on this device (a fresh
 *  consent row is still appended per placed order, so the audit trail is
 *  per-order regardless of the cookie's lifetime). */
export const RUO_OK_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * First-party anonymous visitor id — the consent-record subject when no
 * shopper is authed. Not httpOnly (no security value; it only needs to be
 * stable and first-party). Minted by the consent route when absent.
 */
export const ANON_ID_COOKIE = "fd_sid";
export const ANON_ID_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** A minimal header reader — both `Headers` and next/headers' ReadonlyHeaders satisfy it. */
export type HeaderReader = { get(name: string): string | null };

/** Read a single cookie value from a request's `Cookie` header. */
export function readCookie(headers: HeaderReader, name: string): string | null {
  const header = headers.get("cookie");
  if (!header) return null;
  for (const part of header.split("; ")) {
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }
  return null;
}

/** Has the visitor passed the age gate on this device? (httpOnly cookie present.) */
export function hasAgePass(headers: HeaderReader): boolean {
  return readCookie(headers, AGE_OK_COOKIE) === AGE_OK_VALUE;
}

/** Has the visitor affirmed the RUO acknowledgment on this device? (httpOnly cookie present.) */
export function hasRuoAck(headers: HeaderReader): boolean {
  return readCookie(headers, RUO_OK_COOKIE) === RUO_OK_VALUE;
}
