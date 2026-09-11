import { z } from "zod";
import type { StoreManifest } from "@/lib/manifest";

/**
 * Product slug 301 aliases (FD Epic 15). When a product is renamed its old
 * `/products/{old-slug}` URL must not 404 or, worse, serve duplicate content —
 * it must 301 to the current `/products/{current-slug}` so link equity and
 * bookmarks survive the rename.
 *
 * DATA SOURCE: commerce owns no slug history — `commerce.products` has a single
 * `slug` column, no `previous_slug`/alias table (verified 2026-08-31). So the
 * alias map is manifest-driven for now: a lenient `catalog.slugAliases`
 * mapping `oldSlug → currentSlug`, read here from the manifest's passthrough
 * bag (the schema lane owns lib/manifest.ts; this reader never widens it).
 * This is a REAL source — a store that renames a product records the mapping —
 * not a stub. THE SEAM: when commerce grows first-class slug history, swap this
 * reader for a `getPreviousSlugs(tenant)` catalog read; the redirect mechanism
 * (middleware.ts) and the decision function below stay unchanged.
 *
 * The mechanism only ever fires for a slug that ISN'T a live product (see
 * middleware.ts + the PDP `notFound` fall-through), so a redirect can never
 * shadow a real product page.
 */

const slugAliasesSchema = z.record(z.string(), z.string());

/** `oldSlug → currentSlug` map from the manifest, or `{}` when absent/malformed. */
export function readProductSlugAliases(manifest: StoreManifest): Record<string, string> {
  const raw = (manifest.catalog as { slugAliases?: unknown }).slugAliases;
  const parsed = slugAliasesSchema.safeParse(raw ?? {});
  if (!parsed.success) return {};
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(parsed.data)) {
    const oldSlug = from.trim();
    const currentSlug = to.trim();
    // A self-alias or an empty target is meaningless — drop it (a self-alias
    // would 301 a URL to itself: a redirect loop).
    if (oldSlug.length === 0 || currentSlug.length === 0 || oldSlug === currentSlug) continue;
    out[oldSlug] = currentSlug;
  }
  return out;
}

/**
 * The current slug a requested `slug` should 301 to, or null when it is not a
 * known alias. Follows a single hop only — alias maps are authored old→current,
 * never chained.
 */
export function resolveProductSlugAlias(manifest: StoreManifest, slug: string): string | null {
  return readProductSlugAliases(manifest)[slug.trim()] ?? null;
}
