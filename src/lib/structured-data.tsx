import type { Product } from "@/lib/catalog-source";
import type { StoreManifest } from "@/lib/manifest";
import {
  brandAssetUrl,
  centsToDecimalString,
  hasSearchRoute,
  productAvailability,
  productImageUrls,
  storeBaseUrl,
} from "@/lib/seo";

/**
 * schema.org JSON-LD builders for the white-label storefront (FD Epic 15).
 * The first pass shipped only `faqJsonLd`; the rest of the parent's layer
 * (Product/Offer, Organization, WebSite, BreadcrumbList) lands here now that
 * the PDP/PLP route surfaces exist. Every string that reaches these builders
 * is existing manifest/catalog content that already passed the RUO claims gate
 * — builders NEVER generate copy, only restructure what the store already
 * publishes. Rendering happens via <JsonLd> (below); gate emission on the
 * store's SEO profile at the call site (open only, beyond neutral Organization).
 */

import {
  faqJsonLd,
  JsonLd,
  type JsonLdObject,
  serializeJsonLd,
} from "@dscodotco/storefront-sections/lib/json-ld";

export type { JsonLdObject };
// The pure JSON-LD primitives (`JsonLd`, `serializeJsonLd`, `faqJsonLd`,
// `JsonLdObject`) moved to `@dscodotco/storefront-sections`. Re-exported so app
// routes and the structured-data test keep importing them from here; the
// manifest/product-coupled schema.org builders below stay storefront-side
// (they need `StoreManifest`/`Product` + seo helpers).
export { faqJsonLd, JsonLd, serializeJsonLd };

const CONTEXT = "https://schema.org" as const;

/**
 * Organization — the ONE JSON-LD object a lockdown store may also emit
 * (neutral: name + url only). `withAssets` (open profile) adds the logo when
 * the brand carries a resolvable logoRef.
 */
export function organizationJsonLd(
  manifest: StoreManifest,
  options: { withAssets?: boolean } = {},
): JsonLdObject {
  const base = storeBaseUrl(manifest);
  const jsonLd: JsonLdObject = {
    "@context": CONTEXT,
    "@type": "Organization",
    name: manifest.brand.name,
    url: `${base}/`,
  };
  if (options.withAssets) {
    const logo = brandAssetUrl(manifest.brand.assets?.logoRef, base);
    if (logo) jsonLd.logo = logo;
  }
  return jsonLd;
}

/**
 * WebSite (home page). SearchAction is attached ONLY when the store offers a
 * /search route (`behavior.search.enabled`) — feature-gated, never assumed.
 */
export function websiteJsonLd(manifest: StoreManifest): JsonLdObject {
  const base = storeBaseUrl(manifest);
  const jsonLd: JsonLdObject = {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: manifest.brand.name,
    url: `${base}/`,
  };
  if (hasSearchRoute(manifest)) {
    jsonLd.potentialAction = {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${base}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    };
  }
  return jsonLd;
}

/**
 * Product + Offer (PDP). Canonical URL never carries `?variant=`. Price:
 * integer cents → decimal string, USD. Multiple variants become an
 * AggregateOffer over the price range; otherwise a single Offer. `sku` is the
 * first variant that carries one. Description is the product's own claims-gated
 * copy — nothing is synthesized.
 */
export function productJsonLd(manifest: StoreManifest, product: Product): JsonLdObject {
  const base = storeBaseUrl(manifest);
  const url = `${base}/products/${product.slug}`;
  const availability = productAvailability(product);
  const images = productImageUrls(product, base);

  const jsonLd: JsonLdObject = {
    "@context": CONTEXT,
    "@type": "Product",
    name: product.name,
    url,
    brand: { "@type": "Brand", name: manifest.brand.name },
  };
  if (product.description) jsonLd.description = product.description;
  if (images.length > 0) jsonLd.image = images;
  const skuVariant = product.variants.find((variant) => variant.sku);
  if (skuVariant?.sku) jsonLd.sku = skuVariant.sku;

  if (product.variants.length > 1) {
    const prices = product.variants.map((variant) => variant.priceCents);
    jsonLd.offers = {
      "@type": "AggregateOffer",
      lowPrice: centsToDecimalString(Math.min(...prices)),
      highPrice: centsToDecimalString(Math.max(...prices)),
      priceCurrency: "USD",
      offerCount: product.variants.length,
      availability,
      url,
    };
  } else {
    const priceCents = product.variants[0]?.priceCents ?? product.priceCents;
    jsonLd.offers = {
      "@type": "Offer",
      price: centsToDecimalString(priceCents),
      priceCurrency: "USD",
      availability,
      url,
    };
  }
  return jsonLd;
}

export type BreadcrumbItem = { name: string; url?: string };

/** BreadcrumbList — positions are 1-based; the last item may omit its URL. */
export function breadcrumbJsonLd(items: BreadcrumbItem[]): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => {
      const listItem: Record<string, unknown> = {
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
      };
      if (item.url) listItem.item = item.url;
      return listItem;
    }),
  };
}

/**
 * PDP breadcrumb: home → Shop (the PLP) → product. The product is the current
 * page and carries no URL. (Category links are a seam for the day a collection
 * model exists — see `collectionPageMetadata` in seo.ts.)
 */
export function productBreadcrumbJsonLd(manifest: StoreManifest, product: Product): JsonLdObject {
  const base = storeBaseUrl(manifest);
  return breadcrumbJsonLd([
    { name: manifest.brand.name, url: `${base}/` },
    { name: "Shop", url: `${base}/products` },
    { name: product.name },
  ]);
}

/**
 * Collection PLP breadcrumb: home → Shop (the PLP) → collection. The
 * collection is the current page and carries no URL (last-crumb convention).
 */
export function collectionBreadcrumbJsonLd(
  manifest: StoreManifest,
  collection: { title: string },
): JsonLdObject {
  const base = storeBaseUrl(manifest);
  return breadcrumbJsonLd([
    { name: manifest.brand.name, url: `${base}/` },
    { name: "Shop", url: `${base}/products` },
    { name: collection.title },
  ]);
}
