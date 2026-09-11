import { createLogger } from "@/lib/logger";
import { type StoreManifest, type StoreStatus, storeManifestSchema } from "@/lib/manifest";

const logger = createLogger("preview");

/**
 * Draft-preview mode — the site builder's "see it on the real renderer
 * before publishing" path.
 *
 * A request carrying `?__preview=<token>` (any page) is intercepted by the
 * middleware: the token is verified against the stores module's PUBLIC
 * `GET /stores/v1/preview-resolve?token=` route, stashed in the short-lived
 * httpOnly `fd_preview` cookie, and the visitor is redirected to the clean
 * URL. While the cookie holds a valid token, `request-manifest.ts` resolves
 * the TOKENED tenant+version instead of Host resolution — but only when the
 * token's tenant matches the Host-resolved tenant (never a cross-tenant
 * preview on someone else's domain; the shared onrender host, which resolves
 * no tenant of its own, is the sanctioned preview surface).
 *
 * Cache honesty: preview resolutions NEVER touch `FlightdeckManifestSource`'s
 * process ETag cache — every previewed request is a fresh `no-store` fetch,
 * so a preview can never pollute (or be polluted by) live rendering.
 */
export const PREVIEW_COOKIE = "fd_preview";
export const PREVIEW_QUERY_PARAM = "__preview";

export interface PreviewResolution {
  readonly storeId: string;
  readonly tenantRef: string;
  readonly status: StoreStatus;
  readonly manifest: StoreManifest;
  readonly preview: { readonly version: number; readonly expiresAt: string };
}

export type PreviewResolveOutcome =
  /** Token verified; this is the draft to render. */
  | { readonly kind: "resolved"; readonly resolution: PreviewResolution }
  /** The API said 404: expired, tampered, or the version is gone. A real "no". */
  | { readonly kind: "invalid" }
  /**
   * We could NOT find out: no API configured (fixture mode), transport
   * failure, 5xx, or an unparseable body. Never conflated with `invalid` —
   * unknown and absent are different types.
   */
  | { readonly kind: "unavailable" };

/**
 * Hosts on which a preview is allowed WITHOUT a matching Host-resolved
 * tenant: the shared onrender surface (which serves many stores and
 * resolves none of them at its own hostname) and local dev.
 */
export function isSharedPreviewHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  return host.endsWith(".onrender.com") || host === "localhost" || host === "127.0.0.1";
}

/**
 * The cross-tenant refusal, as one pure decision:
 *  - env-pinned deploy (`FLIGHTDECK_TENANT`): the token must be for THAT store;
 *  - a Host that resolves to a tenant: the token must match it;
 *  - a Host that resolves to nothing: allowed only on the shared preview host.
 */
export function previewAllowedOnHost(input: {
  readonly previewTenant: string;
  readonly hostname: string;
  readonly hostTenant: string | null;
  readonly pinnedTenant: string | null;
}): boolean {
  if (input.pinnedTenant !== null && input.pinnedTenant.length > 0) {
    return input.previewTenant === input.pinnedTenant;
  }
  if (input.hostTenant !== null) {
    return input.previewTenant === input.hostTenant;
  }
  return isSharedPreviewHost(input.hostname);
}

/**
 * Verify + resolve a preview token against the stores module. Direct
 * `no-store` fetch — deliberately NOT routed through `manifest-source.ts`,
 * whose process cache must stay preview-free.
 */
export async function resolvePreviewByToken(token: string): Promise<PreviewResolveOutcome> {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (!apiBaseUrl) {
    logger.warn(
      "preview: FLIGHTDECK_API_URL is not set — preview tokens cannot be verified in fixture mode",
    );
    return { kind: "unavailable" };
  }
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/stores/v1/preview-resolve?token=${encodeURIComponent(token)}`;

  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    logger.error("preview-resolve fetch failed", { error });
    return { kind: "unavailable" };
  }
  if (response.status === 404) return { kind: "invalid" };
  if (!response.ok) {
    logger.error("preview-resolve responded with an error", { httpStatus: response.status });
    return { kind: "unavailable" };
  }

  let body: { manifest?: unknown; tenantRef?: unknown; preview?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch (error) {
    logger.error("preview-resolve returned an unparseable body", { error });
    return { kind: "unavailable" };
  }
  const parsed = storeManifestSchema.safeParse(body.manifest);
  const tenantRef = typeof body.tenantRef === "string" ? body.tenantRef.trim() : "";
  const preview = body.preview as { version?: unknown; expiresAt?: unknown } | undefined;
  const version = typeof preview?.version === "number" ? preview.version : null;
  const expiresAt = typeof preview?.expiresAt === "string" ? preview.expiresAt : null;
  if (!parsed.success || tenantRef.length === 0 || version === null || expiresAt === null) {
    logger.error("preview-resolve returned an unusable payload", {
      issues: parsed.success ? [] : parsed.error.issues,
      hadTenantRef: tenantRef.length > 0,
      hadPreview: version !== null && expiresAt !== null,
    });
    return { kind: "unavailable" };
  }
  return {
    kind: "resolved",
    resolution: {
      storeId: parsed.data.store.id,
      tenantRef,
      status: parsed.data.store.status,
      manifest: parsed.data,
      preview: { version, expiresAt },
    },
  };
}
