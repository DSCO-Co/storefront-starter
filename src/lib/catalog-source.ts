import {
  type CoaDoc,
  type CoaDocType,
  coaDocTypeSchema,
  type Product,
  productCategorySchema,
  productSchema,
} from "@dscodotco/storefront-sections/model/catalog";
import { z } from "zod";
import designDarkCatalog from "@/fixtures/catalog/design-dark.json";
import designLightCatalog from "@/fixtures/catalog/design-light.json";
import bioArchetypeCatalog from "@/fixtures/catalog/store-0-bio-archetype.json";
import leoResearchCatalog from "@/fixtures/catalog/store-leo-research.json";
import { defaultCopyVars, sanitizeCopyDeep } from "@/lib/copy-tokens";
import { resolveFixtureModeGate } from "@/lib/fixture-mode";
import { createLogger } from "@/lib/logger";
import { assetUrl } from "@/lib/media";

// Catalog schemas, types, and pure helpers moved to `@dscodotco/storefront-sections`
// (client-safe — this module is server-only via `@platform/sdk-commerce` ->
// node-fetch). Re-exported so `@/lib/catalog-source` stays the storefront's
// catalog entry point for existing callers; server-only fetching/resolution
// (`getCatalogSource`, `LiveCommerceCatalogSource`, faceted search) stays here.
export * from "@dscodotco/storefront-sections/model/catalog";

/**
 * Product catalog — ported from the Loop platform's `apps/storefront`
 * (`lib/catalog-source.ts`). The parent app had an SDK-backed source against
 * `services/commerce` — this surface has no SDK (ADR 0003 bans a bespoke
 * fetch to a module the renderer isn't contract-bound to), so
 * `LiveCommerceCatalogSource` below calls `@dscodotco/commerce`'s PUBLIC catalog
 * route (`GET /commerce/v1/tenants/:tenant/catalog/products[/:slug]`) — the
 * route this renderer's fleet-renderer/headless contract-identity design
 * (ADR 0003) is built for: same tenant-scoped shape a headless SDK would
 * expose. Selection mirrors `manifest-source.ts`'s live/fixture seam
 * exactly: `FLIGHTDECK_API_URL` set -> live, unset (local dev / tests) ->
 * bundled fixtures.
 *
 * Every caller passes `ManifestResolution.tenantRef` (never
 * `manifest.catalog.storeKey` directly) as the key — fixture manifests set
 * `tenantRef = storeKey` (see manifest-source.ts), so the SAME call site
 * works unmodified against either source.
 */

const logger = createLogger("catalog-source");

const catalogFileSchema = z.object({ products: z.array(productSchema) });

export type ProductSearchOptions = { limit?: number; offset?: number };

// ── Collections + faceted search (FD Epic 14/15) ───────────────────────────

/** A collection's public metadata (the `/collections/:slug` PLP + sitemap). */
export type CollectionSummary = {
  slug: string;
  title: string;
  description?: string;
};

/** A collection plus its live (active) products, for the PLP page. */
export type CollectionWithProducts = CollectionSummary & {
  products: Product[];
};

/** One price-range bucket count. `maxCents` null = open-ended top bucket. */
export type PriceBucketFacet = { minCents: number; maxCents: number | null; count: number };
/** One collection's product-count within the current query's matched set. */
export type CollectionFacetCount = { slug: string; title: string; count: number };
/** Server-computed facet counts that drive the search filter sidebar. */
export type SearchFacets = {
  priceBuckets: PriceBucketFacet[];
  collections: CollectionFacetCount[];
};
/** A faceted search response: the (filtered, paged) results + the facet counts. */
export type FacetedSearchResult = { products: Product[]; facets: SearchFacets };

/** Optional search filters (price range in cents + one collection slug). */
export type ProductSearchFilters = {
  minPriceCents?: number;
  maxPriceCents?: number;
  collection?: string;
};

/** The facets shape for a "no query" / empty result — no options, all zero. */
export const EMPTY_FACETS: SearchFacets = { priceBuckets: [], collections: [] };

