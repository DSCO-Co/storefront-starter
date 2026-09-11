/**
 * Funnel-gate tokens (P8) — Edge- and Node-safe (Web Crypto only). Two
 * cookies, two jobs:
 *
 *  - SESSION (`fd_gate`): short-lived admission, HMAC-signed, host- and
 *    tenant-claimed, optionally UA-bound. Sliding renewal past half-life,
 *    clamped by an absolute ceiling from the ORIGINAL admission instant
 *    (`ist`), with an outage-grace window after expiry — the structural fix
 *    for the "15-minute cookie bounces shoppers out of checkout" failure
 *    class observed in a production incident.
 *  - ADMIT (`fd_gate_admit`): long-lived, httpOnly proof that this browser
 *    passed the challenge before. READ at enforcement time (a prior
 *    implementation minted an equivalent and never read it) — a valid admit re-mints a session
 *    silently instead of re-challenging a returning visitor.
 *
 * Design rules ported deliberately:
 *  - verification ceiling is the platform MAX constant, not the tenant's
 *    current TTL — turning a tenant's TTL down never mass-invalidates
 *    live cookies;
 *  - expiry is checked LAST so an expired-but-authentic cookie is
 *    distinguishable (renewable) from a forged one;
 *  - signature compare is constant-time over fixed-length digests (a
 *    prior `constantTimeEqual` was not sound — do not copy it);
 *  - NO fallback secret, ever: an unset/short secret disables minting and
 *    verification entirely (fail toward the gate being OFF, never toward
 *    forgeable admissions).
 */

export const GATE_COOKIE = "fd_gate";
export const GATE_ADMIT_COOKIE = "fd_gate_admit";

/** Hard platform bounds — clamp tenant config, never trust it raw. */
export const GATE_MAX_TTL_SECONDS = 3600;
export const GATE_MIN_TTL_SECONDS = 60;
export const GATE_MAX_CEILING_HOURS = 72;
export const GATE_MAX_ADMIT_DAYS = 365;

export interface GateSessionClaims {
  readonly v: 1;
  readonly kind: "session";
  /** Tenant the admission belongs to (defense in depth over cookie-jar host scoping). */
  readonly t: string;
  /** Random session id (base64url). */
  readonly sid: string;
  /** Risk score at admission. */
  readonly risk: number;
  /** Sliding TTL seconds this session renews with (frozen at mint). */
  readonly ttl: number;
  /** Absolute ceiling seconds from ist (frozen at mint). */
  readonly ceil: number;
  readonly iat: number;
  /** Original admission instant — renewals copy it verbatim. */
  readonly ist: number;
  readonly exp: number;
  /** HMAC of the normalized user agent, when UA binding is on. */
  readonly uah?: string;
}

export interface GateAdmitClaims {
  readonly v: 1;
  readonly kind: "admit";
  readonly t: string;
  readonly iat: number;
  readonly exp: number;
}

export type GateSessionState =
  | { readonly state: "missing" }
  | { readonly state: "invalid" }
  | { readonly state: "valid"; readonly claims: GateSessionClaims; readonly staleBy: number }
  | {
      readonly state: "expired";
      readonly claims: GateSessionClaims;
      readonly expiredForSeconds: number;
    };

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** ≥32 chars or the gate has no signing capability at all. */
export function gateSecretUsable(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(sig);
}

/** Constant-time over fixed-length digests; length mismatch = not equal. */
function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** Normalized-UA HMAC (trim, collapse whitespace, lowercase, cap 512). */
export async function hashUserAgent(secret: string, userAgent: string): Promise<string> {
  const normalized = userAgent.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 512);
  if (normalized.length === 0) return "";
  return b64url(await hmac(secret, `ua:${normalized}`));
}

async function sign(secret: string, claims: object): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = b64url(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

async function open(secret: string, token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts as [string, string];
  const expected = await hmac(secret, payload);
  const supplied = b64urlDecode(sig);
  if (supplied === null || !digestsEqual(expected, supplied)) return null;
  const decoded = b64urlDecode(payload);
  if (decoded === null) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decoded));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface MintSessionInput {
  readonly tenantRef: string;
  readonly risk: number;
  readonly ttlSeconds: number;
  readonly ceilingHours: number;
  readonly userAgent: string | null;
  readonly bindUserAgent: boolean;
  readonly now: Date;
  /** Renewals carry the prior session's ist; fresh mints omit it. */
  readonly ist?: number;
  readonly sid?: string;
}

