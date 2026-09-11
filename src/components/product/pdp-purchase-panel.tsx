"use client";

import { Prop65Warning } from "@dscodotco/storefront-sections/components/product/prop65-warning";
import { useState } from "react";
import { announce } from "@/components/live-announcer";
import { commerceVariantId, type ProductVariant } from "@/lib/catalog-source";
import { formatCents } from "@/lib/format";
import { track } from "@/lib/track";
import { useCart } from "@/lib/use-cart";

/**
 * PDP variant selector + add-to-cart, a minimal stand-in for the parent
 * storefront's `components/product/variant-selector.tsx` ("Option C" size
 * toggle preselected by `?variant=`) — this port keeps the SAME
 * `?variant=` preselection contract (the grid section's `cardsForProduct`
 * already deep-links to it for `gridVariantCards` products) without the
 * parent's fuller styling.
 */
export function PdpPurchasePanel({
  storeKey,
  slug,
  name,
  variants,
  initialVariantLabel,
  subscriptionEligible = false,
}: {
  storeKey: string;
  slug: string;
  name: string;
  variants: ProductVariant[];
  initialVariantLabel: string | null;
  /** FD Epic 7: the product is subscription-eligible — carried onto the cart line. */
  subscriptionEligible?: boolean;
}) {
  const { add } = useCart(storeKey);
  const initialIndex = Math.max(
    variants.findIndex((v) => v.label === initialVariantLabel),
    0,
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [added, setAdded] = useState(false);
  const selected = variants[selectedIndex];

  if (!selected) {
    return (
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        This product has no purchasable size right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {variants.length > 1 ? (
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0" aria-label="Select size">
          {variants.map((variant, index) => {
            const active = index === selectedIndex;
            return (
              <button
                key={variant.label + variant.sku}
                type="button"
                data-testid="variant-option"
                aria-pressed={active}
                onClick={() => setSelectedIndex(index)}
                className="px-4 py-1.5 text-xs font-semibold uppercase"
                style={{
                  borderRadius: "var(--radius-pill, 9999px)",
                  border: "1px solid var(--color-line, var(--color-border))",
                  backgroundColor: active ? "var(--color-primary)" : "transparent",
                  color: active
                    ? "var(--color-primary-foreground, #fff)"
                    : "var(--color-ink-2, var(--color-text))",
                }}
              >
                {variant.label}
              </button>
            );
          })}
        </fieldset>
      ) : null}
      <div className="flex items-center gap-4">
        <span
          className="text-2xl font-bold"
          style={{ color: "var(--color-ink-1, var(--color-text))" }}
        >
          {formatCents(selected.priceCents)}
        </span>
        <button
          type="button"
          data-testid="pdp-add-to-cart"
          className="fd-btn fd-btn-primary fd-btn-md"
          onClick={() => {
            const variantId = commerceVariantId(selected);
            add({
              slug,
              name,
              variantId,
              variantLabel: selected.label,
              unitPriceCents: selected.priceCents,
              quantity: 1,
              sku: selected.sku,
              ...(subscriptionEligible ? { subscriptionEligible: true } : {}),
            });
            // ADD_TO_CART funnel fire — consent-gated, forwarded via /api/track.
            track({
              eventType: "ADD_TO_CART",
              variantId,
              unitPriceCents: selected.priceCents,
              quantity: 1,
            });
            // Screen-reader announcement (D6) — the visual "Added to cart"
            // flash alone is invisible to assistive tech.
            announce(`Added ${name} (${selected.label}) to cart`);
            setAdded(true);
            window.setTimeout(() => setAdded(false), 1500);
          }}
        >
          {added ? "Added to cart" : "Add to cart"}
        </button>
      </div>
      <Prop65Warning />
    </div>
  );
}
