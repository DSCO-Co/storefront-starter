"use client";

import { useEffect, useRef } from "react";
import { announce } from "@/components/live-announcer";
import { useCart } from "@/lib/use-cart";

/**
 * Persistent cart-count link, mounted once in the root layout (fixed
 * top-right) so it survives every route including checkout — this port's
 * stand-in for the parent storefront's mini-cart drawer/toast, which this
 * batch doesn't build (see the changeset).
 */
export function CartBadge({ storeKey }: { storeKey: string }) {
  const { cart, hydrated } = useCart(storeKey);
  const itemCount = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  // Cart-count change announcement (D6): only genuine CHANGES after
  // hydration — never the initial hydrated read (that's page state, not an
  // event worth interrupting a screen-reader for).
  const lastAnnounced = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (lastAnnounced.current !== null && lastAnnounced.current !== itemCount) {
      announce(`Cart updated: ${itemCount} item${itemCount === 1 ? "" : "s"}`);
    }
    lastAnnounced.current = itemCount;
  }, [hydrated, itemCount]);
  // Before hydration this would read 0 for a shopper with items already in
  // a stored cart — hide rather than flash a wrong count.
  if (!hydrated) return null;
  return (
    <a
      href="/cart"
      aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
      data-testid="cart-badge"
      className="fixed right-4 top-4 z-40 flex items-center gap-1.5 px-3 py-2 text-sm"
      style={{
        borderRadius: "var(--radius-pill, 9999px)",
        border: "1px solid var(--color-line, var(--color-border))",
        backgroundColor:
          "color-mix(in srgb, var(--color-surface-1, var(--color-surface)) 92%, transparent)",
        color: "var(--color-ink-1, var(--color-text))",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 3h2l.4 2M7 13h10l3-8H5.4M7 13 5.4 5M7 13l-1.7 4.6A1 1 0 0 0 6.2 19H17M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        />
      </svg>
      <span data-testid="cart-badge-count">{itemCount}</span>
    </a>
  );
}
