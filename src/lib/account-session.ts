/**
 * The SHOPPER (customer) session for the storefront — the customer-account
 * analog of `surfaces/portal/src/lib/session.ts`'s merchant iron-session.
 * LOO-3041.
 *
 * Mechanism, mirrored from the portal: an httpOnly, encrypted iron-session
 * cookie. What it holds differs — this is a SHOPPER (`persons.person`),
 * authenticated by persons' shopper magic-link (`/persons/v1/shopper-login/
 * *`), NOT a merchant user. The stored `shopperSessionSecret` is the Bearer
 * secret persons minted at exchange; the storefront BFF forwards it to
 * persons' shopper-scoped routes (addresses), and carries `personId` /
 * `tenantRef` (both set only from that verified exchange) to scope the
 * commerce order-history and payments card reads.
 *
 * Because the cookie is encrypted AND signed by iron-session, `personId` in
 * it is tamper-proof — a shopper can never edit it to read another shopper's
 * data. The `(account)/layout.tsx` guard additionally RE-VERIFIES the
 * session against persons on entry, so a revoked/expired session cannot
 * reach any account page even before the cookie's own TTL lapses.
 */
import "server-only";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface ShopperSessionData {
  /** The Bearer secret persons minted at exchange — forwarded to shopper-scoped routes. */
  shopperSessionSecret?: string;
  /** The DB-truth tenant slug this shopper belongs to (from the exchange response). */
  tenantRef?: string;
  /** The persons.person id — the ownership key for orders/addresses/cards. */
  personId?: string;
  email?: string;
  name?: string | null;
}

export interface ShopperSession {
  readonly secret: string;
  readonly tenantRef: string;
  readonly personId: string;
  readonly email: string;
  readonly name: string | null;
}

const COOKIE_NAME = "sf_account";

function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    // No empty-string/default secret, ever — fail loudly, name the variable,
    // at the moment a session is actually needed (never at module load, so
    // `next build`'s static analysis is unaffected). Same posture as the
    // portal session.
    throw new Error(
      "Missing or too-short SESSION_SECRET (needs >= 32 chars) — required to sign the shopper session cookie.",
    );
  }
  return {
    cookieName: COOKIE_NAME,
    password,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days — matches persons' shopper session TTL
    },
  };
}

export async function getShopperSessionStore(): Promise<IronSession<ShopperSessionData>> {
  return getIronSession<ShopperSessionData>(await cookies(), sessionOptions());
}

/**
 * The current shopper's identity, or null if not signed in. Returns null
 * ONLY when a required field is genuinely absent — a partially-written
 * cookie (missing any field) is treated as "not signed in", never as a
 * half-authenticated shopper.
 */
export async function getShopperSession(): Promise<ShopperSession | null> {
  const store = await getShopperSessionStore();
  if (
    store.shopperSessionSecret === undefined ||
    store.tenantRef === undefined ||
    store.personId === undefined ||
    store.email === undefined
  ) {
    return null;
  }
  return {
    secret: store.shopperSessionSecret,
    tenantRef: store.tenantRef,
    personId: store.personId,
    email: store.email,
    name: store.name ?? null,
  };
}

/**
 * A crash-safe "is this a signed-in shopper?" for PUBLIC pages (PLP/PDP) that
 * only need to know whether the wishlist heart should persist server-side vs
 * to localStorage. Unlike `requireShopper`, it never throws: if session infra
 * is unconfigured (e.g. SESSION_SECRET unset in a preview), it treats the
 * visitor as a guest — the safe default, since the guest wishlist persists
 * locally and merges once a real session exists, and protected `/account`
 * routes keep their own hard guard.
 */
export async function isShopperSignedIn(): Promise<boolean> {
  try {
    return (await getShopperSession()) !== null;
  } catch {
    return false;
  }
}
