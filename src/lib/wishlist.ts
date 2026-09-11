import { z } from "zod";

/**
 * Client-side wishlist model — per-store, localStorage-backed, the GUEST
 * half of the wishlist (LOO-3138). A signed-in shopper's wishlist lives
 * server-side in persons; this is what a guest saves before they have an
 * account, and what gets MERGED into the server list on sign-in
 * (`use-wishlist.ts`). A wishlist entry is just an opaque product ref (the
 * catalog slug — the PDP identity within a store, mirroring `cart.ts`).
 *
 * NAMESPACING IS LOAD-BEARING (same reasoning as `cart.ts`): the storage key
 * is `fd_wishlist:{storeKey}`, never a bare key — two tenants on shared
 * localStorage must never see each other's saved products.
 */

export const WISHLIST_STORAGE_PREFIX = "fd_wishlist:";

export function wishlistStorageKey(storeKey: string): string {
  return `${WISHLIST_STORAGE_PREFIX}${storeKey}`;
}

const wishlistSchema = z.object({ refs: z.array(z.string()) });

export type Wishlist = z.infer<typeof wishlistSchema>;

export const EMPTY_WISHLIST: Wishlist = { refs: [] };

export function hasRef(wishlist: Wishlist, ref: string): boolean {
  return wishlist.refs.includes(ref);
}

/** Add a ref (union — pure, idempotent). */
export function addRef(wishlist: Wishlist, ref: string): Wishlist {
  if (wishlist.refs.includes(ref)) return wishlist;
  return { refs: [ref, ...wishlist.refs] };
}

/** Remove a ref — pure. */
export function removeRef(wishlist: Wishlist, ref: string): Wishlist {
  return { refs: wishlist.refs.filter((r) => r !== ref) };
}

/** Toggle a ref — pure. */
export function toggleRef(wishlist: Wishlist, ref: string): Wishlist {
  return hasRef(wishlist, ref) ? removeRef(wishlist, ref) : addRef(wishlist, ref);
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage can throw (privacy mode / blocked third-party context).
    return null;
  }
}

export function loadWishlist(
  storeKey: string,
  storage: StorageLike | null = defaultStorage(),
): Wishlist {
  if (!storage) return EMPTY_WISHLIST;
  const raw = storage.getItem(wishlistStorageKey(storeKey));
  if (!raw) return EMPTY_WISHLIST;
  try {
    return wishlistSchema.parse(JSON.parse(raw));
  } catch {
    // Corrupt/foreign payload → start clean rather than crash the store.
    return EMPTY_WISHLIST;
  }
}

export function saveWishlist(
  storeKey: string,
  wishlist: Wishlist,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  storage.setItem(wishlistStorageKey(storeKey), JSON.stringify(wishlist));
}

export function clearWishlist(
  storeKey: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  storage.removeItem(wishlistStorageKey(storeKey));
}
