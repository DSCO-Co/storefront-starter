import { AssetImage } from "@dscodotco/storefront-sections/components/media/asset-image";
import {
  VialStage,
  VialVisual,
} from "@dscodotco/storefront-sections/components/product/vial-visual";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdpPurchasePanel } from "@/components/product/pdp-purchase-panel";
import {
  PdpAttributeRow,
  PdpPairedWith,
  PdpProse,
  PdpSpecs,
  ReconstitutionNote,
  resolvePairedProducts,
} from "@/components/product/pdp-rich";
import { StoreUnavailable } from "@/components/store-unavailable";
import { TrackOnMount } from "@/components/track/track-on-mount";
import { WishlistHeart, WishlistProvider } from "@/components/wishlist/wishlist";
import { isShopperSignedIn } from "@/lib/account-session";
import {
  coaByLot,
  commerceVariantId,
  getCatalogSource,
  imageForVariant,
  productHasCoa,
} from "@/lib/catalog-source";
import { coaDocLinkUrl } from "@/lib/coa-doc-link";
import { resolveBehavior } from "@/lib/manifest";
import { subscriptionCadences } from "@/lib/pricing";
import { getRequestManifest } from "@/lib/request-manifest";
import { productPageMetadata, resolveSeoProfile } from "@/lib/seo";
import {
  JsonLd,
  organizationJsonLd,
  productBreadcrumbJsonLd,
  productJsonLd,
} from "@/lib/structured-data";

type PdpParams = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string }>;
};

export async function generateMetadata({ params }: PdpParams): Promise<Metadata> {
  const [{ slug }, resolution] = await Promise.all([params, getRequestManifest()]);
  if (resolution?.manifest.store.status !== "live") return {};
  const product = await getCatalogSource().getProduct(resolution.tenantRef, slug);
  if (!product) return {};
  return productPageMetadata(resolution.manifest, product);
}

/**
 * Product detail page. Ports the parent's `/_store/[storeKey]/products/[slug]`
 * shape: name, images, price, variant picker, category/reconstitution
 * attributes, COA (when the catalog carries one), add to cart — plus the
 * rich editorial sections (overview, mechanism, specs, paired-with
 * cross-sell) from `components/product/pdp-rich`. Every rich section is
 * authored-or-absent: the same `Product` shape feeds fixture and live mode,
 * and an unauthored field renders nothing.
 */