export type CatalogSource = {
  listProducts(storeKey: string): Promise<Product[]>;
  getProduct(storeKey: string, slug: string): Promise<Product | null>;
  /**
   * Ranked product search (LOO-3044). An empty/whitespace query returns
   * `[]` (a valid "no query", not an error). Backend failures THROW — a
   * failed search is never laundered into an empty result set.
   */
  searchProducts(
    storeKey: string,
    query: string,
    options?: ProductSearchOptions,
  ): Promise<Product[]>;
  /**
   * Faceted product search (FD Epic 14). Returns the filtered+paged results
   * AND the facet counts (price buckets + collections) computed server-side
   * over the query-matched set. An empty/whitespace query returns no results
   * and empty facets. Backend failures THROW — never an empty result set.
   */
  searchProductsFaceted(
    storeKey: string,
    query: string,
    options?: ProductSearchOptions & { filters?: ProductSearchFilters },
  ): Promise<FacetedSearchResult>;
  /** All collections for a store (metadata only). Backend failures THROW. */
  listCollections(storeKey: string): Promise<CollectionSummary[]>;
  /**
   * One collection + its live products, or `null` if no such slug. A backend
   * failure (as distinct from a genuine miss) THROWS — never a null "absent".
   */
  getCollection(storeKey: string, slug: string): Promise<CollectionWithProducts | null>;
};

/**
 * Price-facet bucket boundaries (integer cents), MIRRORING the server's
 * PRICE_FACET_BUCKETS in @dscodotco/commerce. The live source passes the server's
 * counts through unchanged; these bounds only drive the FIXTURE stand-in
 * below (dev/test), exactly as `fixtureMatches` stands in for the live FTS
 * ranking. Kept in sync by construction — the live path never recomputes.
 */
const FIXTURE_PRICE_BUCKETS: readonly { minCents: number; maxCents: number | null }[] = [
  { minCents: 0, maxCents: 2500 },
  { minCents: 2500, maxCents: 5000 },
  { minCents: 5000, maxCents: 10000 },
  { minCents: 10000, maxCents: 25000 },
  { minCents: 25000, maxCents: null },
];

/** A product's `from` price — its cheapest variant, else the product-level price. */
function fromPriceCents(product: Product): number {
  return product.variants.length > 0
    ? Math.min(...product.variants.map((variant) => variant.priceCents))
    : product.priceCents;
}

/** Bucket a set of products into the fixed price buckets (zero-count buckets kept). */
function bucketByPrice(products: Product[]): PriceBucketFacet[] {
  return FIXTURE_PRICE_BUCKETS.map((bucket) => ({
    minCents: bucket.minCents,
    maxCents: bucket.maxCents,
    count: products.filter((product) => {
      const price = fromPriceCents(product);
      return price >= bucket.minCents && (bucket.maxCents === null || price < bucket.maxCents);
    }).length,
  }));
}

/**
 * Fixture collection definition (dev/test only) — a collection's metadata
 * plus the slugs of its member products. The FixtureCatalogSource has no
 * commerce DB, so collections are supplied to its constructor; production
 * always uses the live source, which reads the real model over HTTP.
 */
export type FixtureCollection = CollectionSummary & { productSlugs: string[] };

/**
 * Fixture-only, in-memory matcher (dev/test) — a lightweight stand-in for
 * the live module's Postgres full-text + trigram ranking. Substring match
 * over the same fields the grid's client filter uses; NOT the production
 * ranking, which lives in @dscodotco/commerce.
 */
