"use client";

import { useState } from "react";
import { announce } from "@/components/live-announcer";
import { track } from "@/lib/track";
import { useCart } from "@/lib/use-cart";

export function AddToCartButton({
  storeKey,
  slug,
  name,
  variantId,
  variantLabel,
  unitPriceCents,
  sku,
  className,
}: {
  storeKey: string;
  slug: string;
  name: string;
  variantId: string;
  variantLabel: string;
  unitPriceCents: number;
  /** Catalog sku — carried on the cart line for the never-discount coupon note (LOO-3156). */
  sku?: string;
  className?: string;
}) {
  const { add } = useCart(storeKey);
  const [added, setAdded] = useState(false);

  return (
    <button
      type="button"
      data-testid="add-to-cart-button"
      className={className ?? "fd-btn fd-btn-primary fd-btn-sm"}
      onClick={() => {
        add({
          slug,
          name,
          variantId,
          variantLabel,
          unitPriceCents,
          quantity: 1,
          ...(sku !== undefined ? { sku } : {}),
        });
        // ADD_TO_CART funnel fire — consent-gated, forwarded via /api/track.
        track({ eventType: "ADD_TO_CART", variantId, unitPriceCents, quantity: 1 });
        // Screen-reader announcement (D6) — the visual "Added" flash alone
        // is invisible to assistive tech.
        announce(`Added ${name} to cart`);
        setAdded(true);
        window.setTimeout(() => setAdded(false), 1500);
      }}
    >
      {added ? "Added" : "Add to cart"}
    </button>
  );
}
