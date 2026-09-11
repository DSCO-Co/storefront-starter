import designDarkManifest from "@/fixtures/manifests/design-dark.json";
import designLightManifest from "@/fixtures/manifests/design-light.json";
import bioArchetypeManifest from "@/fixtures/manifests/store-0-bio-archetype.json";
import leoResearchManifest from "@/fixtures/manifests/store-leo-research.json";
import { resolveFixtureModeGate } from "@/lib/fixture-mode";
import { createLogger } from "@/lib/logger";
import { type StoreManifest, type StoreStatus, storeManifestSchema } from "@/lib/manifest";

const logger = createLogger("manifest-source");

/**
 * Host resolution — ADR 0003's fail-closed exception. `resolve(hostname)`
 * hits the flightdeck app's tenant-facing route,
 * `GET {FLIGHTDECK_API_URL}/stores/v1/resolve?hostname=`, the SAME route the
 * headless SDK will expose (contract identity, not transport identity — the
 * renderer is the first headless consumer). Unknown/unverified host = a real
 * 404 (`resolve()` returns null) — no fallback store, no default tenant.
 *
 * A short in-process ETag cache (keyed by hostname) honors the resolve
 * route's `etag`/`if-none-match` contract: an unchanged release costs a 304
 * and reuses the cached parse. Cache is process-lifetime, not time-boxed —
 * the stores module's manifest publish is the only thing that changes the
 * ETag, so there is nothing to expire on a timer.
 */
export type ManifestResolution = {
  storeId: string;
  /**
   * The DB-truth tenant slug (`stores.stores.tenant_ref`), from the resolve
   * response's top-level `tenantRef` field — NOT `manifest.store.id`
   * (author-editable manifest content `storeId` above is derived from,
   * which has no guaranteed relationship to the real tenant ref). This is
   * the value every tenant-scoped commerce/checkout call must use — see
   * `catalog-source.ts`'s `LiveCommerceCatalogSource`.
   */
  tenantRef: string;
  status: StoreStatus;
  manifest: StoreManifest;
  /**
   * Present ONLY when this resolution came from a verified draft-preview
   * token (lib/preview.ts) instead of Host/tenant resolution. The layout
   * keys the "Preview — not published" banner and forced noindex off it.
   * Live resolutions never carry it.
   */
  preview?: { version: number; expiresAt: string };
};

export type ManifestSource = {
  /** Resolve a request Host header (port already stripped) to a store, or null if genuinely unknown. */
  resolve(hostname: string): Promise<ManifestResolution | null>;
  /**
   * Resolve DIRECTLY by tenant ref — the env-pinned single-tenant path a
   * headless storefront uses (`FLIGHTDECK_TENANT` set → one store per deploy,
   * independent of the request Host). `null` is a genuine "no such tenant /
   * no active manifest", never an error laundered into absence.
   */
  resolveByTenant(tenantRef: string): Promise<ManifestResolution | null>;
};

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/:\d+$/, "");
}

// ── Fixture source — local dev / tests without a running flightdeck app ────

export class FixtureManifestSource implements ManifestSource {
  private readonly byHost = new Map<string, StoreManifest>();
  private readonly byStoreKey = new Map<string, StoreManifest>();

  constructor(
    rawManifests: unknown[] = [
      bioArchetypeManifest,
      leoResearchManifest,
      designDarkManifest,
      designLightManifest,
    ],
  ) {
    for (const raw of rawManifests) {
      const manifest = storeManifestSchema.parse(raw);
      this.byStoreKey.set(manifest.catalog.storeKey, manifest);
      this.byHost.set(normalizeHostname(manifest.domains.primary), manifest);
      for (const alias of manifest.domains.aliases) {
        this.byHost.set(normalizeHostname(alias), manifest);
      }
    }
  }