export async function mintGateSession(
  secret: string,
  input: MintSessionInput,
): Promise<string | null> {
  if (!gateSecretUsable(secret)) return null;
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  const ttl = Math.min(GATE_MAX_TTL_SECONDS, Math.max(GATE_MIN_TTL_SECONDS, input.ttlSeconds));
  const ceil = Math.min(GATE_MAX_CEILING_HOURS, Math.max(1, input.ceilingHours)) * 3600;
  const ist = input.ist ?? nowSeconds;
  // The absolute-ceiling clamp (ported verbatim in spirit): a renewal never
  // extends past ist + ceiling, and a mint at the ceiling still gets 1s so
  // the state machine sees "expired" not "invalid".
  const capRemaining = Math.max(0, ist + ceil - nowSeconds);
  const expiresIn = Math.max(1, Math.min(ttl, capRemaining));
  const sid = input.sid ?? b64url(crypto.getRandomValues(new Uint8Array(18)));
  const uah =
    input.bindUserAgent && input.userAgent !== null && input.userAgent.length > 0
      ? await hashUserAgent(secret, input.userAgent)
      : undefined;
  const claims: GateSessionClaims = {
    v: 1,
    kind: "session",
    t: input.tenantRef,
    sid,
    risk: input.risk,
    ttl,
    ceil,
    iat: nowSeconds,
    ist,
    exp: nowSeconds + expiresIn,
    ...(uah !== undefined && uah !== "" ? { uah } : {}),
  };
  return sign(secret, claims);
}

/**
 * Verify a session token. Order matters: signature → shape → UA binding →
 * expiry LAST (an authentic-but-lapsed session must surface as `expired`
 * with its claims so the caller can renew within grace).
 */
export async function verifyGateSession(
  secret: string | undefined,
  token: string | undefined,
  userAgent: string | null,
  now: Date,
): Promise<GateSessionState> {
  if (token === undefined || token.length === 0) return { state: "missing" };
  if (!gateSecretUsable(secret)) return { state: "invalid" };
  const raw = await open(secret, token);
  if (raw === null) return { state: "invalid" };
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const c = raw as Partial<GateSessionClaims>;
  if (
    c.v !== 1 ||
    c.kind !== "session" ||
    typeof c.t !== "string" ||
    c.t.length === 0 ||
    typeof c.sid !== "string" ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(c.sid) ||
    typeof c.risk !== "number" ||
    !Number.isInteger(c.risk) ||
    c.risk < 0 ||
    c.risk > 100 ||
    typeof c.ttl !== "number" ||
    c.ttl < GATE_MIN_TTL_SECONDS ||
    c.ttl > GATE_MAX_TTL_SECONDS ||
    typeof c.ceil !== "number" ||
    c.ceil <= 0 ||
    c.ceil > GATE_MAX_CEILING_HOURS * 3600 ||
    typeof c.iat !== "number" ||
    !Number.isInteger(c.iat) ||
    c.iat > nowSeconds + 30 ||
    typeof c.ist !== "number" ||
    !Number.isInteger(c.ist) ||
    c.ist > c.iat ||
    typeof c.exp !== "number" ||
    !Number.isInteger(c.exp) ||
    c.exp <= c.iat ||
    // Ceiling on any single window: the MAX constant + skew, never the
    // tenant's current setting — see the header note.
    c.exp - c.iat > GATE_MAX_TTL_SECONDS + 60
  ) {
    return { state: "invalid" };
  }
  const claims = c as GateSessionClaims;
  if (claims.uah !== undefined) {
    const expected = await hashUserAgent(secret, userAgent ?? "");
    if (expected === "" || expected !== claims.uah) return { state: "invalid" };
  }
  // Absolute ceiling from the ORIGINAL admission.
  if (nowSeconds - claims.ist >= claims.ceil) {
    return { state: "expired", claims, expiredForSeconds: Number.MAX_SAFE_INTEGER };
  }
  if (claims.exp <= nowSeconds) {
    return { state: "expired", claims, expiredForSeconds: nowSeconds - claims.exp };
  }
  return { state: "valid", claims, staleBy: claims.exp - nowSeconds };
}

/** Past half-life = renew on the next response (the sliding window). */
export function sessionNeedsRenewal(state: GateSessionState): boolean {
  return state.state === "valid" && state.staleBy < state.claims.ttl / 2;
}

export async function mintGateAdmit(
  secret: string,
  input: { tenantRef: string; admitDays: number; now: Date },
): Promise<string | null> {
  if (!gateSecretUsable(secret)) return null;
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  const days = Math.min(GATE_MAX_ADMIT_DAYS, Math.max(1, input.admitDays));
  const claims: GateAdmitClaims = {
    v: 1,
    kind: "admit",
    t: input.tenantRef,
    iat: nowSeconds,
    exp: nowSeconds + days * 86400,
  };
  return sign(secret, claims);
}

export async function verifyGateAdmit(
  secret: string | undefined,
  token: string | undefined,
  tenantRef: string,
  now: Date,
): Promise<boolean> {
  if (token === undefined || token.length === 0) return false;
  if (!gateSecretUsable(secret)) return false;
  const raw = await open(secret, token);
  if (raw === null) return false;
  const c = raw as Partial<GateAdmitClaims>;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return (
    c.v === 1 &&
    c.kind === "admit" &&
    c.t === tenantRef &&
    typeof c.iat === "number" &&
    c.iat <= nowSeconds + 30 &&
    typeof c.exp === "number" &&
    c.exp > nowSeconds &&
    c.exp - c.iat <= GATE_MAX_ADMIT_DAYS * 86400 + 60
  );
}
