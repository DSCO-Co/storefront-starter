"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clearWishlist,
  loadWishlist,
  saveWishlist,
  toggleRef as toggleLocalRef,
} from "@/lib/wishlist";

/**
 * React binding over the wishlist (LOO-3138). Two backends behind one API,
 * chosen by `signedIn`:
 *
 *  - GUEST (`signedIn: false`): purely `localStorage`, exactly like
 *    `use-cart.ts` — this surface has no guest session backend.
 *  - SIGNED-IN (`signedIn: true`): the server wishlist in persons, reached
 *    through the `/api/wishlist/*` BFF routes (never the module directly).
 *
 * MERGE-ON-AUTH: the first render as a signed-in shopper folds the guest
 * `localStorage` wishlist INTO the server wishlist (a union POST to
 * `/api/wishlist/merge`), adopts the server list as the source of truth, and
 * clears the guest copy. The merge is idempotent — persons upserts ON
 * CONFLICT DO NOTHING, so re-running it (a refresh, a second tab) adds
 * nothing. See the effect below.
 *
 * HONEST ABSENCE: when the server read/merge FAILS, `loadError` is true and
 * `refs` stays empty — the caller renders "we couldn't load this", NEVER an
 * empty wishlist. A `hydrated` gate (mirroring `use-cart.ts`) holds the UI
 * until the first read actually ran, so a real wishlist never flashes empty.
 *
 * When `enabled` is false the hook is inert (the surface ships dark) — the
 * heart/page render as though the wishlist does not exist.
 */
export function useWishlist(storeKey: string, options: { enabled: boolean; signedIn: boolean }) {
  const { enabled, signedIn } = options;
  const [refs, setRefs] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHydrated(true);
      return;
    }
    if (!signedIn) {
      setRefs(loadWishlist(storeKey).refs);
      setLoadError(false);
      setHydrated(true);
      return;
    }
    // Signed-in: merge the guest localStorage wishlist into the server list,
    // then adopt the server list. Idempotent (persons unions ON CONFLICT DO
    // NOTHING), so a second run adds nothing.
    let cancelled = false;
    const localRefs = loadWishlist(storeKey).refs;
    void (async () => {
      try {
        const res = await fetch("/api/wishlist/merge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refs: localRefs }),
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(true);
        } else {
          const body = (await res.json()) as { items?: Array<{ productRef: string }> };
          setRefs((body.items ?? []).map((i) => i.productRef));
          setLoadError(false);
          // The guest copy is now folded into the server — drop it so it
          // can't re-merge onto a different account after a logout/login.
          clearWishlist(storeKey);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeKey, enabled, signedIn]);

  const persist = useCallback(async (ref: string, save: boolean) => {
    const res = save
      ? await fetch("/api/wishlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ref }),
          cache: "no-store",
        })
      : await fetch(`/api/wishlist?ref=${encodeURIComponent(ref)}`, {
          method: "DELETE",
          cache: "no-store",
        });
    // A 404 on remove means "already gone" — the desired end-state, not a
    // failure to revert.
    return res.ok || (!save && res.status === 404);
  }, []);

  const toggle = useCallback(
    (ref: string) => {
      if (!enabled) return;
      const wasSaved = refs.includes(ref);
      if (!signedIn) {
        setRefs((cur) => {
          const next = toggleLocalRef({ refs: cur }, ref);
          saveWishlist(storeKey, next);
          return next.refs;
        });
        return;
      }
      // Signed-in: optimistic, then persist; revert on a real failure.
      setRefs((cur) => (wasSaved ? cur.filter((r) => r !== ref) : [ref, ...cur]));
      void persist(ref, !wasSaved).then((okFlag) => {
        if (okFlag) return;
        setRefs((cur) =>
          wasSaved ? (cur.includes(ref) ? cur : [ref, ...cur]) : cur.filter((r) => r !== ref),
        );
      });
    },
    [enabled, signedIn, storeKey, refs, persist],
  );

  const isSaved = useCallback((ref: string) => refs.includes(ref), [refs]);

  return { refs, hydrated, loadError, isSaved, toggle };
}
