import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StoreUnavailable } from "@/components/store-unavailable";
import { getCatalogSource } from "@/lib/catalog-source";
import { getRequestManifest } from "@/lib/request-manifest";
import { collectionsIndexMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const resolution = await getRequestManifest();
  if (resolution?.manifest.store.status !== "live") return {};
  return collectionsIndexMetadata(resolution.manifest);
}

/**
 * Collections index (audit P2): `/collections/{slug}` pages exist and are
 * linked from search facets + the sitemap, but the bare `/collections` was a
 * 404. Minimal by design — list the store's collections; a store with none
 * redirects to the full catalog at `/products` (there is nothing to index
 * here, and a dead-end empty page helps nobody). A backend failure THROWS
 * via the catalog source (the error boundary) — never an empty list
 * pretending the store has no collections.
 */
export default async function CollectionsIndexPage() {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const { manifest } = resolution;

  if (manifest.store.status !== "live") {
    return <StoreUnavailable brandName={manifest.brand.name} />;
  }

  const collections = await getCatalogSource().listCollections(resolution.tenantRef);
  if (collections.length === 0) redirect("/products");

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-12">
      <a href="/products" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
        ← Shop
      </a>
      <h1
        className="mt-6 text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Collections
      </h1>
      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {collections.map((collection) => (
          <li
            key={collection.slug}
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-surface-1, var(--color-surface)) 92%, transparent)",
              borderRadius: "var(--radius-card, 16px)",
              border: "1px solid var(--color-line-soft, var(--color-border))",
            }}
          >
            <a href={`/collections/${collection.slug}`} className="block p-5">
              <h2
                className="text-lg font-semibold"
                style={{ color: "var(--color-ink-1, var(--color-text))" }}
              >
                {collection.title}
              </h2>
              {collection.description ? (
                <p
                  className="mt-1 line-clamp-2 text-sm"
                  style={{ color: "var(--color-ink-3, var(--color-muted))" }}
                >
                  {collection.description}
                </p>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
