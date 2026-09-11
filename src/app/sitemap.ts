import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getCatalogSource } from "@/lib/catalog-source";
import { getManifestSource } from "@/lib/manifest-source";
import { buildSitemap } from "@/lib/seo";

/**
 * Per-host sitemap.xml (FD Epic 15). Resolves the store by Host header (same
 * as robots.ts). A `locked` store (the default, and forced for Store #0 /
 * preview / noindex) emits ONLY `/`; an `open` store emits the full live
 * catalog + PLP + policy pages. A non-live or unresolvable host yields an
 * empty sitemap. The catalog read is the LIVE active-products list — a failed
 * read throws (catalog-source.ts), never launders into a partial sitemap.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host") ?? "";
  const resolution = await getManifestSource().resolve(host);
  if (resolution?.status !== "live") return [];
  const source = getCatalogSource();
  const [products, collections] = await Promise.all([
    source.listProducts(resolution.tenantRef),
    source.listCollections(resolution.tenantRef),
  ]);
  return buildSitemap(resolution.manifest, products, collections);
}