function fixtureMatches(product: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return [product.name, product.description ?? "", product.tagline ?? "", product.slug]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

const FIXTURE_CATALOGS: Record<string, unknown> = {
  "store-0-bio-archetype": bioArchetypeCatalog,
  "store-leo-research": leoResearchCatalog,
  "design-dark": designDarkCatalog,
  "design-light": designLightCatalog,
};

/**
 * Default dev/test collections for the bundled fixture stores — a stand-in
 * for the real commerce collection model, exactly as FIXTURE_CATALOGS stands
 * in for the live catalog. Production never uses this (the live source reads
 * the model over HTTP). Member slugs reference products in the fixtures above.
 */
const FIXTURE_COLLECTIONS: Record<string, FixtureCollection[]> = {
  "store-leo-research": [
    {
      slug: "metabolic",
      title: "Metabolic",
      description: "Peptides in metabolic and weight-management research.",
      productSlugs: ["lean", "lean-burn", "lean-oral", "mots-c", "5-amino-1mq", "tesofensine"],
    },
    {
      slug: "cognitive",
      title: "Cognitive",
      description: "Nootropic and neuro-focused research peptides.",
      productSlugs: ["selank", "semax", "dsip", "bdnf-p21"],
    },
    {
      slug: "recovery",
      title: "Recovery",
      description: "Tissue-repair and recovery research peptides.",
      productSlugs: ["kpv", "ghk-cu", "thymosin-alpha-1", "ara-290"],
    },
  ],
};

export class FixtureCatalogSource implements CatalogSource {
  private readonly byStoreKey = new Map<string, Product[]>();
  private readonly collectionsByStoreKey = new Map<string, FixtureCollection[]>();

  constructor(
    rawCatalogs: Record<string, unknown> = FIXTURE_CATALOGS,
    collections: Record<string, FixtureCollection[]> = {},
  ) {
    for (const [storeKey, raw] of Object.entries(rawCatalogs)) {
      this.byStoreKey.set(
        storeKey,
        sanitizeCopyDeep(catalogFileSchema.parse(raw).products, defaultCopyVars(), (token) =>
          logger.warn("stripped unresolved copy token from catalog", { storeKey, token }),
        ),
      );
    }
    for (const [storeKey, defs] of Object.entries(collections)) {
      this.collectionsByStoreKey.set(storeKey, defs);
    }
  }

  listProducts(storeKey: string): Promise<Product[]> {
    const products = this.byStoreKey.get(storeKey);
    if (!products) {
      logger.warn("no fixture catalog for storeKey", { storeKey });
      return Promise.resolve([]);
    }
    return Promise.resolve(products);
  }

  async getProduct(storeKey: string, slug: string): Promise<Product | null> {
    const products = await this.listProducts(storeKey);
    return products.find((product) => product.slug === slug) ?? null;
  }

  async searchProducts(
    storeKey: string,
    query: string,
    options?: ProductSearchOptions,
  ): Promise<Product[]> {
    if (query.trim().length === 0) return [];
    const products = await this.listProducts(storeKey);
    const matched = products.filter((product) => fixtureMatches(product, query));
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? matched.length;
    return matched.slice(offset, offset + limit);
  }

  async searchProductsFaceted(
    storeKey: string,
    query: string,
    options?: ProductSearchOptions & { filters?: ProductSearchFilters },
  ): Promise<FacetedSearchResult> {
    if (query.trim().length === 0) return { products: [], facets: EMPTY_FACETS };
    const products = await this.listProducts(storeKey);
    // Facets are computed over the query-matched set WITHOUT price/collection
    // filters applied (same contract as the live server) — so the sidebar
    // always shows every option and its full count.
    const matched = products.filter((product) => fixtureMatches(product, query));
    const collections = this.collectionsByStoreKey.get(storeKey) ?? [];
    const membership = new Map<string, Set<string>>();
    for (const collection of collections) {
      membership.set(collection.slug, new Set(collection.productSlugs));
    }
    const facets: SearchFacets = {
      priceBuckets: bucketByPrice(matched),
      collections: collections
        .map((collection) => ({
          slug: collection.slug,
          title: collection.title,
          count: matched.filter((product) => membership.get(collection.slug)?.has(product.slug))
            .length,
        }))
        .filter((facet) => facet.count > 0)
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
    };

    const filters = options?.filters;
    const filtered = matched.filter((product) => {
      if (filters?.collection !== undefined) {
        if (!membership.get(filters.collection)?.has(product.slug)) return false;
      }
      const price = fromPriceCents(product);
      if (filters?.minPriceCents !== undefined && price < filters.minPriceCents) return false;
      if (filters?.maxPriceCents !== undefined && price > filters.maxPriceCents) return false;
      return true;
    });
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? filtered.length;
    return { products: filtered.slice(offset, offset + limit), facets };
  }

  listCollections(storeKey: string): Promise<CollectionSummary[]> {
    const defs = this.collectionsByStoreKey.get(storeKey) ?? [];
    return Promise.resolve(
      defs.map(({ slug, title, description }) => ({
        slug,
        title,
        ...(description !== undefined ? { description } : {}),
      })),
    );
  }

  async getCollection(storeKey: string, slug: string): Promise<CollectionWithProducts | null> {
    const defs = this.collectionsByStoreKey.get(storeKey) ?? [];
    const def = defs.find((collection) => collection.slug === slug);
    if (!def) return null;
    const products = await this.listProducts(storeKey);
    const bySlug = new Map(products.map((product) => [product.slug, product]));
    const members = def.productSlugs
      .map((productSlug) => bySlug.get(productSlug))
      .filter((product): product is Product => product !== undefined);
    return {
      slug: def.slug,
      title: def.title,
      ...(def.description !== undefined ? { description: def.description } : {}),
      products: members,
    };
  }
}

// ── Live source — GET {FLIGHTDECK_API_URL}/commerce/v1/tenants/:tenant/
//    catalog/products[/:slug] ────────────────────────────────────────────

/** The public commerce catalog route's variant shape (snake_case, over the wire). */
const commerceVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  label: z.string().nullable(),
  price_cents: z.number().int().nonnegative(),
  currency: z.string(),
});

