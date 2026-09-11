import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountSurface, requireShopper, requireWishlist } from "@/lib/account-context";
import { commerceVariantId, getCatalogSource, type Product } from "@/lib/catalog-source";
import { formatCents } from "@/lib/format";
import { removeFromWishlist } from "./actions";

/**
 * `/account/wishlist` — the signed-in shopper's saved products (LOO-3138).
 * Gated by `wishlist.enabled` (404 when off — the same flag that gates the
 * heart and the /api/wishlist BFF routes) AND the account surface. Reads are
 * scoped SERVER-SIDE to the session's person by persons (Bearer-derived),
 * never a client id.
 *
 * HONEST ABSENCE: a failed wishlist read renders an error, never an empty
 * wishlist. Saved refs are hydrated from commerce's catalog; a ref that no
 * longer resolves (a removed product) is shown as unavailable with a remove
 * control — never silently dropped, and a catalog FAULT propagates (the
 * catalog source throws) rather than masquerading as "no longer available".
 */
export default async function WishlistPage() {
  const ctx = await requireAccountSurface();
  requireWishlist(ctx);
  const session = await requireShopper();

  const listResult = await getAccountClient().listWishlist(session.secret);

  return (
    <div className="grid gap-6">
      <h1
        className="text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Wishlist
      </h1>

      {!listResult.ok ? (
        <p
          className="rounded-[var(--radius-card,12px)] border p-4 text-sm"
          style={{ borderColor: "var(--color-error, #ef4343)" }}
        >
          We couldn&apos;t load your wishlist right now. Please try again in a moment.
        </p>
      ) : listResult.value.length === 0 ? (
        <p className="text-sm opacity-70">
          You haven&apos;t saved anything yet. Tap the heart on a product to save it here.
        </p>
      ) : (
        <WishlistItems tenantRef={ctx.tenantRef} storeKey={ctx.storeKey} refs={listResult.value} />
      )}
    </div>
  );
}

async function WishlistItems({
  tenantRef,
  storeKey,
  refs,
}: {
  tenantRef: string;
  storeKey: string;
  refs: string[];
}) {
  const catalog = getCatalogSource();
  // A catalog fault THROWS here (catalog-source's contract) — the error
  // boundary shows, we never render a fault as "unavailable".
  const hydrated = await Promise.all(
    refs.map(async (ref) => ({ ref, product: await catalog.getProduct(tenantRef, ref) })),
  );

  return (
    <ul className="grid gap-3">
      {hydrated.map(({ ref, product }) => (
        <li
          key={ref}
          className="flex items-start justify-between gap-4 rounded-[var(--radius-card,12px)] border p-4"
          style={{ borderColor: "var(--color-border, #e5e5e5)" }}
        >
          {product === null ? (
            <div className="text-sm">
              <div className="font-medium">This product is no longer available</div>
              <div className="mt-1 opacity-60">{ref}</div>
            </div>
          ) : (
            <WishlistItemBody storeKey={storeKey} product={product} />
          )}
          <form action={removeFromWishlist}>
            <input type="hidden" name="ref" value={ref} />
            <button type="submit" className="text-sm underline opacity-70 hover:opacity-100">
              Remove
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

function WishlistItemBody({ storeKey, product }: { storeKey: string; product: Product }) {
  const variants = product.variants;
  const singleVariant = variants.length === 1 ? variants[0] : null;
  const cheapest =
    variants.length > 0 ? Math.min(...variants.map((v) => v.priceCents)) : product.priceCents;

  return (
    <div className="flex flex-1 flex-col gap-2 text-sm">
      <a href={`/products/${product.slug}`} className="font-medium hover:underline">
        {product.name}
      </a>
      <div className="flex items-center gap-3">
        <span className="font-semibold" style={{ color: "var(--color-ink-1, var(--color-text))" }}>
          {variants.length > 1 ? (
            <span className="mr-1 text-xs font-semibold opacity-60">From</span>
          ) : null}
          {formatCents(cheapest)}
        </span>
        {singleVariant ? (
          <AddToCartButton
            storeKey={storeKey}
            slug={product.slug}
            name={product.name}
            variantId={commerceVariantId(singleVariant)}
            variantLabel={singleVariant.label}
            unitPriceCents={singleVariant.priceCents}
            sku={singleVariant.sku}
          />
        ) : (
          <a href={`/products/${product.slug}`} className="fd-btn fd-btn-secondary fd-btn-sm">
            Choose size
          </a>
        )}
      </div>
    </div>
  );
}
