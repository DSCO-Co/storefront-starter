import "server-only";
import { notFound, redirect } from "next/navigation";
import { getAccountClient } from "@/lib/account-client";
import {
  getShopperSession,
  getShopperSessionStore,
  type ShopperSession,
} from "@/lib/account-session";
import { type ResolvedBehavior, resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";

/**
 * The route-level "wallet pattern" gate for the customer account surface
 * (LOO-3041). A disabled sub-flag makes the route answer as if the surface
 * does not exist (`notFound()` -> the store's 404), NOT merely hide UI — the
 * same posture the manifest's own docblocks describe for wishlist/email
 * capture/etc.
 *
 * `accounts.enabled` gates the WHOLE surface; `orderHistory`,
 * `addressBook`, `subscriptionSelfServe` gate their individual routes.
 */
export interface AccountContext {
  readonly tenantRef: string;
  readonly storeKey: string;
  readonly storeName: string;
  readonly accounts: ResolvedBehavior["accounts"];
  /**
   * Wishlist gate (LOO-3138) — a TOP-LEVEL behavior flag, not an `accounts`
   * sub-flag. The `/account/wishlist` page and its nav link are gated on this
   * in addition to `accounts.enabled`; false ⇒ both answer as absent.
   */
  readonly wishlistEnabled: boolean;
}

/**
 * Resolve the store for this request and assert the account surface exists
 * at all. 404s (never redirects) when: the host is unknown, the store is not
 * live, or `accounts.enabled` is false. Every account page/route starts here.
 */
export async function requireAccountSurface(): Promise<AccountContext> {
  const resolution = await getRequestManifest();
  if (resolution?.manifest.store.status !== "live") notFound();
  const behavior = resolveBehavior(resolution.manifest);
  if (!behavior.accounts.enabled) notFound();
  return {
    tenantRef: resolution.tenantRef,
    storeKey: resolution.manifest.catalog.storeKey,
    storeName: resolution.manifest.brand.name,
    accounts: behavior.accounts,
    wishlistEnabled: behavior.wishlist.enabled,
  };
}

/** Assert the wishlist surface is on, else 404 (route-level gate, LOO-3138). */
export function requireWishlist(ctx: AccountContext): void {
  if (!ctx.wishlistEnabled) notFound();
}

/** Assert a specific sub-flag is on, else 404 (route-level gate). */
export function requireAccountFlag(
  ctx: AccountContext,
  flag: "orderHistory" | "subscriptionSelfServe" | "addressBook",
): void {
  if (!ctx.accounts[flag]) notFound();
}

/**
 * The authenticated-shopper guard for `/account/*` pages. Returns the live
 * session, or REDIRECTS to `/account/login`. Re-verifies the session against
 * persons on entry so a revoked/expired session cannot reach any account
 * page even before the cookie's own TTL lapses — and a genuinely revoked
 * session has its stale cookie destroyed on the way out.
 *
 * A backend that is unreachable (verify `ok: false`) is NOT treated as
 * "signed out": the cookie is trusted for this render rather than bouncing a
 * real shopper to the login page on a transient blip (honest-absence — a
 * failed check is not a negative answer).
 */
export async function requireShopper(): Promise<ShopperSession> {
  const session = await getShopperSession();
  if (session === null) redirect("/account/login");
  // Defense-in-depth: a shopper session is scoped to ONE store. Assert the
  // session's tenant matches the Host-resolved tenant, so a session minted on
  // store A can never act on store B (security-audit-2026-09-01 #11). Not
  // exploitable while `sf_account` is host-only-scoped (no cookie Domain), but
  // this closes it if cookie scoping ever broadens (shared apex / subpath
  // tenancy). Only enforced on a genuine MISMATCH — a null resolution (unknown
  // host) is left to the page's own manifest guard, not treated as a bad session.
  const resolution = await getRequestManifest();
  if (resolution !== null && session.tenantRef !== resolution.tenantRef) {
    (await getShopperSessionStore()).destroy();
    redirect("/account/login");
  }
  const verified = await getAccountClient().verifySession(session.secret);
  if (verified.ok && verified.value === null) {
    // Definitively invalid (revoked/expired) — clear the stale cookie and bounce.
    const store = await getShopperSessionStore();
    store.destroy();
    redirect("/account/login");
  }
  return session;
}
