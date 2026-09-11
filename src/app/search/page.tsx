import { AssetImage } from "@dscodotco/storefront-sections/components/media/asset-image";
import {
  VialStage,
  VialVisual,
} from "@dscodotco/storefront-sections/components/product/vial-visual";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreUnavailable } from "@/components/store-unavailable";
import { TrackOnMount } from "@/components/track/track-on-mount";
import {
  type CollectionFacetCount,
  getCatalogSource,
  imageForVariant,
  type PriceBucketFacet,
  type Product,
  type ProductSearchFilters,
} from "@/lib/catalog-source";
import { formatCents } from "@/lib/format";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";
import { searchPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const resolution = await getRequestManifest();
  if (resolution?.manifest.store.status !== "live") return {};
  return searchPageMetadata(resolution.manifest);
}

type RawSearchParams = {
  q?: string;
  min_price_cents?: string;
  max_price_cents?: string;
  collection?: string;
};
type SearchParams = { searchParams: Promise<RawSearchParams> };

/** Parse a non-negative integer-cents query param; anything else = undefined. */
function parseCents(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Build a `/search?…` href, merging the current params with overrides (null clears). */
function buildHref(
  current: RawSearchParams,
  overrides: Partial<Record<keyof RawSearchParams, string | null>>,
): string {
  const params = new URLSearchParams();
  const merged: RawSearchParams = { ...current };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete merged[key as keyof RawSearchParams];
    else merged[key as keyof RawSearchParams] = value;
  }
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  const qs = params.toString();
  return qs.length > 0 ? `/search?${qs}` : "/search";
}

function priceBucketLabel(bucket: PriceBucketFacet): string {
  if (bucket.maxCents === null) return `${formatCents(bucket.minCents)}+`;
  if (bucket.minCents === 0) return `Under ${formatCents(bucket.maxCents)}`;
  return `${formatCents(bucket.minCents)} – ${formatCents(bucket.maxCents)}`;
}

/**
 * Search results page (LOO-3044 + FD Epic 14 faceted search). Consumes the
 * live commerce faceted-search route via
 * `getCatalogSource().searchProductsFaceted` — Postgres full-text + trigram
 * ranking (migration 0007) with server-computed facet COUNTS (price buckets
 * + collections), NOT a client-side filter.
 *
 * The filter sidebar is link-driven (plain GET navigation, no client JS): a
 * facet is a link that merges its param into the URL and re-queries;
 * selecting an active facet again clears it. Behind the `search.enabled`
 * gate: an opted-out store 404s. A non-live store shows the standard
 * unavailable surface. The search READ throws on backend failure (catalog
 * source → error boundary) rather than a "0 results" that never ran — a
 * failed read is never an empty result.
 */
