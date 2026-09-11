import { describe, expect, it } from "vitest";
import leoResearch from "@/fixtures/manifests/store-leo-research.json";
import { type Product, productSchema } from "@/lib/catalog-source";
import { type StoreManifest, storeManifestSchema } from "@/lib/manifest";
import {
  buildRobots,
  buildSitemap,
  canonicalUrl,
  cartPageMetadata,
  checkoutPageMetadata,
  collectionPageMetadata,
  collectionsIndexMetadata,
  homeMetadata,
  layoutMetadata,
  productPageMetadata,
  productsPageMetadata,
  resolveSeoProfile,
  searchPageMetadata,
} from "@/lib/seo";

/** leo fixture ships `preview: true` (→ locked). Drop it for the open case. */
function openManifest(): StoreManifest {
  const { preview: _preview, ...rest } = leoResearch as Record<string, unknown>;
  return storeManifestSchema.parse(rest);
}

function lockedManifest(): StoreManifest {
  return storeManifestSchema.parse(leoResearch);
}

function product(overrides: Partial<Product> = {}): Product {
  return productSchema.parse({
    slug: "bpc-157",
    name: "BPC-157",
    priceCents: 21900,
    variants: [{ label: "5mg", sku: "LEO-BPC-5", priceCents: 21900 }],
    ...overrides,
  });
}

const BASE = "https://leo.localhost";

describe("resolveSeoProfile", () => {
  it("is lockdown for a preview/noindex store", () => {
    expect(resolveSeoProfile(lockedManifest())).toBe("lockdown");
  });
  it("is open once the noindex flag is gone (default posture)", () => {
    expect(resolveSeoProfile(openManifest())).toBe("open");
  });
});