  resolve(hostname: string): Promise<ManifestResolution | null> {
    const manifest = this.byHost.get(normalizeHostname(hostname));
    if (!manifest) return Promise.resolve(null);
    return Promise.resolve({
      storeId: manifest.store.id,
      // Fixture mode has no real stores.stores row to read a tenant_ref
      // from — storeKey doubles as the tenant ref here, which is also what
      // FixtureCatalogSource is keyed by, so callers can use
      // `resolution.tenantRef` uniformly across fixture and live modes.
      tenantRef: manifest.catalog.storeKey,
      status: manifest.store.status,
      manifest,
    });
  }

  resolveByTenant(tenantRef: string): Promise<ManifestResolution | null> {
    // Fixture mode has no real stores.stores row: storeKey doubles as the
    // tenant ref (same convention `resolve` uses above), so an env-pinned
    // local store resolves by its storeKey.
    const manifest = this.byStoreKey.get(tenantRef.trim());
    if (!manifest) return Promise.resolve(null);
    return Promise.resolve({
      storeId: manifest.store.id,
      tenantRef: manifest.catalog.storeKey,
      status: manifest.store.status,
      manifest,
    });
  }

  getByStoreKey(storeKey: string): StoreManifest | null {
    return this.byStoreKey.get(storeKey) ?? null;
  }
}

// ── Live source — GET {FLIGHTDECK_API_URL}/stores/v1/resolve ───────────────

type CacheEntry = { etag: string | null; resolution: ManifestResolution };

/**
 * Resolve response body from `modules/stores`' `/v1/resolve` route:
 * `{ tenantRef, storeNumber, status, manifestVersion, manifest }`. The
 * `manifest` field is validated through `storeManifestSchema` below —
 * lenient-read (`.passthrough()`), so a newer manifest never breaks this
 * renderer, but a structurally broken payload is a real parse failure, not
 * an absence.
 */
