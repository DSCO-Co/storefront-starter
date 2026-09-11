import { cookies, headers } from "next/headers";
import { cache } from "react";
import {
  type ManifestResolution,
  resolveManifest,
  resolveManifestByTenant,
} from "@/lib/manifest-source";
import { PREVIEW_COOKIE, previewAllowedOnHost, resolvePreviewByToken } from "@/lib/preview";

/**
 * Request-scoped manifest resolution. THREE modes, in precedence order:
 *
 *  0. DRAFT PREVIEW — when the short-lived httpOnly `fd_preview` cookie
 *     (set by the middleware's `?__preview=` handshake) holds a token that
 *     still verifies, resolve THAT tenant+version via the stores module's
 *     preview-resolve route — but ONLY if the token's tenant matches what
 *     this request would otherwise resolve to (pinned tenant, or the
 *     Host-resolved tenant; the shared onrender host, which resolves no
 *     tenant, is the sanctioned preview surface). Any failure — expired
 *     token, backend unavailable, tenant mismatch — falls through to the
 *     live modes below: the preview BANNER is the one honest signal that a
 *     draft is being rendered, so its absence always means "this is live".
 *     Preview resolutions bypass the manifest-source process cache entirely.
 *
 *  1. ENV-PINNED single-tenant (headless) — when `FLIGHTDECK_TENANT` is set,
 *     this deploy IS one store. Resolve that tenant directly and ignore the
 *     request Host entirely, so the store renders on an ephemeral
 *     `*.vercel.app` preview URL or before a custom domain is verified. This
 *     is the mode a customer's own cloned storefront runs in.
 *
 *  2. HOST-resolved multi-tenant (the platform-hosted surface) — read the
 *     incoming `Host` header and resolve it via `manifest-source.ts` (ADR
 *     0003's fail-closed exception — `Host → verified domain row →
 *     tenant_ref`, unknown host = a real 404).
 *
 * Wrapped in React's `cache()` so `layout.tsx` and `page.tsx` share ONE
 * resolution per request instead of racing two fetches.
 */
export const getRequestManifest = cache(async (): Promise<ManifestResolution | null> => {
  const pinnedTenant = process.env.FLIGHTDECK_TENANT?.trim() || null;
  const hostHeader = (await headers()).get("host");

  const liveResolution = async (): Promise<ManifestResolution | null> => {
    if (pinnedTenant) return resolveManifestByTenant(pinnedTenant);
    if (!hostHeader) return null;
    return resolveManifest(hostHeader);
  };

  const previewToken = (await cookies()).get(PREVIEW_COOKIE)?.value;
  if (previewToken === undefined || previewToken.length === 0) {
    return liveResolution();
  }

  const outcome = await resolvePreviewByToken(previewToken);
  if (outcome.kind !== "resolved") {
    // Expired/invalid token, or a backend we could not reach: render live.
    // The cookie expires on its own; nothing here may pretend to be a draft.
    return liveResolution();
  }

  // The cross-tenant refusal: the token must be for the store this request
  // would resolve to anyway (or land on the shared/pinned preview surface).
  const live = await liveResolution();
  const allowed = previewAllowedOnHost({
    previewTenant: outcome.resolution.tenantRef,
    hostname: hostHeader ?? "",
    hostTenant: live?.tenantRef ?? null,
    pinnedTenant,
  });
  if (!allowed) return live;

  return {
    storeId: outcome.resolution.storeId,
    tenantRef: outcome.resolution.tenantRef,
    status: outcome.resolution.status,
    manifest: outcome.resolution.manifest,
    preview: outcome.resolution.preview,
  };
});
