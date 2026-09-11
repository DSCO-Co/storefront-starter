"use client";

import { useEffect, useState } from "react";
import { lineKey } from "@/lib/cart";
import { loadCouponCode, saveCouponCode } from "@/lib/coupon";
import { formatCents } from "@/lib/format";
import { useCart } from "@/lib/use-cart";

export function CartPageClient({
  storeKey,
  promotionsEnabled = false,
}: {
  storeKey: string;
  /** LOO-3156: `behavior.promotions.enabled` — gates the coupon entry. */
  promotionsEnabled?: boolean;
}) {
  const { cart, hydrated, updateQuantity, remove } = useCart(storeKey);
  // LOO-3156 coupon entry: stashed per-store and picked up by the checkout
  // form, where it is validated + applied SERVER-SIDE at payment. Loaded
  // after hydration (localStorage is unavailable during SSR).
  const [couponCode, setCouponCode] = useState("");
  useEffect(() => {
    if (!promotionsEnabled) return;
    const stashed = loadCouponCode(storeKey);
    if (stashed.length > 0) setCouponCode(stashed);
  }, [promotionsEnabled, storeKey]);

  if (!hydrated) {
    return (
      <div role="status" aria-label="Loading your cart" data-testid="cart-loading">
        <div className="fd-skeleton h-6 w-40" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div data-testid="cart-empty">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Your cart is empty.
        </p>
        <a
          href="/products"
          className="mt-4 inline-block fd-btn fd-btn-primary fd-btn-sm"
          data-testid="cart-empty-shop-link"
        >
          Shop products
        </a>
      </div>
    );
  }

  const totalCents = cart.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

  return (
    <div data-testid="cart-lines">
      <ul className="flex flex-col gap-4">
        {cart.lines.map((line) => {
          const key = lineKey(line);
          return (
            <li
              key={key}
              className="flex items-center justify-between gap-4 border-b pb-4"
              style={{ borderColor: "var(--color-line-soft, var(--color-border))" }}
              data-testid="cart-line"
            >
              <div>
                <p className="font-medium">{line.name}</p>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {line.variantLabel}
                </p>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {formatCents(line.unitPriceCents)} each
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  Qty
                  <input
                    type="number"
                    min={1}
                    value={line.quantity}
                    aria-label={`Quantity for ${line.name} — ${line.variantLabel}`}
                    data-testid="cart-line-quantity"
                    className="fd-input w-16 px-2 py-1 text-sm"
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isInteger(next)) updateQuantity(key, next);
                    }}
                  />
                </label>
                <span className="w-20 text-right font-medium">
                  {formatCents(line.unitPriceCents * line.quantity)}
                </span>
                <button
                  type="button"
                  data-testid="cart-line-remove"
                  aria-label={`Remove ${line.name} — ${line.variantLabel}`}
                  className="fd-btn fd-btn-ghost fd-btn-sm"
                  onClick={() => remove(key)}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {promotionsEnabled ? (
        <label className="mt-6 flex max-w-xs flex-col gap-1 text-sm" data-testid="cart-coupon">
          Coupon code
          <input
            value={couponCode}
            onChange={(event) => {
              setCouponCode(event.target.value);
              saveCouponCode(storeKey, event.target.value);
            }}
            placeholder="SAVE10"
            className="fd-input px-3 py-2 text-sm"
            data-testid="cart-coupon-code"
          />
          {couponCode.trim().length > 0 ? (
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              Applied at checkout — invalid or expired codes are refused before any charge.
            </span>
          ) : null}
        </label>
      ) : null}
      <div className="mt-6 flex items-center justify-between">
        <span className="text-lg font-semibold" data-testid="cart-total">
          Total: {formatCents(totalCents)}
        </span>
        <a
          href="/checkout"
          className="fd-btn fd-btn-primary fd-btn-md"
          data-testid="cart-checkout-link"
        >
          Checkout
        </a>
      </div>
    </div>
  );
}
