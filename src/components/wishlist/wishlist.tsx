"use client";

import { createContext, type ReactNode, useContext } from "react";
import { useWishlist } from "@/lib/use-wishlist";

/**
 * The wishlist heart (LOO-3138). A single `WishlistProvider` per page owns
 * ONE `useWishlist` instance (so every card + the PDP share one state and one
 * server sync / merge-on-auth run); each `WishlistHeart` just reads it. When
 * the store's `wishlist.enabled` is false the provider is inert and every
 * heart renders NOTHING — the surface ships dark, exactly as the manifest
 * docblock describes.
 */

interface WishlistContextValue {
  readonly enabled: boolean;
  readonly hydrated: boolean;
  readonly isSaved: (ref: string) => boolean;
  readonly toggle: (ref: string) => void;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({
  storeKey,
  enabled,
  signedIn,
  children,
}: {
  storeKey: string;
  enabled: boolean;
  signedIn: boolean;
  children: ReactNode;
}) {
  const { hydrated, isSaved, toggle } = useWishlist(storeKey, { enabled, signedIn });
  return (
    <WishlistContext.Provider value={{ enabled, hydrated, isSaved, toggle }}>
      {children}
    </WishlistContext.Provider>
  );
}

/**
 * A save/unsave heart for one product. Renders null when there is no provider
 * or the wishlist is disabled — so it is safe to drop into any card/PDP; it
 * simply vanishes on stores that have not opted in.
 */
export function WishlistHeart({ productRef, label }: { productRef: string; label: string }) {
  const ctx = useContext(WishlistContext);
  if (ctx === null || !ctx.enabled) return null;
  const saved = ctx.isSaved(productRef);
  return (
    <button
      type="button"
      data-testid="wishlist-heart"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${label} from your wishlist` : `Save ${label} to your wishlist`}
      title={saved ? "Saved" : "Save"}
      onClick={() => ctx.toggle(productRef)}
      className="inline-flex items-center justify-center rounded-full p-2 transition-colors"
      style={{
        border: "1px solid var(--color-line, var(--color-border))",
        backgroundColor: saved
          ? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
          : "var(--color-surface, transparent)",
        color: saved ? "var(--color-primary)" : "var(--color-ink-3, var(--color-muted))",
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"
        />
      </svg>
    </button>
  );
}