/** The public commerce catalog route's product shape (already status='active' filtered server-side). */
const commerceProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  variants: z.array(commerceVariantSchema),
  // FD Epic 7 — subscribe-and-save catalog signal. Present on every live
  // product; a store that never ran the subscription migration would still
  // parse (these default false/null).
  is_subscription: z.boolean().default(false),
  subscription_interval: z.enum(["day", "week", "month", "year"]).nullable().default(null),
  subscription_interval_count: z.number().int().positive().nullable().default(null),
  subscription_price_cents: z.number().int().nonnegative().nullable().default(null),
  // Rich editorial content (commerce migration 0018 — live/fixture content
  // parity). Every field nullable AND defaulted, so a backend that predates
  // the migration still parses; NULL = "not authored", which maps to the
  // fixture model's absent-optional — the PDP/PLP render honestly without
  // it, never with invented copy.
  tagline: z.string().nullable().default(null),
  category: productCategorySchema.nullable().default(null),
  requires_reconstitution: z.boolean().nullable().default(null),
  overview: z.string().nullable().default(null),
  mechanism: z.string().nullable().default(null),
  // Server-resolved cross-sells: commerce resolves paired_with_slugs to
  // {slug, name} refs against the tenant's own active catalog at read time.
  paired_with: z
    .array(z.object({ slug: z.string(), name: z.string() }).passthrough())
    .nullable()
    .default(null),
  images: z
    .array(
      z
        .object({
          asset_ref: z.string().min(1),
          alt: z.string().min(1),
          variant_ref: z.string().optional(),
        })
        .passthrough(),
    )
    .nullable()
    .default(null),
  coa_docs: z
    .array(
      z
        .object({
          label: z.string().min(1),
          url: z.string().min(1),
          doc_type: coaDocTypeSchema.optional(),
          lot_number: z.string().optional(),
          test_date: z.string().optional(),
          purity_percent: z.number().min(0).max(100).optional(),
        })
        .passthrough(),
    )
    .nullable()
    .default(null),
  specs: z
    .array(z.object({ label: z.string(), value: z.string() }).passthrough())
    .nullable()
    .default(null),
  grid_variant_cards: z.boolean().nullable().default(null),
});

/** The public collections list route's item shape. */
const commerceCollectionSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
});

/** The public collection-detail route's shape. */
const commerceCollectionDetailSchema = z.object({
  collection: commerceCollectionSummarySchema,
  products: z.array(commerceProductSchema),
});

