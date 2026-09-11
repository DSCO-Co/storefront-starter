"use client";

/**
 * Custom next/image loader (next.config.ts `images.loaderFile`) — the
 * OpenNext-compatible path: NO Next image-optimization server is involved;
 * URLs go straight to the CDN (or same-origin public/ in dev/demo).
 *
 * Asset URLs (media-pipeline refs, LOO-3043) are rewritten to their sized
 * webp variants when NEXT_PUBLIC_ASSET_VARIANTS=1 (see lib/media.ts); every
 * other src passes through unchanged. Pure function, no node APIs — safe in
 * both the client bundle and the server render.
 */
import { readMediaEnv, sizedAssetUrl } from "@/lib/media";

// biome-ignore lint/style/noDefaultExport: next.config `images.loaderFile` requires the loader as the module's default export.
export default function assetImageLoader({ src, width }: { src: string; width: number }): string {
  return sizedAssetUrl(src, width, readMediaEnv());
}
