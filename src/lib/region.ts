/**
 * Region resolution for cookie-consent targeting (LOO-3050 item 3).
 *
 * A store's `compliance.cookieConsent.regions` says WHERE the consent gate
 * is legally required to apply:
 * - "all"    → gate every visitor (the safe default);
 * - "eu-uk"  → gate only EU/EEA + UK visitors (GDPR/PECR);
 * - "us-ca"  → gate only California visitors (CCPA/CPRA).
 *
 * REGION SOURCE (documented, best-effort): the edge/CDN geo headers on the
 * inbound request — `x-vercel-ip-country` (ISO-3166 alpha-2) and, for
 * California, `x-vercel-ip-country-region` (subdivision code). These are set
 * by Vercel's edge network; behind a different CDN the same two headers are
 * commonly populated, and a plain `cf-ipcountry` (Cloudflare) is also read
 * as a fallback for the country. When NO geo signal is present the country
 * is `null` → "unknown", and a targeted gate FAILS CLOSED (gates the
 * visitor) rather than assuming they are outside the targeted region: an
 * unknown location is never rendered as "not covered".
 */

export type ConsentRegionTarget = "all" | "eu-uk" | "us-ca";

export type RequestGeo = {
  /** ISO-3166 alpha-2 country code (uppercased), or null when no geo signal. */
  readonly country: string | null;
  /** Subdivision code (e.g. "CA" for California), or null. */
  readonly region: string | null;
};

// EU/EEA + UK member-state alpha-2 codes.
const EU_EEA_UK = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "GB",
]);

/** A minimal header reader — both `Headers` and next/headers' ReadonlyHeaders satisfy it. */
export type HeaderReader = { get(name: string): string | null };

/** Read the CDN geo headers off a request. Header names are case-insensitive. */
export function resolveRequestGeo(headers: HeaderReader): RequestGeo {
  const country =
    headers.get("x-vercel-ip-country") ??
    headers.get("cf-ipcountry") ??
    headers.get("x-country") ??
    null;
  const region = headers.get("x-vercel-ip-country-region") ?? headers.get("x-region") ?? null;
  return {
    country: country ? country.trim().toUpperCase() : null,
    region: region ? region.trim().toUpperCase() : null,
  };
}

/**
 * The shopper's client IP, for the fraud floor's IP-scoped velocity + bans
 * (FD Epic 10). Reads the forwarded-for chain server-side (the leftmost hop
 * is the original client) with common CDN fallbacks. Returns null when no
 * source header is present — the checkout module then simply skips IP-scoped
 * screening rather than keying on a bogus value.
 */
export function resolveClientIp(headers: HeaderReader): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip") ?? headers.get("cf-connecting-ip");
  return real ? real.trim() : null;
}

/**
 * Does the store's region targeting require the consent gate for THIS
 * visitor's location? Fail-closed on unknown geo for any non-"all" target.
 */
export function regionRequiresConsent(target: ConsentRegionTarget, geo: RequestGeo): boolean {
  if (target === "all") return true;
  if (geo.country === null) return true; // unknown location → gate (fail-closed)
  if (target === "eu-uk") return EU_EEA_UK.has(geo.country);
  if (target === "us-ca") return geo.country === "US" && geo.region === "CA";
  return true;
}

/**
 * The single effective decision: is the cookie-consent gate ENFORCED for
 * this request? Only when the store enabled it AND the visitor's region is
 * targeted. When not enforced, non-essential tracking follows the
 * open-ecommerce default (allowed) — see `nonEssentialAllowed`.
 *
 * CALIFORNIA IS ALWAYS IN THE ENFORCED SET (consumer-compliance remediation
 * 2026-09-09, F8): CIPA liability does not care which regions a store chose
 * to target, so a `US-CA` visitor is consent-enforced even when the store's
 * `regions` config targets only `eu-uk`. The store's targeting choice can
 * narrow the gate elsewhere — never over California.
 *
 * KILL-SWITCH TIGHTENING (2026-09-09 wave 2): `storeHasTracking` says the
 * store actually tracks visitors client-side (`browserPixelEnabled` or a
 * configured pixel id — see `storeHasBrowserTracking`, lib/manifest.ts). A
 * store WITH tracking cannot opt out of consent enforcement by setting
 * `cookieConsent.enabled: false` — the disable flag is IGNORED and the
 * region targeting (incl. always-CA) decides. A store with no tracking
 * keeps the old behavior: enabled:false ⇒ never enforced.
 */
export function cookieConsentEnforced(
  cfg: { enabled: boolean; regions: ConsentRegionTarget },
  geo: RequestGeo,
  storeHasTracking = false,
): boolean {
  if (!cfg.enabled && !storeHasTracking) return false;
  const isCalifornia = geo.country === "US" && geo.region === "CA";
  return isCalifornia || regionRequiresConsent(cfg.regions, geo);
}