export class FlightdeckManifestSource implements ManifestSource {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly apiBaseUrl: string) {}

  async resolve(hostname: string): Promise<ManifestResolution | null> {
    const host = normalizeHostname(hostname);
    return this.resolveVia(
      `host:${host}`,
      `${this.apiBaseUrl}/stores/v1/resolve?hostname=${encodeURIComponent(host)}`,
      { key: "hostname", value: host },
    );
  }

  async resolveByTenant(tenantRef: string): Promise<ManifestResolution | null> {
    const tenant = tenantRef.trim().toLowerCase();
    if (tenant.length === 0) return null;
    return this.resolveVia(
      `tenant:${tenant}`,
      `${this.apiBaseUrl}/stores/v1/resolve?tenant=${encodeURIComponent(tenant)}`,
      { key: "tenant", value: tenant },
    );
  }

  /**
   * The shared resolve machinery for both host- and tenant-keyed lookups:
   * ETag-conditional fetch, stale-serve on a transport/error hiccup, and the
   * fail-closed 404 = genuine absence contract. `cacheKey` namespaces the two
   * lookup modes so a host and a tenant never collide in the cache; `logCtx`
   * only labels log lines.
   */
  private async resolveVia(
    cacheKey: string,
    url: string,
    logCtx: { key: string; value: string },
  ): Promise<ManifestResolution | null> {
    const cached = this.cache.get(cacheKey);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: cached?.etag ? { "if-none-match": cached.etag } : undefined,
        cache: "no-store",
      });
    } catch (error) {
      if (cached) {
        logger.error("resolve fetch failed — serving stale manifest", {
          [logCtx.key]: logCtx.value,
          error,
        });
        return cached.resolution;
      }
      logger.error("resolve fetch failed with no cached manifest", {
        [logCtx.key]: logCtx.value,
        error,
      });
      throw error;
    }

    if (response.status === 304) {
      if (cached) return cached.resolution;
      // A 304 with nothing cached means our etag bookkeeping is broken — refetch clean.
      this.cache.delete(cacheKey);
      return this.resolveVia(cacheKey, url, logCtx);
    }

    if (response.status === 404) {
      // Genuine absence (ADR 0003, fail-closed): unknown/unverified host or tenant.
      this.cache.delete(cacheKey);
      return null;
    }

    if (!response.ok) {
      if (cached) {
        logger.error("resolve responded with an error — serving stale manifest", {
          [logCtx.key]: logCtx.value,
          httpStatus: response.status,
        });
        return cached.resolution;
      }
      throw new Error(`stores resolve failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as { manifest?: unknown; tenantRef?: unknown };
    const parsed = storeManifestSchema.safeParse(body.manifest);
    const tenantRef = typeof body.tenantRef === "string" ? body.tenantRef.trim() : "";
    if (!parsed.success || tenantRef.length === 0) {
      logger.error("resolve returned an unparseable manifest or missing tenantRef", {
        [logCtx.key]: logCtx.value,
        issues: parsed.success ? [] : parsed.error.issues,
        hadTenantRef: tenantRef.length > 0,
      });
      if (cached) return cached.resolution;
      throw new Error(
        "resolve returned an unparseable manifest (or no tenantRef) and there is nothing cached",
      );
    }

    const resolution: ManifestResolution = {
      storeId: parsed.data.store.id,
      tenantRef,
      status: parsed.data.store.status,
      manifest: parsed.data,
    };
    this.cache.set(cacheKey, { etag: response.headers.get("etag"), resolution });
    return resolution;
  }
}

// ── Selection ────────────────────────────────────────────────────────────

let fixtureSource: FixtureManifestSource | null = null;
let liveSource: FlightdeckManifestSource | null = null;

/**
 * The single place that decides which ManifestSource the renderer uses.
 * `FLIGHTDECK_API_URL` set → resolve against the flightdeck app's tenant-
 * facing route; unset (local dev / tests) → bundled fixtures, so `pnpm dev`
 * and `pnpm test` need no running flightdeck app.
 *
 * F4 (completeness sweep 2026-08-31): an unset `FLIGHTDECK_API_URL` used to
 * fall back to bundled demo fixtures with NO log — a production env-var
 * mistake would silently serve a demo catalog under a live hostname,
 * invisible in logs. Now it logs loudly, and `resolveFixtureModeGate`
 * (shared with `catalog-source.ts`) refuses fixture mode outright in
 * production unless explicitly opted into — mirrors `checkout.ts`'s
 * "never silently degrade" posture.
 */
export function getManifestSource(): ManifestSource {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (apiBaseUrl) {
    liveSource ??= new FlightdeckManifestSource(apiBaseUrl.replace(/\/+$/, ""));
    return liveSource;
  }
  const gate = resolveFixtureModeGate({
    nodeEnv: process.env.NODE_ENV,
    allowFixtureMode: process.env.ALLOW_FIXTURE_MODE,
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV,
  });
  if (!gate.allowed) {
    throw new Error(`manifest-source: ${gate.reason}`);
  }
  logger.warn(
    "manifest-source: FLIGHTDECK_API_URL is not set — serving BUNDLED FIXTURE manifests, " +
      "not the live stores module. Expected in dev/test; a hazard anywhere else.",
  );
  fixtureSource ??= new FixtureManifestSource();
  return fixtureSource;
}

export async function resolveManifest(hostname: string): Promise<ManifestResolution | null> {
  return getManifestSource().resolve(hostname);
}

/**
 * Resolve the env-pinned single-tenant store (headless mode). Used when
 * `FLIGHTDECK_TENANT` is set — a customer's own Vercel deploy renders exactly
 * one store, independent of the request Host, so it boots on an ephemeral
 * `*.vercel.app` preview URL or before a custom domain is verified.
 */
export async function resolveManifestByTenant(
  tenantRef: string,
): Promise<ManifestResolution | null> {
  return getManifestSource().resolveByTenant(tenantRef);
}