export default async function ProductDetailPage({ params, searchParams }: PdpParams) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const { manifest } = resolution;

  if (manifest.store.status !== "live") {
    return <StoreUnavailable brandName={manifest.brand.name} />;
  }

  const catalog = getCatalogSource();
  const product = await catalog.getProduct(resolution.tenantRef, slug);
  if (!product) notFound();

  // Paired-with cross-sell: refs are already resolved to {slug, name} by the
  // catalog source; the card content (tagline/price/image) comes from joining
  // against the store's own catalog. The list read happens only when the
  // product actually authors pairings.
  const pairedProducts =
    product.pairedWith && product.pairedWith.length > 0
      ? resolvePairedProducts(product.pairedWith, await catalog.listProducts(resolution.tenantRef))
      : [];

  const initialVariantLabel = query.variant ?? null;
  // VIEW_CONTENT funnel identity: the default (first) variant's commerce id +
  // price, so the content id lines up with the ADD_TO_CART fire.
  const primaryVariant = product.variants[0] ?? null;
  const viewProductId = primaryVariant ? commerceVariantId(primaryVariant) : product.slug;
  const viewPriceCents = primaryVariant ? primaryVariant.priceCents : product.priceCents;
  const image = imageForVariant(product, product.variants[0] ?? null);
  const coaLots = productHasCoa(product) ? coaByLot(product.coaDocs) : [];
  const open = resolveSeoProfile(manifest) === "open";
  const behavior = resolveBehavior(manifest);
  const wishlistEnabled = behavior.wishlist.enabled;
  const signedIn = wishlistEnabled ? await isShopperSignedIn() : false;
  // Subscribe-and-save is STORE-GATED (behavior.subscriptions, LOO-3154):
  // the catalog's isSubscription flag only matters when the store's gate is
  // on AND the manifest offers at least one cadence — a gated-off store
  // renders no S&S affordance anywhere, whatever the catalog says. (The
  // checkout BFF re-enforces this server-side; this is the affordance leg.)
  const subscriptionOffered = subscriptionCadences(behavior).length > 0;

  return (
    <>
      {/* VIEW_CONTENT funnel fire — consent-gated client-side, forwarded via
          /api/track (never a client-side pixel). */}
      <TrackOnMount
        event={{
          eventType: "VIEW_CONTENT",
          productId: viewProductId,
          priceCents: viewPriceCents,
        }}
      />
      {/* Product/Offer + breadcrumb ride only on an open-profile store;
          Organization stays neutral and safe on any store. */}
      <JsonLd data={organizationJsonLd(manifest, { withAssets: open })} />
      {open ? (
        <>
          <JsonLd data={productJsonLd(manifest, product)} />
          <JsonLd data={productBreadcrumbJsonLd(manifest, product)} />
        </>
      ) : null}
      <main id="main" className="mx-auto max-w-5xl px-6 py-12">
        <a href="/products" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
          ← Shop
        </a>
        <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            {image ? (
              <AssetImage
                assetRef={image.assetRef}
                alt={image.alt}
                width={800}
                height={800}
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="w-full object-cover"
              />
            ) : (
              <VialStage size="pdp">
                <VialVisual name={product.name.toUpperCase()} sub={product.variants[0]?.label} />
              </VialStage>
            )}
          </div>
          <div>
            <WishlistProvider
              storeKey={manifest.catalog.storeKey}
              enabled={wishlistEnabled}
              signedIn={signedIn}
            >
              <div className="flex items-start justify-between gap-4">
                <h1
                  className="text-3xl"
                  style={{
                    fontFamily: "var(--font-display, var(--font-heading))",
                    fontWeight: 600,
                  }}
                >
                  {product.name}
                </h1>
                <WishlistHeart productRef={product.slug} label={product.name} />
              </div>
            </WishlistProvider>
            {product.tagline ? (
              <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>
                {product.tagline}
              </p>
            ) : null}
            <PdpAttributeRow product={product} />
            {product.description ? (
              <p
                className="mt-4 text-sm leading-relaxed"
                style={{ color: "var(--color-ink-3, var(--color-muted))" }}
              >
                {product.description}
              </p>
            ) : null}
            <div className="mt-6">
              <PdpPurchasePanel
                storeKey={manifest.catalog.storeKey}
                slug={product.slug}
                name={product.name}
                variants={product.variants}
                initialVariantLabel={initialVariantLabel}
                subscriptionEligible={subscriptionOffered && product.isSubscription === true}
              />
              <ReconstitutionNote product={product} />
            </div>
            {coaLots.length > 0 ? (
              <div
                className="mt-8 border-t pt-6"
                style={{ borderColor: "var(--color-line-soft, var(--color-border))" }}
              >
                <h2 className="text-sm font-semibold uppercase" style={{ letterSpacing: "0.08em" }}>
                  Certificates of analysis
                </h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {coaLots
                    .flatMap((lot) => lot.docs)
                    .map((doc) => {
                      const linkUrl = coaDocLinkUrl(doc.url);
                      return (
                        <li key={doc.url}>
                          {linkUrl !== null ? (
                            <a
                              href={linkUrl}
                              className="text-sm underline"
                              style={{ color: "var(--color-primary)" }}
                            >
                              {doc.label}
                              {doc.lotNumber ? ` — Lot ${doc.lotNumber}` : ""}
                            </a>
                          ) : (
                            // Honest absence (coaDocLinkUrl): an unserved
                            // same-origin path never renders as a live link.
                            <span
                              className="text-sm"
                              data-testid="coa-doc-pending"
                              style={{ color: "var(--color-muted)" }}
                            >
                              {doc.label}
                              {doc.lotNumber ? ` — Lot ${doc.lotNumber}` : ""} — document pending
                            </span>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
        <PdpProse overview={product.overview} mechanism={product.mechanism} />
        <PdpSpecs specs={product.specs} />
        <PdpPairedWith items={pairedProducts} />
      </main>
    </>
  );
}
