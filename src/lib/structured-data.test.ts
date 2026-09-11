import { describe, expect, it } from "vitest";
import leoResearch from "@/fixtures/manifests/store-leo-research.json";
import { type Product, productSchema } from "@/lib/catalog-source";
import { type StoreManifest, storeManifestSchema } from "@/lib/manifest";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  organizationJsonLd,
  productBreadcrumbJsonLd,
  productJsonLd,
  serializeJsonLd,
  websiteJsonLd,
} from "@/lib/structured-data";

const BASE = "https://leo.localhost";

function manifest(): StoreManifest {
  const { preview: _preview, ...rest } = leoResearch as Record<string, unknown>;
  return storeManifestSchema.parse(rest);
}

function product(overrides: Partial<Product> = {}): Product {
  return productSchema.parse({
    slug: "bpc-157",
    name: "BPC-157",
    description: "Research peptide.",
    priceCents: 21900,
    variants: [{ label: "5mg", sku: "LEO-BPC-5", priceCents: 21900 }],
    ...overrides,
  });
}

describe("productJsonLd", () => {
  it("builds a Product with a single Offer (price as decimal string, USD)", () => {
    const json = productJsonLd(manifest(), product());
    expect(json["@type"]).toBe("Product");
    expect(json.name).toBe("BPC-157");
    expect(json.url).toBe(`${BASE}/products/bpc-157`);
    expect(json.brand).toEqual({ "@type": "Brand", name: manifest().brand.name });
    expect(json.sku).toBe("LEO-BPC-5");
    expect(json.offers).toEqual({
      "@type": "Offer",
      price: "219.00",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: `${BASE}/products/bpc-157`,
    });
  });

  it("builds an AggregateOffer over the price range for multiple variants", () => {
    const json = productJsonLd(
      manifest(),
      product({
        variants: [
          { label: "5mg", sku: "A", priceCents: 21900 },
          { label: "10mg", sku: "B", priceCents: 39900 },
        ],
      }),
    );
    expect(json.offers).toMatchObject({
      "@type": "AggregateOffer",
      lowPrice: "219.00",
      highPrice: "399.00",
      priceCurrency: "USD",
      offerCount: 2,
      availability: "https://schema.org/InStock",
    });
  });

  it("marks OutOfStock from an explicit non-positive stock signal", () => {
    const json = productJsonLd(manifest(), product({ stock: 0 } as Partial<Product>));
    expect((json.offers as { availability: string }).availability).toBe(
      "https://schema.org/OutOfStock",
    );
  });
});

describe("organizationJsonLd + websiteJsonLd", () => {
  it("Organization is neutral name + url", () => {
    const json = organizationJsonLd(manifest());
    expect(json["@type"]).toBe("Organization");
    expect(json.name).toBe(manifest().brand.name);
    expect(json.url).toBe(`${BASE}/`);
    expect(json.logo).toBeUndefined();
  });

  it("WebSite attaches a SearchAction when the store offers search", () => {
    // leo fixture has no behavior block → search defaults enabled.
    const json = websiteJsonLd(manifest());
    expect(json["@type"]).toBe("WebSite");
    expect(json.potentialAction).toMatchObject({
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE}/search?q={search_term_string}`,
      },
    });
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers positions 1-based and omits the last item's URL", () => {
    const json = productBreadcrumbJsonLd(manifest(), product());
    expect(json["@type"]).toBe("BreadcrumbList");
    const items = json.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: manifest().brand.name,
      item: `${BASE}/`,
    });
    expect(items[2]).toEqual({ "@type": "ListItem", position: 3, name: "BPC-157" });
  });

  it("a plain breadcrumb keeps a trailing item without a URL", () => {
    const json = breadcrumbJsonLd([{ name: "Home", url: `${BASE}/` }, { name: "Shop" }]);
    const items = json.itemListElement as Array<Record<string, unknown>>;
    expect(items[1]).toEqual({ "@type": "ListItem", position: 2, name: "Shop" });
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so catalog copy can never break out of the script element", () => {
    const json = faqJsonLd([{ question: "<script>", answer: "safe" }]);
    expect(serializeJsonLd(json)).not.toContain("<script>");
    expect(serializeJsonLd(json)).toContain("\\u003cscript>");
  });
});