describe("buildRobots", () => {
  it("locks a preview store down entirely with no sitemap ref", () => {
    const robots = buildRobots(lockedManifest());
    expect(robots.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(robots.sitemap).toBeUndefined();
  });

  it("allows an open store and points at its sitemap", () => {
    const robots = buildRobots(openManifest());
    expect(robots.rules).toEqual([{ userAgent: "*", allow: "/" }]);
    expect(robots.sitemap).toBe(`${BASE}/sitemap.xml`);
  });
});

describe("buildSitemap", () => {
  const products = [product({ slug: "alpha" }), product({ slug: "beta" })];

  it("emits ONLY the homepage for a locked store (no catalog exposure)", () => {
    const entries = buildSitemap(lockedManifest(), products);
    expect(entries.map((entry) => entry.url)).toEqual([`${BASE}/`]);
  });

  it("lists home, the PLP, and every active product for an open store", () => {
    const entries = buildSitemap(openManifest(), products);
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain(`${BASE}/`);
    expect(urls).toContain(`${BASE}/products`);
    expect(urls).toContain(`${BASE}/products/alpha`);
    expect(urls).toContain(`${BASE}/products/beta`);
    // Exactly the products passed in — the caller supplies the active list, and
    // the builder never invents extra URLs.
    const productUrls = urls.filter((url) => url.startsWith(`${BASE}/products/`));
    expect(productUrls).toHaveLength(2);
  });

  it("attaches absolute image URLs when a product carries images", () => {
    const sha = "a".repeat(64);
    const withImage = product({
      slug: "imaged",
      images: [{ assetRef: `asset:store-leo-research/${sha}.png`, alt: "vial" }],
    });
    const entry = buildSitemap(openManifest(), [withImage]).find((e) =>
      e.url.endsWith("/products/imaged"),
    );
    expect(entry?.images).toEqual([`${BASE}/stores/store-leo-research/assets/${sha}.png`]);
  });

  it("advertises every collection for an open store", () => {
    const entries = buildSitemap(openManifest(), products, [
      { slug: "metabolic" },
      { slug: "cognitive" },
    ]);
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain(`${BASE}/collections/metabolic`);
    expect(urls).toContain(`${BASE}/collections/cognitive`);
  });

  it("emits NO collection URLs for a locked store", () => {
    const entries = buildSitemap(lockedManifest(), products, [{ slug: "metabolic" }]);
    expect(entries.map((entry) => entry.url)).toEqual([`${BASE}/`]);
  });
});

describe("canonical + page metadata", () => {
  it("canonicalUrl is always the primary domain, no query", () => {
    expect(canonicalUrl(openManifest(), "/products/x")).toBe(`${BASE}/products/x`);
    expect(canonicalUrl(openManifest(), "/")).toBe(`${BASE}/`);
  });

  it("home metadata sets the canonical on an open store", () => {
    expect(homeMetadata(openManifest()).alternates?.canonical).toBe(`${BASE}/`);
  });

  it("PDP canonical collapses ?variant= (path carries no query)", () => {
    const meta = productPageMetadata(openManifest(), product({ slug: "bpc-157" }));
    expect(meta.alternates?.canonical).toBe(`${BASE}/products/bpc-157`);
    expect(meta.openGraph?.title).toBe("BPC-157");
    expect(meta.twitter).toEqual({ card: "summary_large_image" });
  });

  it("collection metadata sets a canonical + OG on an open store", () => {
    const meta = collectionPageMetadata(openManifest(), {
      slug: "metabolic",
      title: "Metabolic",
      description: "Weight-management research peptides.",
    });
    expect(meta.alternates?.canonical).toBe(`${BASE}/collections/metabolic`);
    expect(meta.openGraph?.title).toBe("Metabolic");
    expect(meta.description).toBe("Weight-management research peptides.");
  });

  it("collection metadata for a locked store keeps title + adds only the primary-domain canonical", () => {
    const meta = collectionPageMetadata(lockedManifest(), {
      slug: "metabolic",
      title: "Metabolic",
    });
    // Canonical rides in lockdown too (audit P2, alias-host consolidation) —
    // it points at the store's OWN primary domain, leaking nothing new.
    expect(meta.alternates?.canonical).toBe(`${BASE}/collections/metabolic`);
    expect(meta.title).toBe("Metabolic");
    expect(meta.openGraph).toBeUndefined();
  });

  it("emits NO OG for a locked store (leaks nothing new beyond the self-canonical)", () => {
    const meta = productPageMetadata(lockedManifest(), product({ slug: "bpc-157" }));
    expect(meta.alternates?.canonical).toBe(`${BASE}/products/bpc-157`);
    expect(meta.openGraph).toBeUndefined();
    // Pre-epic posture survives: title + description only.
    expect(meta.title).toBe("BPC-157");
  });

  it("PLP metadata carries a Shop title and canonical when open", () => {
    const meta = productsPageMetadata(openManifest());
    expect(meta.title).toBe("Shop");
    expect(meta.alternates?.canonical).toBe(`${BASE}/products`);
  });

  it("home metadata carries the hero subheading as description even on a locked store", () => {
    // Both demo stores run lockdown — before this, lockdownMetadata was {}
    // and heroSubheading never reached the meta description (audit P2). The
    // subheading is copy the hero already renders publicly.
    const locked = homeMetadata(lockedManifest());
    expect(typeof locked.description).toBe("string");
    expect((locked.description ?? "").length).toBeGreaterThan(0);
    expect(locked.description).toBe(homeMetadata(openManifest()).description);
  });

  it("cart/checkout/search/collections pages carry their titles + canonicals", () => {
    expect(cartPageMetadata(openManifest()).title).toBe("Cart");
    expect(cartPageMetadata(openManifest()).alternates?.canonical).toBe(`${BASE}/cart`);
    expect(checkoutPageMetadata(openManifest()).title).toBe("Checkout");
    expect(searchPageMetadata(openManifest()).title).toBe("Search");
    expect(searchPageMetadata(openManifest()).alternates?.canonical).toBe(`${BASE}/search`);
    expect(collectionsIndexMetadata(openManifest()).title).toBe("Collections");
    // Locked stores keep the title and the primary-domain self-canonical.
    expect(cartPageMetadata(lockedManifest()).title).toBe("Cart");
    expect(cartPageMetadata(lockedManifest()).alternates?.canonical).toBe(`${BASE}/cart`);
  });
});

describe("layoutMetadata", () => {
  it("noindexes a locked store and sets metadataBase", () => {
    const meta = layoutMetadata(lockedManifest());
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.metadataBase?.toString()).toBe(`${BASE}/`);
  });

  it("does not noindex an open store", () => {
    expect(layoutMetadata(openManifest()).robots).toBeUndefined();
  });
});