/** The faceted-search route's facet block. */
const commerceFacetsSchema = z.object({
  price_buckets: z.array(
    z.object({
      min_cents: z.number().int().nonnegative(),
      max_cents: z.number().int().nonnegative().nullable(),
      count: z.number().int().nonnegative(),
    }),
  ),
  collections: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

function mapCommerceCollectionSummary(
  raw: z.infer<typeof commerceCollectionSummarySchema>,
): CollectionSummary {
  return {
    slug: raw.slug,
    title: raw.title,
    ...(raw.description !== null ? { description: raw.description } : {}),
  };
}

function mapCommerceFacets(raw: z.infer<typeof commerceFacetsSchema>): SearchFacets {
  return {
    priceBuckets: raw.price_buckets.map((bucket) => ({
      minCents: bucket.min_cents,
      maxCents: bucket.max_cents,
      count: bucket.count,
    })),
    collections: raw.collections.map((collection) => ({
      slug: collection.slug,
      title: collection.title,
      count: collection.count,
    })),
  };
}

// ── @dscodotco/inventory: released-lot COA read (the PDP's provenance) ──────────

/** One COA on the inventory wire (snake_case). `doc_type` is the pinned enum. */
const inventoryCoaSchema = z.object({
  doc_type: coaDocTypeSchema,
  asset_ref: z.string(),
  test_date: z.string().nullable(),
  purity_percent: z.number().min(0).max(100).nullable(),
  issuing_lab: z.string().nullable(),
  vendor: z.string().nullable(),
});

/** One released lot and the COAs attached to it, as returned by inventory. */
const inventoryReleasedLotSchema = z.object({
  internal_lot: z.string(),
  exp_date: z.string().nullable(),
  coas: z.array(inventoryCoaSchema),
});

/** Human label per doc type — the link text on the PDP (badge shows the type too). */
const COA_DOC_TYPE_LABELS: Record<CoaDocType, string> = {
  purity: "Purity",
  sterility: "Sterility",
  "heavy-metals": "Heavy Metals",
  endotoxin: "Endotoxin",
};

/**
 * Flatten released lots' COAs into the storefront's `CoaDoc[]`, resolving each
 * `asset_ref` to a serving URL via `lib/media.ts` (the same mechanical
 * resolution product imagery uses). A ref that fails to resolve (malformed
 * data) is dropped rather than rendered as a broken link — its absence is
 * data corruption, not the honest-absence case the read-level throw guards.
 */
function mapReleasedLotsToCoaDocs(
  lots: ReadonlyArray<z.infer<typeof inventoryReleasedLotSchema>>,
): CoaDoc[] {
  const docs: CoaDoc[] = [];
  for (const lot of lots) {
    for (const coa of lot.coas) {
      const url = assetUrl(coa.asset_ref);
      if (url === null) continue;
      docs.push({
        label: COA_DOC_TYPE_LABELS[coa.doc_type],
        url,
        docType: coa.doc_type,
        lotNumber: lot.internal_lot,
        ...(coa.test_date !== null ? { testDate: coa.test_date } : {}),
        ...(coa.purity_percent !== null ? { purityPercent: coa.purity_percent } : {}),
      });
    }
  }
  return docs;
}

/**
 * Maps `@dscodotco/commerce`'s wire shape onto this surface's `Product` type.
 * `id`/variant `id` are carried through (schemas are `.passthrough()`) so
 * cart/checkout have the real commerce product/variant UUIDs to send back
 * — `commerceProductId()` (product-shared.ts) already prefers `product.id`
 * over the slug for exactly this reason. `priceCents` at the product level
 * is the cheapest variant (mirrors the grid section's own "from" price
 * logic).
 *
 * `coaDocs` merges two sources: the catalog's own authored `coa_docs`
 * (commerce migration 0018 — editorial COA links, the fixture model's
 * shape) first, then any released-lot COAs hydrated from inventory
 * (`extraCoaDocs`, PDP only). A live product with neither correctly shows
 * no COA chip rather than an invented one.
 *
 * The rich editorial fields (tagline/category/overview/mechanism/images/
 * paired_with/specs/…, migration 0018) map 1:1 onto the SAME camelCase
 * `Product` fields the fixture catalogs carry, so the PDP and product grid
 * receive identical props in live and fixture mode. NULL (not authored)
 * maps to the field being absent — never an empty-string/empty-array stand-in.
 */
function mapCommerceProduct(
  raw: z.infer<typeof commerceProductSchema>,
  extraCoaDocs: CoaDoc[] = [],
): Product {
  const variants = raw.variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    label: variant.label ?? variant.sku,
    priceCents: variant.price_cents,
  }));
  const priceCents = variants.length > 0 ? Math.min(...variants.map((v) => v.priceCents)) : 0;
  const authoredCoaDocs: CoaDoc[] = (raw.coa_docs ?? []).map((doc) => ({
    label: doc.label,
    url: doc.url,
    ...(doc.doc_type !== undefined ? { docType: doc.doc_type } : {}),
    ...(doc.lot_number !== undefined ? { lotNumber: doc.lot_number } : {}),
    ...(doc.test_date !== undefined ? { testDate: doc.test_date } : {}),
    ...(doc.purity_percent !== undefined ? { purityPercent: doc.purity_percent } : {}),
  }));
  return productSchema.parse({
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    ...(raw.description !== null ? { description: raw.description } : {}),
    priceCents,
    variants,
    coaDocs: [...authoredCoaDocs, ...extraCoaDocs],
    ...(raw.tagline !== null ? { tagline: raw.tagline } : {}),
    ...(raw.category !== null ? { category: raw.category } : {}),
    ...(raw.requires_reconstitution !== null
      ? { requiresReconstitution: raw.requires_reconstitution }
      : {}),
    ...(raw.overview !== null ? { overview: raw.overview } : {}),
    ...(raw.mechanism !== null ? { mechanism: raw.mechanism } : {}),
    ...(raw.paired_with !== null
      ? { pairedWith: raw.paired_with.map(({ slug, name }) => ({ slug, name })) }
      : {}),
    ...(raw.images !== null
      ? {
          images: raw.images.map((image) => ({
            assetRef: image.asset_ref,
            alt: image.alt,
            ...(image.variant_ref !== undefined ? { variantRef: image.variant_ref } : {}),
          })),
        }
      : {}),
    ...(raw.specs !== null
      ? { specs: raw.specs.map(({ label, value }) => ({ label, value })) }
      : {}),
    ...(raw.grid_variant_cards !== null ? { gridVariantCards: raw.grid_variant_cards } : {}),
    // FD Epic 7: carry the subscribe-and-save signal onto the storefront
    // Product so the PDP can mark a line subscription-eligible for checkout.
    isSubscription: raw.is_subscription,
    ...(raw.subscription_interval !== null
      ? { subscriptionInterval: raw.subscription_interval }
      : {}),
    ...(raw.subscription_interval_count !== null
      ? { subscriptionIntervalCount: raw.subscription_interval_count }
      : {}),
    ...(raw.subscription_price_cents !== null
      ? { subscriptionPriceCents: raw.subscription_price_cents }
      : {}),
  });
}

