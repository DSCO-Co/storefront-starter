import type { Metadata, MetadataRoute } from "next";
import type { Product } from "@/lib/catalog-source";
import { resolveBehavior, resolveSeoMode, type StoreManifest } from "@/lib/manifest";
import { assetUrl } from "@/lib/media";
import { policyPagesFromManifest } from "@/sections/policy-page";

/**
 * SEO layer for the white-label storefront (FD Epic 15) — the flightdeck-
 * native port of the Loop parent's `lib/seo.ts` + `lib/structured-data/
 * manifest-seo.ts`. PURE builders over the resolved manifest + catalog so the
 * lockdown posture is unit-testable; the `app/robots.ts` / `app/sitemap.ts`
 * metadata routes and each page's `generateMetadata` only resolve the store by
 * hostname and delegate here.
 *
 * The single open/locked decision comes from `resolveSeoMode(manifest)`
 * (lib/manifest.ts), which already folds the three inputs this epic must
 * honor: `behavior.access.noindex` (or `preview`, or the always-noindex Store
 * #0) FORCES `locked`; otherwise `behavior.seo.profile` decides (successor
 * knob), falling back to the legacy `seo.mode`, defaulting to `open`.
 *
 *   locked → ONE-URL sitemap (just `/`) + `Disallow: /` robots + `noindex`
 *            layout meta — the scanner-facing RUO lockdown. Page builders emit
 *            ONLY what the page rendered before this epic (no canonical, no OG).
 *   open   → full catalog sitemap (home + every product + policy pages) +
 *            permissive robots + per-page canonical/OpenGraph/Twitter.
 */

// ── Base URL / SEO posture ─────────────────────────────────────────────────

/** `https://{primary-domain}` — the public origin every absolute URL is built against. */
export function storeBaseUrl(manifest: StoreManifest): string {
  return `https://${manifest.domains.primary}`;
}

export type SeoProfile = "open" | "lockdown";

/**
 * The page-metadata posture governing ALL structured metadata (canonical,
 * OG/Twitter, JSON-LD beyond neutral Organization). Folds noindex → lockdown
 * exactly as `resolveSeoMode` does for robots/sitemap, so a single knob drives
 * both halves. This is also the value `SectionContext.seoProfile` carries (the
 * faq section's FAQPage gate).
 */
export function resolveSeoProfile(manifest: StoreManifest): SeoProfile {
  return resolveSeoMode(manifest) === "open" ? "open" : "lockdown";
}

/** Whether the /search route (and its SearchAction) is offered for this store. */
export function hasSearchRoute(manifest: StoreManifest): boolean {
  return resolveBehavior(manifest).search.enabled;
}

// ── Catalog / manifest accessors ───────────────────────────────────────────

/** Integer cents → schema.org decimal price string ("5995" → "59.95"). */
export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`centsToDecimalString expects integer cents, got ${cents}`);
  }
  return (cents / 100).toFixed(2);
}

/** Make a resolved asset URL absolute against the store base (rooted paths only). */
function absolutize(url: string, base: string): string {
  return url.startsWith("/") ? `${base}${url}` : url;
}

/**
 * Absolute product image URLs. Flightdeck catalog images are `{ assetRef }`
 * media refs — resolved MECHANICALLY through `assetUrl` (lib/media.ts), then
 * absolutized against the store base (same-origin refs resolve to `/stores/…`
 * rooted paths). A ref that doesn't resolve contributes nothing — never a
 * fabricated URL. Fixtures carry no images today, so this is `[]` for them.
 */
export function productImageUrls(product: Product, base: string): string[] {
  const urls: string[] = [];
  for (const image of product.images ?? []) {
    const resolved = assetUrl(image.assetRef);
    if (resolved) urls.push(absolutize(resolved, base));
  }
  return urls;
}

/** Absolute URL for a single brand asset ref (og image / logo), or null. */
export function brandAssetUrl(ref: string | undefined, base: string): string | null {
  if (!ref) return null;
  const resolved = assetUrl(ref);
  return resolved ? absolutize(resolved, base) : null;
}

