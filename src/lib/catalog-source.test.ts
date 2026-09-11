import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureCatalogSource, LiveCommerceCatalogSource } from "@/lib/catalog-source";

describe("FixtureCatalogSource", () => {
  const source = new FixtureCatalogSource();

  it("lists per-storeKey products with integer-cent prices", async () => {
    const products = await source.listProducts("store-0-bio-archetype");
    expect(products.length).toBeGreaterThan(0);
    for (const product of products) {
      expect(Number.isInteger(product.priceCents)).toBe(true);
      for (const variant of product.variants) {
        expect(Number.isInteger(variant.priceCents)).toBe(true);
      }
    }
  });

  it("keeps catalogs isolated per storeKey", async () => {
    const bio = await source.listProducts("store-0-bio-archetype");
    const leo = await source.listProducts("store-leo-research");
    // Both stores are real RUO catalogs and legitimately share compound slugs,
    // so isolation means each storeKey resolves its OWN product record — not
    // disjoint slug sets. A shared slug must return store-specific data.
    const bySlug = (list: Awaited<ReturnType<typeof source.listProducts>>) =>
      new Map(list.map((p) => [p.slug, p]));
    const bioBySlug = bySlug(bio);
    const leoBySlug = bySlug(leo);
    // Store-unique products never leak across storeKeys.
    expect(bioBySlug.has("bpc-157")).toBe(true);
    expect(leoBySlug.has("bpc-157")).toBe(false);
    expect(leoBySlug.has("bacteriostatic-water")).toBe(true);
    expect(bioBySlug.has("bacteriostatic-water")).toBe(false);
    // Shared slugs resolve to each store's own record (distinct SKU space).
    const shared = [...bioBySlug.keys()].filter((slug) => leoBySlug.has(slug));
    expect(shared.length).toBeGreaterThan(0);
    for (const slug of shared) {
      const bioSkus = new Set(bioBySlug.get(slug)?.variants.map((v) => v.sku));
      for (const variant of leoBySlug.get(slug)?.variants ?? []) {
        expect(bioSkus.has(variant.sku)).toBe(false);
      }
    }
  });

  it("gets a product by slug and misses cleanly", async () => {
    const product = await source.getProduct("store-0-bio-archetype", "bpc-157");
    expect(product?.name).toBe("BPC-157");
    expect(await source.getProduct("store-0-bio-archetype", "not-a-product")).toBeNull();
  });

  it("returns [] and warns for an unknown storeKey", async () => {
    const warn = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await source.listProducts("no-such-store")).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("LiveCommerceCatalogSource", () => {
  const source = new LiveCommerceCatalogSource("https://api.example.test");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps commerce's wire shape onto Product, cheapest-variant priceCents, carried-through ids", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            products: [
              {
                id: "prod-1",
                slug: "bpc-157",
                name: "BPC-157",
                description: "A peptide",
                variants: [
                  {
                    id: "var-1",
                    sku: "BPC-157-5MG",
                    label: "5mg",
                    price_cents: 4000,
                    currency: "usd",
                  },
                  {
                    id: "var-2",
                    sku: "BPC-157-10MG",
                    label: null,
                    price_cents: 6000,
                    currency: "usd",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const products = await source.listProducts("acme-labs");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/commerce/v1/tenants/acme-labs/catalog/products",
      { cache: "no-store" },
    );
    expect(products).toHaveLength(1);
    expect(products[0]?.slug).toBe("bpc-157");
    expect(products[0]?.priceCents).toBe(4000); // cheapest variant
    expect(products[0]?.variants[0]?.label).toBe("5mg");
    // A null label falls back to the sku, never a blank/undefined label.
    expect(products[0]?.variants[1]?.label).toBe("BPC-157-10MG");
    expect((products[0] as unknown as { id: string }).id).toBe("prod-1");
    const secondVariant = products[0]?.variants[1];
    expect((secondVariant as unknown as { id: string }).id).toBe("var-2");
    expect(products[0]?.coaDocs).toEqual([]);
  });

  it("throws (never returns []) when the tenant catalog list 404s — a live-resolved tenant disagreeing with commerce is a fault, not an empty catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 }),
      ),
    );
    await expect(source.listProducts("acme-labs")).rejects.toThrow(/HTTP 404/);
  });

  it("throws on an unparseable list response rather than silently returning []", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ products: "not-an-array" }), { status: 200 }),
      ),
    );
    await expect(source.listProducts("acme-labs")).rejects.toThrow(/unparseable/);
  });

  it("getProduct returns null (genuine absence) on a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await source.getProduct("acme-labs", "no-such-slug")).toBeNull();
  });

  it("getProduct throws on a non-404 error rather than treating it as absence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(source.getProduct("acme-labs", "bpc-157")).rejects.toThrow(/HTTP 503/);
  });

  const PRODUCT_RESPONSE = {
    product: {
      id: "prod-1",
      slug: "bpc-157",
      name: "BPC-157",
      description: null,
      variants: [
        { id: "var-1", sku: "BPC-157-5MG", label: "5mg", price_cents: 4000, currency: "usd" },
      ],
    },
  };
  // A valid asset_ref (asset:<storeKey>/<64-hex>.<ext>) so lib/media resolves it.
  const COA_ASSET_REF = `asset:acme-labs/${"a".repeat(64)}.pdf`;

  it("getProduct maps a found product (and no released-lot COA -> empty coaDocs)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/coas")
          ? new Response(null, { status: 404 })
          : new Response(JSON.stringify(PRODUCT_RESPONSE), { status: 200 }),
      ),
    );
    const product = await source.getProduct("acme-labs", "bpc-157");
    expect(product?.name).toBe("BPC-157");
    expect(product?.description).toBeUndefined();
    expect(product?.coaDocs).toEqual([]);
  });

  it("getProduct hydrates released-lot COAs from inventory onto the product", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/coas")
          ? new Response(
              JSON.stringify({
                released_lots: [
                  {
                    internal_lot: "LOT-R1",
                    exp_date: "2027-01-01",
                    coas: [
                      {
                        doc_type: "purity",
                        asset_ref: COA_ASSET_REF,
                        test_date: "2026-05-01",
                        purity_percent: 99.2,
                        issuing_lab: "Janoshik",
                        vendor: "Acme",
                      },
                    ],
                  },
                ],
              }),
              { status: 200 },
            )
          : new Response(JSON.stringify(PRODUCT_RESPONSE), { status: 200 }),
      ),
    );
    const product = await source.getProduct("acme-labs", "bpc-157");
    expect(product?.coaDocs).toHaveLength(1);
    const doc = product?.coaDocs[0];
    expect(doc?.docType).toBe("purity");
    expect(doc?.lotNumber).toBe("LOT-R1");
    expect(doc?.testDate).toBe("2026-05-01");
    expect(doc?.purityPercent).toBe(99.2);
    // asset_ref resolved to a serving URL, never left as the raw ref.
    expect(doc?.url).toBe(`/stores/acme-labs/assets/${"a".repeat(64)}.pdf`);
  });

  it("getProduct treats a 404 from the COA read as a genuine absence (empty coaDocs)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/coas")
          ? new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 })
          : new Response(JSON.stringify(PRODUCT_RESPONSE), { status: 200 }),
      ),
    );
    const product = await source.getProduct("acme-labs", "bpc-157");
    expect(product?.coaDocs).toEqual([]);
  });

  it("getProduct THROWS (never returns []) when the COA read 500s — the honest-absence guard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/coas")
          ? new Response(null, { status: 500 })
          : new Response(JSON.stringify(PRODUCT_RESPONSE), { status: 200 }),
      ),
    );
    await expect(source.getProduct("acme-labs", "bpc-157")).rejects.toThrow(/HTTP 500/);
  });

  // ── rich content parity (commerce migration 0018) ────────────────────────

  const RICH_WIRE_PRODUCT = {
    id: "prod-1",
    slug: "bpc-157",
    name: "BPC-157",
    description: "A peptide",
    variants: [
      { id: "var-1", sku: "BPC-157-5MG", label: "5mg", price_cents: 4000, currency: "usd" },
    ],
    tagline: "Pentadecapeptide",
    category: "injectable",
    requires_reconstitution: true,
    overview: "Overview copy.",
    mechanism: "Mechanism copy.",
    paired_with: [{ slug: "ghk-cu", name: "GHK-Cu" }],
    images: [
      { asset_ref: `asset:acme-labs/${"b".repeat(64)}.png`, alt: "Vial" },
      {
        asset_ref: `asset:acme-labs/${"c".repeat(64)}.png`,
        alt: "10mg vial",
        variant_ref: "BPC-157-10MG",
      },
    ],
    coa_docs: [
      {
        label: "Purity (HPLC + MS)",
        url: "/coa/bpc-purity.pdf",
        doc_type: "purity",
        lot_number: "LOT-1",
        test_date: "2026-05-12",
        purity_percent: 99.4,
      },
    ],
    specs: [{ label: "Purity", value: ">=99% by HPLC" }],
    grid_variant_cards: true,
  };

  it("maps the live rich content fields onto the SAME camelCase Product shape the fixtures carry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ products: [RICH_WIRE_PRODUCT] }), { status: 200 }),
      ),
    );
    const [product] = await source.listProducts("acme-labs");
    expect(product?.tagline).toBe("Pentadecapeptide");
    expect(product?.category).toBe("injectable");
    expect(product?.requiresReconstitution).toBe(true);
    expect(product?.overview).toBe("Overview copy.");
    expect(product?.mechanism).toBe("Mechanism copy.");
    expect(product?.pairedWith).toEqual([{ slug: "ghk-cu", name: "GHK-Cu" }]);
    expect(product?.images).toEqual([
      { assetRef: `asset:acme-labs/${"b".repeat(64)}.png`, alt: "Vial" },
      {
        assetRef: `asset:acme-labs/${"c".repeat(64)}.png`,
        alt: "10mg vial",
        variantRef: "BPC-157-10MG",
      },
    ]);
    expect(product?.specs).toEqual([{ label: "Purity", value: ">=99% by HPLC" }]);
    expect(product?.gridVariantCards).toBe(true);
    // Authored COA docs ride the LIST response too (the grid's COA chip).
    expect(product?.coaDocs).toEqual([
      {
        label: "Purity (HPLC + MS)",
        url: "/coa/bpc-purity.pdf",
        docType: "purity",
        lotNumber: "LOT-1",
        testDate: "2026-05-12",
        purityPercent: 99.4,
      },
    ]);
  });

  it("null rich fields map to ABSENT (a store without editorial content renders honestly, no invented copy)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              products: [
                {
                  ...RICH_WIRE_PRODUCT,
                  tagline: null,
                  category: null,
                  requires_reconstitution: null,
                  overview: null,
                  mechanism: null,
                  paired_with: null,
                  images: null,
                  coa_docs: null,
                  specs: null,
                  grid_variant_cards: null,
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const [product] = await source.listProducts("acme-labs");
    expect(product?.tagline).toBeUndefined();
    expect(product?.category).toBeUndefined();
    expect(product?.requiresReconstitution).toBeUndefined();
    expect(product?.overview).toBeUndefined();
    expect(product?.mechanism).toBeUndefined();
    expect(product?.pairedWith).toBeUndefined();
    expect(product?.images).toBeUndefined();
    expect(product?.specs).toBeUndefined();
    expect(product?.gridVariantCards).toBeUndefined();
    expect(product?.coaDocs).toEqual([]);
  });

  it("a backend that PREDATES the rich-content contract still parses (fields default to null/absent)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              products: [
                {
                  id: "prod-1",
                  slug: "bpc-157",
                  name: "BPC-157",
                  description: null,
                  variants: [],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const [product] = await source.listProducts("acme-labs");
    expect(product?.slug).toBe("bpc-157");
    expect(product?.tagline).toBeUndefined();
    expect(product?.images).toBeUndefined();
  });

  it("getProduct merges AUTHORED coa_docs first, then inventory released-lot COAs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/coas")
          ? new Response(
              JSON.stringify({
                released_lots: [
                  {
                    internal_lot: "LOT-R1",
                    exp_date: null,
                    coas: [
                      {
                        doc_type: "sterility",
                        asset_ref: COA_ASSET_REF,
                        test_date: null,
                        purity_percent: null,
                        issuing_lab: null,
                        vendor: null,
                      },
                    ],
                  },
                ],
              }),
              { status: 200 },
            )
          : new Response(JSON.stringify({ product: RICH_WIRE_PRODUCT }), { status: 200 }),
      ),
    );
    const product = await source.getProduct("acme-labs", "bpc-157");
    expect(product?.coaDocs).toHaveLength(2);
    expect(product?.coaDocs[0]?.docType).toBe("purity"); // authored, first
    expect(product?.coaDocs[1]?.docType).toBe("sterility"); // inventory lot
    expect(product?.coaDocs[1]?.lotNumber).toBe("LOT-R1");
  });
});

