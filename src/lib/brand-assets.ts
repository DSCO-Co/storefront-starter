import type { Metadata } from "next";
import { z } from "zod";
import type { StoreManifest } from "@/lib/manifest";
/**
 * brand.assets reader (LOO-3043) — the storefront side of the manifest's
 * media block. The manifest schema itself is OWNED BY ANOTHER LANE
 * (fd-w13-behavior-config adds the zod block to lib/manifest.ts); until then
 * — and forever, for older manifests — `brand.assets` arrives through the
 * brand object's `.passthrough()`, so this module parses it leniently from
 * the untyped remainder. THE shape (pinned, additive-optional):
 *
 *   brand: { …, assets?: { logoRef?, faviconRef?, ogImageRef? } }
 *
 * each ref an `asset:<storeKey>/<sha256>.<ext>` media ref.
 *
 * `brandAssetMetadata` is the layout-metadata seam the SEO lane (Epic 15)
 * consumes: favicon + OG image wired from refs, silently absent when unset.
 */
import { assetUrl } from "@/lib/media";

export const brandAssetsSchema = z
  .object({
    logoRef: z.string().optional(),
    faviconRef: z.string().optional(),
    ogImageRef: z.string().optional(),
  })
  .passthrough();

export type BrandAssets = z.infer<typeof brandAssetsSchema>;

/** Lenient read: absent/malformed assets read as {} — never a render failure. */
export function readBrandAssets(manifest: Pick<StoreManifest, "brand">): BrandAssets {
  const raw = (manifest.brand as { assets?: unknown }).assets;
  const parsed = brandAssetsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * Favicon + OG-image metadata derived from brand.assets — merge into the
 * store layout's generateMetadata result. Refs that don't resolve (malformed)
 * contribute nothing.
 */
export function brandAssetMetadata(manifest: Pick<StoreManifest, "brand">): Metadata {
  const assets = readBrandAssets(manifest);
  const faviconUrl = assets.faviconRef ? assetUrl(assets.faviconRef) : null;
  const ogImageUrl = assets.ogImageRef ? assetUrl(assets.ogImageRef) : null;
  return {
    ...(faviconUrl ? { icons: { icon: faviconUrl } } : {}),
    ...(ogImageUrl
      ? {
          openGraph: {
            images: [{ url: ogImageUrl, alt: manifest.brand.name }],
          },
        }
      : {}),
  };
}
