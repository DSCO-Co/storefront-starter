/**
 * Client-side coupon-code stash (LOO-3156 coupon UI). The code a shopper
 * enters on the CART page rides here to the CHECKOUT form (per-store,
 * namespaced exactly like `lib/cart.ts` — the Leo↔Loop un-namespaced-key
 * incident is why every read/write goes through `couponStorageKey()`).
 *
 * This is a UI convenience only: the code is VALIDATED AND APPLIED
 * server-side at payment (commerce refuses unknown/inactive/exhausted codes
 * and enforces the manifest's never-discount SKU list in the money math).
 * Nothing here is a source of pricing truth.
 */

export const COUPON_STORAGE_PREFIX = "fd_coupon:";

export function couponStorageKey(storeKey: string): string {
  return `${COUPON_STORAGE_PREFIX}${storeKey}`;
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

export function loadCouponCode(
  storeKey: string,
  storage: StorageLike | null = defaultStorage(),
): string {
  if (!storage) return "";
  return (storage.getItem(couponStorageKey(storeKey)) ?? "").trim();
}

export function saveCouponCode(
  storeKey: string,
  code: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    storage.removeItem(couponStorageKey(storeKey));
    return;
  }
  storage.setItem(couponStorageKey(storeKey), trimmed);
}

export function clearCouponCode(
  storeKey: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  storage.removeItem(couponStorageKey(storeKey));
}