describe("FixtureCatalogSource collections + faceted search", () => {
  const rawCatalogs = {
    t: {
      products: [
        {
          slug: "a",
          name: "Alpha peptide",
          priceCents: 2000,
          variants: [{ label: "x", sku: "A", priceCents: 2000 }],
        },
        {
          slug: "b",
          name: "Beta peptide",
          priceCents: 4000,
          variants: [{ label: "x", sku: "B", priceCents: 4000 }],
        },
        {
          slug: "c",
          name: "Gamma peptide",
          priceCents: 8000,
          variants: [{ label: "x", sku: "C", priceCents: 8000 }],
        },
      ],
    },
  };
  const collections = {
    t: [{ slug: "budget", title: "Budget", description: "Cheap picks", productSlugs: ["a", "b"] }],
  };
  const source = new FixtureCatalogSource(rawCatalogs, collections);

  it("lists collection metadata and hydrates members, missing cleanly", async () => {
    expect(await source.listCollections("t")).toEqual([
      { slug: "budget", title: "Budget", description: "Cheap picks" },
    ]);
    const collection = await source.getCollection("t", "budget");
    expect(collection?.products.map((p) => p.slug)).toEqual(["a", "b"]);
    expect(await source.getCollection("t", "no-such")).toBeNull();
  });

  it("faceted search computes price-bucket + collection counts over the matched set", async () => {
    const { products, facets } = await source.searchProductsFaceted("t", "peptide");
    expect(products.map((p) => p.slug).sort()).toEqual(["a", "b", "c"]);
    // buckets: a(2000)->0, b(4000)->1, c(8000)->2, rest 0.
    expect(facets.priceBuckets.map((b) => b.count)).toEqual([1, 1, 1, 0, 0]);
    expect(facets.priceBuckets[4]?.maxCents).toBeNull();
    expect(facets.collections).toEqual([{ slug: "budget", title: "Budget", count: 2 }]);
  });

  it("a price filter narrows results but leaves facet counts describing the full match", async () => {
    const { products, facets } = await source.searchProductsFaceted("t", "peptide", {
      filters: { minPriceCents: 2500, maxPriceCents: 10000 },
    });
    expect(products.map((p) => p.slug).sort()).toEqual(["b", "c"]);
    expect(facets.priceBuckets.map((b) => b.count)).toEqual([1, 1, 1, 0, 0]);
  });

  it("a collection filter narrows to that collection's matched products", async () => {
    const { products } = await source.searchProductsFaceted("t", "peptide", {
      filters: { collection: "budget" },
    });
    expect(products.map((p) => p.slug).sort()).toEqual(["a", "b"]);
  });

  it("an empty query yields no results and empty facets", async () => {
    const result = await source.searchProductsFaceted("t", "   ");
    expect(result.products).toEqual([]);
    expect(result.facets.priceBuckets).toEqual([]);
    expect(result.facets.collections).toEqual([]);
  });
});

