import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getManifestSource } from "@/lib/manifest-source";
import { buildRobots, lockedFallbackRobots } from "@/lib/seo";

/**
 * Per-host robots.txt (FD Epic 15). Resolves the store by Host header — this
 * one deployment serves many tenants, so robots differs per request. An
 * unresolvable host, or any store that is not `live`, fails safe to a total
 * `Disallow: /`. Reading `headers()` opts the route into dynamic rendering,
 * which is required for per-host resolution.
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";
  const resolution = await getManifestSource().resolve(host);
  if (!resolution) return lockedFallbackRobots();
  // A draft/suspended store is not publicly crawlable whatever its SEO mode.
  if (resolution.status !== "live") return lockedFallbackRobots();
  return buildRobots(resolution.manifest);
}
