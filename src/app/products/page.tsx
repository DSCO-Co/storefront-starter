import { AssetImage } from "@dscodotco/storefront-sections/components/media/asset-image";
import {
  VialStage,
  VialVisual,
} from "@dscodotco/storefront-sections/components/product/vial-visual";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { StoreUnavailable } from "@/components/store-unavailable";
import { WishlistHeart, WishlistProvider } from "@/components/wishlist/wishlist";
import { isShopperSignedIn } from "@/lib/account-session";
import {
  commerceVariantId,
  getCatalogSource,
  imageForVariant,
  type Product,
} from "@/lib/catalog-source";
import { formatCents } from "@/lib/format";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";
import { productsPageMetadata, resolveSeoProfile, storeBaseUrl } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/structured-data";

export async function generateMetadata(): Promise<Metadata> {
  const resolution = await getRequestManifest();
  return resolution ? productsPageMetadata(resolution.manifest) : {};
}

/**
 * Product listing page (PLP). Ports the parent storefront's
 * `/_store/[storeKey]/collections` shape into this repo's single-store-per-
 * host renderer (no per-category route yet — one page lists the whole live
 * catalog; a `/products?category=` filter is a section-registry-shaped
 * follow-up, not built here). Cart/checkout are IN scope for this batch
 * (unlike `sections/product-grid.tsx`, which explicitly deferred them) —
 * this page and `components/cart/add-to-cart-button.tsx` are the seam that
 * makes the grid section's existing `/products/{slug}` links resolvable.
 */
export default async function ProductsPage() {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const { manifest } = resolution;

  if (manifest.store.status !== "live") {
    return <StoreUnavailable brandName={manifest.brand.name} />;
  }

  const products = await getCatalogSource().listProducts(resolution.tenantRef);
  const open = resolveSeoProfile(manifest) === "open";
  const base = storeBaseUrl(manifest);
  const wishlistEnabled = resolveBehavior(manifest).wishlist.enabled;
  const signedIn = wishlistEnabled ? await isShopperSignedIn() : false;

  return (
    <>
      {open ? (
        <JsonLd
          data={breadcrumbJsonLd([
            { name: manifest.brand.name, url: `${base}/` },
            { name: "Shop" },
          ])}
        />
      ) : null}
      <main id="main" className="mx-auto max-w-6xl px-6 py-12">
        <a href="/" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
          ← {manifest.brand.name}
        </a>
        <h1
          className="mt-6 text-3xl"
          style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
        >
          Shop
        </h1>
        {products.length === 0 ? (
          <p className="mt-10 text-sm" style={{ color: "var(--color-muted)" }}>
            No products are available right now.
          </p>
        ) : (
          <WishlistProvider
            storeKey={manifest.catalog.storeKey}
            enabled={wishlistEnabled}
            signedIn={signedIn}
          >
            <ul className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ProductCard
                  key={product.slug}
                  storeKey={manifest.catalog.storeKey}
                  product={product}
                />
              ))}
            </ul>
          </WishlistProvider>
        )}
      </main>
    </>
  );
}

function ProductCard({ storeKey, product }: { storeKey: string; product: Product }) {
  const variants = product.variants;
  const singleVariant = variants.length === 1 ? variants[0] : null;
  const cheapest =
    variants.length > 0 ? Math.min(...variants.map((v) => v.priceCents)) : product.priceCents;
  const image = imageForVariant(product, singleVariant ?? null);

  return (
    <li
      className="flex flex-col overflow-hidden"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--color-surface-1, var(--color-surface)) 92%, transparent)",
        borderRadius: "var(--radius-card, 16px)",
        border: "1px solid var(--color-line-soft, var(--color-border))",
      }}
    >
      <a href={`/products/${product.slug}`} aria-label={`${product.name} details`}>
        {image ? (
          <AssetImage
            assetRef={image.assetRef}
            alt={image.alt}
            width={640}
            height={640}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="w-full object-cover"
          />
        ) : (
          <VialStage size="card">
            <VialVisual name={product.name.toUpperCase()} sub={variants[0]?.label} />
          </VialStage>
        )}
      </a>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <a href={`/products/${product.slug}`}>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-ink-1, var(--color-text))" }}
            >
              {product.name}
            </h2>
          </a>
          <WishlistHeart productRef={product.slug} label={product.name} />
        </div>
        {product.description ? (
          <p
            className="line-clamp-2 text-[13.5px]"
            style={{ color: "var(--color-ink-3, var(--color-muted))" }}
          >
            {product.description}
          </p>
        ) : null}
        <div
          className="mt-auto flex items-center justify-between gap-4 border-t pt-4"
          style={{ borderColor: "var(--color-line-soft, var(--color-border))" }}
        >
          <span
            className="text-xl font-bold"
            style={{ color: "var(--color-ink-1, var(--color-text))" }}
          >
            {variants.length > 1 ? (
              <span
                className="mr-1 text-xs font-semibold"
                style={{ color: "var(--color-ink-3, var(--color-muted))" }}
              >
                From
              </span>
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
    </li>
  );
}