describe("LiveCommerceCatalogSource collections + faceted search", () => {
  const source = new LiveCommerceCatalogSource("https://api.example.test");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the faceted-search wire shape and forwards filter params", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            products: [
              {
                id: "prod-1",
                slug: "bpc-157",
                name: "BPC-157",
                description: null,
                variants: [
                  { id: "v1", sku: "BPC-5", label: "5mg", price_cents: 4000, currency: "usd" },
                ],
              },
            ],
            facets: {
              price_buckets: [{ min_cents: 2500, max_cents: 5000, count: 1 }],
              collections: [{ slug: "budget", title: "Budget", count: 3 }],
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { products, facets } = await source.searchProductsFaceted("acme-labs", "bpc", {
      filters: { minPriceCents: 2500, maxPriceCents: 5000, collection: "budget" },
    });
    expect(products[0]?.slug).toBe("bpc-157");
    expect(facets.priceBuckets).toEqual([{ minCents: 2500, maxCents: 5000, count: 1 }]);
    expect(facets.collections).toEqual([{ slug: "budget", title: "Budget", count: 3 }]);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("min_price_cents=2500");
    expect(url).toContain("max_price_cents=5000");
    expect(url).toContain("collection=budget");
  });

  it("faceted search throws on a backend error, never an empty result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(source.searchProductsFaceted("acme-labs", "bpc")).rejects.toThrow(/HTTP 503/);
  });

  it("lists collections and maps a null description to undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              collections: [
                { slug: "budget", title: "Budget", description: "Cheap" },
                { slug: "premium", title: "Premium", description: null },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    expect(await source.listCollections("acme-labs")).toEqual([
      { slug: "budget", title: "Budget", description: "Cheap" },
      { slug: "premium", title: "Premium" },
    ]);
  });

  it("getCollection returns null on a 404, maps products on a hit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await source.getCollection("acme-labs", "no-such")).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              collection: { slug: "budget", title: "Budget", description: "Cheap" },
              products: [
                {
                  id: "prod-1",
                  slug: "kpv",
                  name: "KPV",
                  description: null,
                  variants: [
                    { id: "v1", sku: "KPV-5", label: "5mg", price_cents: 2100, currency: "usd" },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const collection = await source.getCollection("acme-labs", "budget");
    expect(collection?.title).toBe("Budget");
    expect(collection?.products.map((p) => p.slug)).toEqual(["kpv"]);
  });
});