export class LiveCommerceCatalogSource implements CatalogSource {
  constructor(private readonly apiBaseUrl: string) {}

  /**
   * The released-lot COAs for one item, joined by `sku` == inventory's
   * `sku_root` (the SAME exact-string seam fulfillment uses). HONEST ABSENCE:
   * a 404 or genuinely-empty result → `[]` (no cert on file, fine); a non-OK
   * status or an unparseable body → THROW, exactly like `getProduct` does for
   * commerce — a FAILED read is never degraded to `[]`, which would render "no
   * certificate" for a product that actually has one (root CLAUDE.md's "a
   * failed read is never an empty result").
   */
  private async fetchCoaDocs(tenantRef: string, sku: string): Promise<CoaDoc[]> {
    const res = await fetch(
      `${this.apiBaseUrl}/inventory/v1/tenants/${encodeURIComponent(tenantRef)}/items/${encodeURIComponent(sku)}/coas`,
      { cache: "no-store" },
    );
    if (res.status === 404) {
      // Genuine absence: no inventory item for this sku_root (a product may
      // legitimately have no lot-tracked stock). Distinct from a fault.
      return [];
    }
    if (!res.ok) {
      const message = `inventory COA read failed with HTTP ${res.status} for ${tenantRef}/${sku}`;
      logger.error(message, { tenantRef, sku, httpStatus: res.status });
      throw new Error(message);
    }
    const body = (await res.json()) as { released_lots?: unknown };
    const parsed = z.array(inventoryReleasedLotSchema).safeParse(body.released_lots);
    if (!parsed.success) {
      const message = "inventory COA read returned an unparseable response";
      logger.error(message, { tenantRef, sku, issues: parsed.error.issues });
      throw new Error(message);
    }
    return mapReleasedLotsToCoaDocs(parsed.data);
  }

  async listProducts(tenantRef: string): Promise<Product[]> {
    const res = await fetch(
      `${this.apiBaseUrl}/commerce/v1/tenants/${encodeURIComponent(tenantRef)}/catalog/products`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      // Includes 404: commerce's public catalog route 404s ONLY for an
      // unknown or non-'live' tenant (see modules/commerce/src/index.ts's
      // requireLiveStore) — and this renderer only reaches here after
      // stores' own /v1/resolve already confirmed the tenant IS live. A
      // 404/error here means the two services disagree, which is a real
      // fault, NEVER laundered into an empty catalog (root CLAUDE.md's "a
      // failed read is never an empty result").
      const message = `commerce catalog list failed with HTTP ${res.status} for tenant ${tenantRef}`;
      logger.error(message, { tenantRef, httpStatus: res.status });
      throw new Error(message);
    }
    const body = (await res.json()) as { products?: unknown };
    const parsed = z.array(commerceProductSchema).safeParse(body.products);
    if (!parsed.success) {
      const message = "commerce catalog list returned an unparseable response";
      logger.error(message, { tenantRef, issues: parsed.error.issues });
      throw new Error(message);
    }
    return parsed.data.map((raw) => mapCommerceProduct(raw));
  }