export default async function SearchPage({ searchParams }: SearchParams) {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const { manifest } = resolution;

  if (manifest.store.status !== "live") {
    return <StoreUnavailable brandName={manifest.brand.name} />;
  }

  const behavior = resolveBehavior(manifest);
  if (!behavior.search.enabled) notFound();

  const raw = await searchParams;
  const query = raw.q?.trim() ?? "";
  const minPriceCents = parseCents(raw.min_price_cents);
  const maxPriceCents = parseCents(raw.max_price_cents);
  const collection = raw.collection?.trim() ? raw.collection.trim() : undefined;
  const filters: ProductSearchFilters = {
    ...(minPriceCents !== undefined ? { minPriceCents } : {}),
    ...(maxPriceCents !== undefined ? { maxPriceCents } : {}),
    ...(collection !== undefined ? { collection } : {}),
  };

  const result =
    query.length > 0
      ? await getCatalogSource().searchProductsFaceted(resolution.tenantRef, query, { filters })
      : { products: [], facets: { priceBuckets: [], collections: [] } };
  const { products, facets } = result;
  const hasFacets =
    facets.priceBuckets.some((bucket) => bucket.count > 0) || facets.collections.length > 0;
  const anyFilterActive =
    minPriceCents !== undefined || maxPriceCents !== undefined || collection !== undefined;

  return (
    <main id="main" className="mx-auto max-w-6xl px-6 py-12">
      <a href="/" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
        ← {manifest.brand.name}
      </a>
      <h1
        className="mt-6 text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Search
      </h1>

      <search className="mt-6 block">
        <form action="/search" method="get" className="flex max-w-xl gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search products"
            aria-label="Search products"
            className="fd-input flex-1 px-4 py-2 text-sm"
          />
          {/* Preserve active filters across a new text query. */}
          {minPriceCents !== undefined ? (
            <input type="hidden" name="min_price_cents" value={String(minPriceCents)} />
          ) : null}
          {maxPriceCents !== undefined ? (
            <input type="hidden" name="max_price_cents" value={String(maxPriceCents)} />
          ) : null}
          {collection !== undefined ? (
            <input type="hidden" name="collection" value={collection} />
          ) : null}
          <button type="submit" className="fd-btn fd-btn-primary fd-btn-sm">
            Search
          </button>
        </form>
      </search>

      {query.length === 0 ? (
        <p className="mt-10 text-sm" style={{ color: "var(--color-muted)" }}>
          Enter a search term to find products.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[16rem_1fr]">
          {/* SEARCH funnel fire — once per results view (each new query
                remounts it), consent-gated + forwarded via /api/track. */}
          <TrackOnMount event={{ eventType: "SEARCH", query }} />
          {hasFacets ? (
            <FilterSidebar
              raw={raw}
              priceBuckets={facets.priceBuckets}
              collections={facets.collections}
              activeMin={minPriceCents}
              activeMax={maxPriceCents}
              activeCollection={collection}
              anyFilterActive={anyFilterActive}
            />
          ) : (
            <div />
          )}
          <div>
            {products.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>
                No products match “{query}”{anyFilterActive ? " with the selected filters" : ""}.
              </p>
            ) : (
              <>
                <p className="text-xs uppercase" style={{ color: "var(--color-muted)" }}>
                  {products.length} {products.length === 1 ? "result" : "results"} for “{query}”
                </p>
                <ul className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {products.map((product) => (
                    <SearchResultCard key={product.slug} product={product} />
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function FilterSidebar({
  raw,
  priceBuckets,
  collections,
  activeMin,
  activeMax,
  activeCollection,
  anyFilterActive,
}: {
  raw: RawSearchParams;
  priceBuckets: PriceBucketFacet[];
  collections: CollectionFacetCount[];
  activeMin: number | undefined;
  activeMax: number | undefined;
  activeCollection: string | undefined;
  anyFilterActive: boolean;
}) {
  return (
    <aside aria-label="Filters" className="flex flex-col gap-6 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold" style={{ color: "var(--color-ink-1, var(--color-text))" }}>
          Filters
        </h2>
        {anyFilterActive ? (
          <a
            href={buildHref(raw, {
              min_price_cents: null,
              max_price_cents: null,
              collection: null,
            })}
            className="text-xs underline"
            style={{ color: "var(--color-primary)" }}
          >
            Clear all
          </a>
        ) : null}
      </div>

      {priceBuckets.some((bucket) => bucket.count > 0) ? (
        <section>
          <h3
            className="mb-2 text-xs font-semibold uppercase"
            style={{ color: "var(--color-muted)" }}
          >
            Price
          </h3>
          <ul className="flex flex-col gap-1">
            {priceBuckets.map((bucket) => {
              const active =
                activeMin === bucket.minCents &&
                (bucket.maxCents === null
                  ? activeMax === undefined
                  : activeMax === bucket.maxCents);
              const href = active
                ? buildHref(raw, { min_price_cents: null, max_price_cents: null })
                : buildHref(raw, {
                    min_price_cents: String(bucket.minCents),
                    max_price_cents: bucket.maxCents === null ? null : String(bucket.maxCents),
                  });
              return (
                <li key={`${bucket.minCents}-${bucket.maxCents ?? "max"}`}>
                  <FacetLink
                    href={href}
                    active={active}
                    label={priceBucketLabel(bucket)}
                    count={bucket.count}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {collections.length > 0 ? (
        <section>
          <h3
            className="mb-2 text-xs font-semibold uppercase"
            style={{ color: "var(--color-muted)" }}
          >
            Collection
          </h3>
          <ul className="flex flex-col gap-1">
            {collections.map((facet) => {
              const active = activeCollection === facet.slug;
              const href = active
                ? buildHref(raw, { collection: null })
                : buildHref(raw, { collection: facet.slug });
              return (
                <li key={facet.slug}>
                  <FacetLink href={href} active={active} label={facet.title} count={facet.count} />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}

function FacetLink({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "true" : undefined}
      className="flex items-center justify-between rounded-md px-2 py-1"
      style={{
        color: "var(--color-ink-1, var(--color-text))",
        backgroundColor: active
          ? "color-mix(in srgb, var(--color-primary) 14%, transparent)"
          : "transparent",
        fontWeight: active ? 600 : 400,
      }}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true">{active ? "✓" : "+"}</span>
        {label}
      </span>
      <span style={{ color: "var(--color-muted)" }}>{count}</span>
    </a>
  );
}

function SearchResultCard({ product }: { product: Product }) {
  const variants = product.variants;
  const cheapest =
    variants.length > 0 ? Math.min(...variants.map((v) => v.priceCents)) : product.priceCents;
  const image = imageForVariant(product, variants.length === 1 ? (variants[0] ?? null) : null);

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
        <a href={`/products/${product.slug}`}>
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-ink-1, var(--color-text))" }}
          >
            {product.name}
          </h2>
        </a>
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
          <a href={`/products/${product.slug}`} className="fd-btn fd-btn-secondary fd-btn-sm">
            View
          </a>
        </div>
      </div>
    </li>
  );
}