/**
 * schema.org availability from stock presence: an explicit non-positive
 * `stock` (or `inStock: false`, both passthrough today) marks OutOfStock;
 * anything else — including no stock signal at all, which is every fixture — is
 * InStock (a product in the published catalog is offered).
 */
export function productAvailability(
  product: Product,
): "https://schema.org/InStock" | "https://schema.org/OutOfStock" {
  const bag = product as { stock?: unknown; inStock?: unknown };
  if (typeof bag.stock === "number" && bag.stock <= 0) return "https://schema.org/OutOfStock";
  if (bag.inStock === false) return "https://schema.org/OutOfStock";
  return "https://schema.org/InStock";
}

/**
 * Best-effort last-modified for sitemap entries, read from whichever release
 * timestamp the manifest carries (`updatedAt` / `publishedAt` at the top level
 * or under `store`, all passthrough). Fixtures carry none — callers then OMIT
 * `lastModified`, never fabricate one.
 */
export function manifestLastModified(manifest: StoreManifest): Date | undefined {
  const bag = manifest as Record<string, unknown>;
  const store = manifest.store as Record<string, unknown>;
  for (const candidate of [bag.updatedAt, bag.publishedAt, store.updatedAt, store.publishedAt]) {
    if (typeof candidate !== "string") continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

// ── robots.txt ─────────────────────────────────────────────────────────────

export function buildRobots(manifest: StoreManifest): MetadataRoute.Robots {
  if (resolveSeoMode(manifest) === "locked") {
    // Total lockdown — no sitemap reference (nothing for a scanner to crawl).
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${storeBaseUrl(manifest)}/sitemap.xml`,
  };
}

/** The fail-safe robots for an unknown/unresolvable host: disallow everything. */
export function lockedFallbackRobots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}

// ── sitemap.xml ────────────────────────────────────────────────────────────

export function buildSitemap(
  manifest: StoreManifest,
  products: Product[],
  collections: { slug: string }[] = [],
): MetadataRoute.Sitemap {
  const base = storeBaseUrl(manifest);
  if (resolveSeoMode(manifest) === "locked") {
    // One URL only — the homepage. Even this sits behind a noindex meta; the
    // single entry keeps `/sitemap.xml` well-formed without exposing the catalog.
    return [{ url: `${base}/`, changeFrequency: "monthly", priority: 1 }];
  }
  const lastModified = manifestLastModified(manifest);
  const entries: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      changeFrequency: "daily",
      priority: 1,
      ...(lastModified ? { lastModified } : {}),
    },
    // The PLP is a real, indexable route in this renderer (unlike the parent,
    // whose collections lived elsewhere) — advertise it.
    {
      url: `${base}/products`,
      changeFrequency: "daily",
      priority: 0.9,
      ...(lastModified ? { lastModified } : {}),
    },
  ];
  for (const product of products) {
    const images = productImageUrls(product, base);
    entries.push({
      url: `${base}/products/${product.slug}`,
      changeFrequency: "weekly",
      priority: 0.8,
      ...(lastModified ? { lastModified } : {}),
      ...(images.length > 0 ? { images } : {}),
    });
  }
  if (collections.length > 0) {
    // The collections index route exists only meaningfully when the store has
    // collections (an empty store redirects it to /products).
    entries.push({
      url: `${base}/collections`,
      changeFrequency: "weekly",
      priority: 0.7,
      ...(lastModified ? { lastModified } : {}),
    });
  }
  for (const collection of collections) {
    entries.push({
      url: `${base}/collections/${collection.slug}`,
      changeFrequency: "weekly",
      priority: 0.7,
      ...(lastModified ? { lastModified } : {}),
    });
  }
  for (const policy of policyPagesFromManifest(manifest)) {
    entries.push({
      url: `${base}/policies/${policy.slug}`,
      changeFrequency: "monthly",
      priority: 0.3,
      ...(lastModified ? { lastModified } : {}),
    });
  }
  return entries;
}

// ── Page metadata (canonical + OpenGraph/Twitter) ──────────────────────────
//
// `resolveSeoProfile` governs all of it:
//   open     → canonical (ALWAYS the primary domain; a PDP canonical NEVER
//              carries `?variant=`), og:* + twitter:card per page type.
//   lockdown → each builder returns ONLY what the page emitted before this
//              epic (title/description or nothing) — a lockdown store leaks
//              nothing new.
//
// RUO-safety: every description is existing manifest/catalog content that
// already passed the claims gate — these builders never generate copy.

/** Canonical absolute URL for a path — always the PRIMARY domain, never a query string. */
export function canonicalUrl(manifest: StoreManifest, path: string): string {
  return `${storeBaseUrl(manifest)}${path === "/" ? "/" : path}`;
}

/** OG images: page-specific first, else the store's ogImageRef; cleanly absent otherwise. */
function resolveOgImages(manifest: StoreManifest, pageImages?: string[]): string[] {
  if (pageImages && pageImages.length > 0) return pageImages;
  const og = brandAssetUrl(manifest.brand.assets?.ogImageRef, storeBaseUrl(manifest));
  return og ? [og] : [];
}

export type StructuredPageInput = {
  /** Canonical path (no query — the canonical NEVER carries one). */
  path: string;
  title?: string;
  description?: string;
  /** Page-specific OG images (e.g. product images on a PDP). */
  images?: string[];
  /** What a lockdown store keeps emitting (pre-epic posture). Defaults to {}. */
  lockdownMetadata?: Metadata;
};

/** The shared open/lockdown split every per-page builder goes through. */
export function structuredPageMetadata(
  manifest: StoreManifest,
  input: StructuredPageInput,
): Metadata {
  if (resolveSeoProfile(manifest) !== "open") {
    // Lockdown still emits the canonical (audit P2): the canonical is ALWAYS
    // the primary domain, so a page served from an alias host (shopdemo's
    // case) self-consolidates to the primary URL. It points at the store's
    // own domain — content the store itself serves — so it leaks nothing new.
    return {
      ...(input.lockdownMetadata ?? {}),
      alternates: { canonical: canonicalUrl(manifest, input.path) },
    };
  }
  const url = canonicalUrl(manifest, input.path);
  const images = resolveOgImages(manifest, input.images);
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    alternates: { canonical: url },
    openGraph: {
      title: input.title ?? manifest.brand.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      url,
      siteName: manifest.brand.name,
      type: "website",
      ...(images.length > 0 ? { images } : {}),
    },
    twitter: { card: "summary_large_image" },
  };
}

/** Manifest-authored hero subheading — the claims-gated home-description fallback. */
function heroSubheading(manifest: StoreManifest): string | undefined {
  for (const section of manifest.template.sections) {
    if (section.type !== "hero" && section.type !== "epic-hero") continue;
    const subheading = (section.props as { subheading?: unknown }).subheading;
    if (typeof subheading === "string" && subheading.trim().length > 0) return subheading.trim();
  }
  return undefined;
}

/**
 * Root layout metadata — merged into every page. Sets `metadataBase` (so
 * rooted asset URLs resolve absolute), the store name as the title default,
 * the favicon, and — the meta half of the robots.txt lockdown — `noindex` for
 * any non-open store.
 */
export function layoutMetadata(manifest: StoreManifest): Metadata {
  const base = storeBaseUrl(manifest);
  const favicon = brandAssetUrl(manifest.brand.assets?.faviconRef, base);
  const open = resolveSeoProfile(manifest) === "open";
  return {
    metadataBase: new URL(base),
    title: { default: manifest.brand.name, template: `%s · ${manifest.brand.name}` },
    ...(favicon ? { icons: { icon: favicon } } : {}),
    ...(open ? {} : { robots: { index: false, follow: false } }),
  };
}

/**
 * Home page. Description: the hero subheading if the manifest carries one,
 * else the store name — both pre-existing claims-gated content.
 *
 * The description rides in LOCKDOWN too (audit P2): both demo stores run the
 * lockdown profile, which previously returned `{}` here — so `heroSubheading`
 * never reached the meta description on any of their homepages. The
 * subheading is copy the page already renders in its hero, so emitting it as
 * a description leaks nothing the lockdown posture protects.
 */
export function homeMetadata(manifest: StoreManifest): Metadata {
  const description = heroSubheading(manifest) ?? manifest.brand.name;
  return structuredPageMetadata(manifest, {
    path: "/",
    description,
    lockdownMetadata: { description },
  });
}

/** Cart page. Title "Cart" (the layout template appends the store name). */
export function cartPageMetadata(manifest: StoreManifest): Metadata {
  return structuredPageMetadata(manifest, {
    path: "/cart",
    title: "Cart",
    lockdownMetadata: { title: "Cart" },
  });
}

/** Checkout page. Title "Checkout". */
export function checkoutPageMetadata(manifest: StoreManifest): Metadata {
  return structuredPageMetadata(manifest, {
    path: "/checkout",
    title: "Checkout",
    lockdownMetadata: { title: "Checkout" },
  });
}

/** Search page. Title "Search"; canonical is the bare `/search` (no query). */
export function searchPageMetadata(manifest: StoreManifest): Metadata {
  return structuredPageMetadata(manifest, {
    path: "/search",
    title: "Search",
    lockdownMetadata: { title: "Search" },
  });
}

/** Collections index. Title "Collections". */
export function collectionsIndexMetadata(manifest: StoreManifest): Metadata {
  return structuredPageMetadata(manifest, {
    path: "/collections",
    title: "Collections",
    lockdownMetadata: { title: "Collections" },
  });
}

/** Product listing page (PLP). Title "Shop"; canonical `/products`. */
export function productsPageMetadata(manifest: StoreManifest): Metadata {
  return structuredPageMetadata(manifest, {
    path: "/products",
    title: "Shop",
    lockdownMetadata: { title: "Shop" },
  });
}

/**
 * PDP. Canonical collapses `?variant=` (the canonical path carries no query).
 * OG image: the product's own images when present, else the store ogImageRef.
 */
export function productPageMetadata(manifest: StoreManifest, product: Product): Metadata {
  return structuredPageMetadata(manifest, {
    path: `/products/${product.slug}`,
    title: product.name,
    ...(product.description !== undefined ? { description: product.description } : {}),
    images: productImageUrls(product, storeBaseUrl(manifest)),
    // Pre-epic posture: title + description only.
    lockdownMetadata: {
      title: product.name,
      ...(product.description !== undefined ? { description: product.description } : {}),
    },
  });
}

/** Policy page. Description: the first paragraph of the manifest-authored body. */
export function policyPageMetadata(
  manifest: StoreManifest,
  page: { slug: string; title: string; body: string },
): Metadata {
  const firstParagraph = page.body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > 0);
  const description =
    firstParagraph && firstParagraph.length > 160
      ? `${firstParagraph.slice(0, 157)}…`
      : firstParagraph;
  return structuredPageMetadata(manifest, {
    path: `/policies/${page.slug}`,
    title: page.title,
    ...(description !== undefined ? { description } : {}),
    lockdownMetadata: { title: page.title },
  });
}

/**
 * Collection/category pages — a DROP-IN for the day the catalog grows a
 * collection model (none exists in the manifest or commerce today, so no
 * `/collections/[slug]` route ships this epic — see the changeset seam). The
 * metadata helper is ready so those routes gain full treatment the moment they
 * land. Description must be pre-gated content the route already renders.
 */
export function collectionPageMetadata(
  manifest: StoreManifest,
  collection: { slug: string; title: string; description?: string },
): Metadata {
  return structuredPageMetadata(manifest, {
    path: `/collections/${collection.slug}`,
    title: collection.title,
    ...(collection.description !== undefined ? { description: collection.description } : {}),
    lockdownMetadata: { title: collection.title },
  });
}
