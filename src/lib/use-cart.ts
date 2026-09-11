"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addLine,
  type Cart,
  type CartLine,
  cartItemCount,
  clearCart as clearStoredCart,
  EMPTY_CART,
  loadCart,
  removeLine,
  saveCart,
  setLineQuantity,
} from "@/lib/cart";
import { getOrCreateCartRef, scheduleCartActivityPing } from "@/lib/cart-activity-client";

/**
 * React binding over `lib/cart.ts`'s pure, localStorage-backed model. The
 * cart is CLIENT state by design (this surface has no cart/session backend
 * — see `cart.ts`'s header) — there is nothing to hydrate from the server,
 * only from `localStorage`, which is unavailable during SSR/the first
 * client render. `hydrated` lets a page hold off rendering "your cart is
 * empty" until after that read actually ran, so a real cart never flashes
 * empty for a frame.
 */
export function useCart(storeKey: string) {
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCart(loadCart(storeKey));
    setHydrated(true);
  }, [storeKey]);

  const mutate = useCallback(
    (next: (current: Cart) => Cart) => {
      setCart((current) => {
        const updated = next(current);
        saveCart(storeKey, updated);
        // Abandoned-cart signal (FD Epic 16): every cart edit schedules a
        // DEBOUNCED server-side ping so the marketing module can see an idle
        // cart the client-only (localStorage) cart would otherwise hide.
        // No email here — the BFF attaches the signed-in shopper's email
        // server-side when there is one; the checkout form pings the typed
        // address itself. Fire-and-forget: a ping can never break the cart.
        const cartRef = getOrCreateCartRef(storeKey);
        if (cartRef !== null) {
          scheduleCartActivityPing(storeKey, { cartRef, itemCount: cartItemCount(updated) });
        }
        return updated;
      });
    },
    [storeKey],
  );

  const add = useCallback(
    (line: CartLine) => mutate((current) => addLine(current, line)),
    [mutate],
  );
  const updateQuantity = useCallback(
    (key: string, quantity: number) => mutate((current) => setLineQuantity(current, key, quantity)),
    [mutate],
  );
  const remove = useCallback(
    (key: string) => mutate((current) => removeLine(current, key)),
    [mutate],
  );
  const clear = useCallback(() => {
    setCart(EMPTY_CART);
    clearStoredCart(storeKey);
  }, [storeKey]);

  return { cart, hydrated, add, updateQuantity, remove, clear };
}
