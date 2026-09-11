import { CONSENT_COOKIE, clientGpcDenied, parseConsentCookie } from "@/lib/consent";

/**
 * Client half of the abandoned-cart signal (FD Epic 16) — the piece that was
 * MISSING: `/api/cart-activity` existed with no caller, so the marketing
 * module's abandoned-cart sweep had no rows to scan. This fires the ping:
 *
 *  - on every cart mutation (add / quantity change / remove — wired in
 *    `use-cart.ts`), DEBOUNCED so a burst of quantity clicks collapses into
 *    one ping;
 *  - on checkout start and on email entry (wired in `CheckoutForm`), where
 *    the shopper's typed email becomes known;
 *  - on conversion (`checkedOut: true`, after a placed order), which flips
 *    the cart out of the abandonment working set.
 *
 * EMAIL & CONSENT: the client sends an email only when it genuinely knows
 * one (the checkout form's typed address). A signed-in shopper's email is
 * resolved SERVER-SIDE by the BFF from the httpOnly session — never readable
 * here. Consent is double-enforced exactly like `track.ts`: this helper
 * short-circuits when the store enforces cookie consent and the visitor
 * hasn't granted (marketing email capture is non-essential), and the BFF
 * re-derives the same gate as the authority — the client check is only an
 * optimization.
 *
 * HONEST FAILURE: the ping is non-essential to shopping. Every path is
 * fire-and-forget and swallows its own errors — it must never throw into a
 * render or click handler. (The BFF logs a failed forward; it is never
 * reported to the marketing store as recorded.)
 */

const CART_REF_STORAGE_PREFIX = "fd_cart_ref:";

export function cartRefStorageKey(storeKey: string): string {
  return `${CART_REF_STORAGE_PREFIX}${storeKey}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The stable per-cart id every ping for this cart carries — minted once and
 * kept until the cart CONVERTS (`clearCartRef` after a checked-out ping), so
 * the marketing store's one-row-per-(tenant, cart) upsert coalesces a whole
 * shopping session, and the next cart gets a fresh ref instead of reviving a
 * converted one.
 */
export function getOrCreateCartRef(
  storeKey: string,
  storage: StorageLike | null = defaultStorage(),
): string | null {
  if (!storage) return null;
  const key = cartRefStorageKey(storeKey);
  const existing = storage.getItem(key);
  if (existing !== null && existing.length > 0) return existing;
  const minted = `cart_${
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${storeKey}`
  }`;
  storage.setItem(key, minted);
  return minted;
}

/** Retire the cart ref after conversion — the next cart is a new cart. */
export function clearCartRef(
  storeKey: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  storage?.removeItem(cartRefStorageKey(storeKey));
}

/**
 * Mirror of the server `nonEssentialAllowed(enforced, signal)` gate from what
 * the browser can see — identical to `track.ts`'s predicate: enforcement is
 * stamped on `<body data-consent-required>` by the layout; the grant lives in
 * the `fd_consent` cookie. Non-enforcing stores always pass.
 */
function clientConsentAllows(): boolean {
  if (typeof document === "undefined") return false;
  // Global Privacy Control wins over everything, cookie included (F1).
  if (clientGpcDenied()) return false;
  const enforced = document.body?.dataset.consentRequired === "1";
  if (!enforced) return true;
  const raw = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  const signal = parseConsentCookie(raw ? decodeURIComponent(raw) : null);
  return signal?.adTracking === "granted";
}

export interface CartActivityPing {
  readonly cartRef: string;
  readonly itemCount: number;
  /** Only when genuinely known (the checkout form's typed address). */
  readonly email?: string;
  /** Conversion ping — flips the cart out of the abandonment set. */
  readonly checkedOut?: boolean;
}

type FetchLike = (url: string, init: RequestInit) => Promise<unknown>;

function defaultFetch(): FetchLike | null {
  if (typeof fetch === "undefined") return null;
  return (url, init) => fetch(url, init);
}

/** Fire one ping immediately (checkout start / email known / conversion). */
export function pingCartActivity(
  ping: CartActivityPing,
  fetchFn: FetchLike | null = defaultFetch(),
): void {
  try {
    if (!clientConsentAllows() || fetchFn === null) return;
    void Promise.resolve(
      fetchFn("/api/cart-activity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cartRef: ping.cartRef,
          itemCount: ping.itemCount,
          ...(ping.email !== undefined && ping.email.trim().length > 0
            ? { email: ping.email.trim() }
            : {}),
          ...(ping.checkedOut === true ? { checkedOut: true } : {}),
        }),
        // Survive the navigation a conversion/mutation ping may race with.
        keepalive: true,
      }),
    ).catch(() => {
      // Non-essential — a failed ping is invisible to the shopper by design.
    });
  } catch {
    // Never throw into the caller's render/handler.
  }
}

/** One pending trailing-edge timer per store — a burst of cart edits sends one ping. */
const pendingByStore = new Map<string, ReturnType<typeof setTimeout>>();

export const CART_ACTIVITY_DEBOUNCE_MS = 1500;

/**
 * Debounced mutation ping (trailing edge): repeated cart edits within the
 * window collapse into ONE ping carrying the latest item count. Per-store —
 * two stores in one tab never coalesce.
 */
export function scheduleCartActivityPing(
  storeKey: string,
  ping: CartActivityPing,
  options: {
    fetchFn?: FetchLike | null;
    debounceMs?: number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
  } = {},
): void {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const existing = pendingByStore.get(storeKey);
  if (existing !== undefined) clearTimer(existing);
  pendingByStore.set(
    storeKey,
    setTimer(() => {
      pendingByStore.delete(storeKey);
      pingCartActivity(ping, options.fetchFn === undefined ? defaultFetch() : options.fetchFn);
    }, options.debounceMs ?? CART_ACTIVITY_DEBOUNCE_MS),
  );
}