  async getProduct(tenantRef: string, slug: string): Promise<Product | null> {
    const res = await fetch(
      `${this.apiBaseUrl}/commerce/v1/tenants/${encodeURIComponent(tenantRef)}/catalog/products/${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    );
    if (res.status === 404) {
      // Product-level absence: this endpoint also 404s when the STORE
      // isn't live, but the renderer only ever calls it once it already
      // knows the store is live (same reasoning as listProducts above), so
      // in practice a 404 here is a genuine per-slug miss — a bad/stale
      // link, not "we don't know". Documented tradeoff, not a stub: see
      // this PR's changeset.
      return null;
    }
    if (!res.ok) {
      const message = `commerce product lookup failed with HTTP ${res.status} for ${tenantRef}/${slug}`;
      logger.error(message, { tenantRef, slug, httpStatus: res.status });
      throw new Error(message);
    }
    const body = (await res.json()) as { product?: unknown };
    const parsed = commerceProductSchema.safeParse(body.product);
    if (!parsed.success) {
      const message = "commerce product lookup returned an unparseable response";
      logger.error(message, { tenantRef, slug, issues: parsed.error.issues });
      throw new Error(message);
    }
    // Hydrate released-lot COAs from inventory, joined on the primary variant's
    // sku == sku_root (one call per product's item; no per-variant fan-out).
    // A product with no variant sku maps to no join key → no COA read.
    const sku = parsed.data.variants[0]?.sku;
    const coaDocs =
      sku !== undefined && sku.length > 0 ? await this.fetchCoaDocs(tenantRef, sku) : [];
    return mapCommerceProduct(parsed.data, coaDocs);
  }

  async searchProducts(
    tenantRef: string,
    query: string,
    options?: ProductSearchOptions,
  ): Promise<Product[]> {
    if (query.trim().length === 0) return [];
    const params = new URLSearchParams({ q: query });
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined) params.set("offset", String(options.offset));
    const res = await fetch(
      `${this.apiBaseUrl}/commerce/v1/tenants/${encodeURIComponent(tenantRef)}/catalog/search?${params.toString()}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      // Same posture as listProducts: the caller only reaches here after
      // stores' /v1/resolve confirmed the store is live, so an error here
      // is a genuine fault (the two services disagree, or the DB read
      // failed) — NEVER laundered into an empty result set (root
      // CLAUDE.md's "a failed read is never an empty result").
      const message = `commerce catalog search failed with HTTP ${res.status} for tenant ${tenantRef}`;
      logger.error(message, { tenantRef, httpStatus: res.status });
      throw new Error(message);
    }
    const body = (await res.json()) as { products?: unknown };
    const parsed = z.array(commerceProductSchema).safeParse(body.products);
    if (!parsed.success) {
      const message = "commerce catalog search returned an unparseable response";
      logger.error(message, { tenantRef, issues: parsed.error.issues });
      throw new Error(message);
    }
    return parsed.data.map((raw) => mapCommerceProduct(raw));
  }

