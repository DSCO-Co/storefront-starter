"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CartLine } from "@/lib/cart";
import { useCart } from "@/lib/use-cart";

/**
 * The reorder widget (LOO-3137): re-adds this order's line items to the
 * client cart (the storefront cart is localStorage-backed — see
 * `lib/cart.ts`), then sends the shopper to the cart. Adds at the price/label
 * carried on the order line — the cart's normal "merge same line" logic then
 * folds duplicates.
 */
export function ReorderButton({
  storeKey,
  items,
}: {
  storeKey: string;
  items: readonly CartLine[];
}) {
  const { add } = useCart(storeKey);
  const router = useRouter();
  const [done, setDone] = useState(false);

  function reorder() {
    for (const line of items) add(line);
    setDone(true);
    router.push("/cart");
  }

  return (
    <button
      type="button"
      onClick={reorder}
      disabled={done || items.length === 0}
      className="fd-btn fd-btn-primary fd-btn-md"
    >
      {done ? "Added to cart" : "Reorder"}
    </button>
  );
}