  async searchProductsFaceted(
    tenantRef: string,
    query: string,
    options?: ProductSearchOptions & { filters?: ProductSearchFilters },
  ): Promise<FacetedSearchResult> {
    if (query.trim().length === 0) return { products: [], facets: EMPTY_FACETS };
    const params = new URLSearchParams({ q: query });
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined) params.set("offset", String(options.offset));
    const filters = options?.filters;
    if (filters?.minPriceCents !== undefined)
      params.set("min_price_cents", String(filters.minPriceCents));
    if (filters?.maxPriceCents !== undefined)
      params.set("max_price_cents", String(filters.maxPriceCents));
    if (filters?.collection !== undefined) params.set("collection", filters.collection);
    const res = await fetch(
      `${this.apiBaseUrl}/commerce/v1/tenants/${encodeURIComponent(tenantRef)}/catalog/search?${params.toString()}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      const message = `commerce faceted search failed with HTTP ${res.status} for tenant ${tenantRef}`;
      logger.error(message, { tenantRef, httpStatus: res.status });
      throw new Error(message);
    }
    const body = (await res.json()) as { products?: unknown; facets?: unknown };
    const parsedProducts = z.array(commerceProductSchema).safeParse(body.products);
    const parsedFacets = commerceFacetsSchema.safeParse(body.facets);
    if (!parsedProducts.success || !parsedFacets.success) {
      const message = "commerce faceted search returned an unparseable response";
      logger.error(message, {
        tenantRef,
        productIssues: parsedProducts.success ? undefined : parsedProducts.error.issues,
        facetIssues: parsedFacets.success ? undefined : parsedFacets.error.issues,
      });
      throw new Error(message);
    }
    return {
      products: parsedProducts.data.map((raw) => mapCommerceProduct(raw)),
      facets: mapCommerceFacets(parsedFacets.data),
    };
  }

  async listCollections(tenantRef: string): Promise<CollectionSummary[]> {
    const res = await fetch(
      `${this.apiBaseUrl}/commerce/v1/tenants/${encodeURIComponent(tenantRef)}/catalog/collections`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      // Same posture as listProducts: reached only after stores' /v1/resolve
      // confirmed the store is live, so an error here is a genuine fault,
      // NEVER laundered into an empty collection list.
      const message = `commerce collections list failed with HTTP ${res.status} for tenant ${tenantRef}`;
      logger.error(message, { tenantRef, httpStatus: res.status });
      throw new Error(message);
    }
    const body = (await res.json()) as { collections?: unknown };
    const parsed = z.array(commerceCollectionSummarySchema).safeParse(body.collections);
    if (!parsed.success) {
      const message = "commerce collections list returned an unparseable response";
      logger.error(message, { tenantRef, issues: parsed.error.issues });
      throw new Error(message);
    }
    return parsed.data.map(mapCommerceCollectionSummary);
  }

  async getCollection(tenantRef: string, slug: string): Promise<CollectionWithProducts | null> {
    const res = await fetch(
      `${this.apiBaseUrl}/commerce/v1/tenants/${encodeURIComponent(tenantRef)}/catalog/collections/${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    );
    if (res.status === 404) {
      // Genuine per-slug miss (the store-live gate is already known passed —
      // same reasoning as getProduct). A bad/stale link, not "we don't know".
      return null;
    }
    if (!res.ok) {
      const message = `commerce collection lookup failed with HTTP ${res.status} for ${tenantRef}/${slug}`;
      logger.error(message, { tenantRef, slug, httpStatus: res.status });
      throw new Error(message);
    }
    const parsed = commerceCollectionDetailSchema.safeParse(await res.json());
    if (!parsed.success) {
      const message = "commerce collection lookup returned an unparseable response";
      logger.error(message, { tenantRef, slug, issues: parsed.error.issues });
      throw new Error(message);
    }
    return {
      ...mapCommerceCollectionSummary(parsed.data.collection),
      products: parsed.data.products.map((raw) => mapCommerceProduct(raw)),
    };
  }
}

// ── Selection ────────────────────────────────────────────────────────────

let fixtureCatalogSource: FixtureCatalogSource | null = null;
let liveCatalogSource: LiveCommerceCatalogSource | null = null;

/**
 * The single place that decides which CatalogSource the renderer uses —
 * mirrors `manifest-source.ts`'s `getManifestSource()` exactly:
 * `FLIGHTDECK_API_URL` set -> the live commerce module; unset (local dev /
 * tests) -> bundled fixtures.
 */
export function getCatalogSource(): CatalogSource {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (apiBaseUrl) {
    liveCatalogSource ??= new LiveCommerceCatalogSource(apiBaseUrl.replace(/\/+$/, ""));
    return liveCatalogSource;
  }
  // F4 (completeness sweep 2026-08-31): mirrors manifest-source.ts — an
  // unset FLIGHTDECK_API_URL used to fall back to bundled demo fixtures
  // with no log, the exact hazard checkout.ts's own gate guards against.
  const gate = resolveFixtureModeGate({
    nodeEnv: process.env.NODE_ENV,
    allowFixtureMode: process.env.ALLOW_FIXTURE_MODE,
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV,
  });
  if (!gate.allowed) {
    throw new Error(`catalog-source: ${gate.reason}`);
  }
  logger.warn(
    "catalog-source: FLIGHTDECK_API_URL is not set — serving BUNDLED FIXTURE catalogs, not " +
      "the live commerce module. Expected in dev/test; a hazard anywhere else.",
  );
  fixtureCatalogSource ??= new FixtureCatalogSource(FIXTURE_CATALOGS, FIXTURE_COLLECTIONS);
  return fixtureCatalogSource;
}
