/**
 * Shared live/fixture gate (F4, completeness sweep 2026-08-31) for every
 * source in this surface that falls back to bundled demo data when
 * `FLIGHTDECK_API_URL` is unset: `manifest-source.ts`'s `getManifestSource()`
 * and `catalog-source.ts`'s `getCatalogSource()`. `checkout.ts` has its own
 * gate (`getCheckoutGateway()`) with a stricter posture already (it refuses
 * to run without an operator token) — this module gives the read-only
 * sources the SAME "never silently degrade in prod" posture checkout.ts
 * models: a Vercel env-var mistake must never serve demo catalogs/manifests
 * under a live hostname with nothing in the logs to show it.
 *
 * `resolveFixtureModeGate` is a pure function — no `process.env` reads, no
 * logging, no throwing — so the decision itself is unit-testable without
 * env-var gymnastics. Callers (the two `getXSource()` functions) do the
 * env read, the throw, and the log.
 */
export type FixtureModeGate =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const TRUTHY = new Set(["1", "true", "yes"]);

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && TRUTHY.has(value.toLowerCase());
}

/**
 * Decides whether fixture mode may be used given `FLIGHTDECK_API_URL` is
 * unset. Fixture mode is always allowed outside production. In production
 * it is refused UNLESS an explicit dev signal opts in:
 * `ALLOW_FIXTURE_MODE=1|true|yes` (an operator deliberately running a
 * fixture-only production deploy — e.g. a demo/sales environment — states
 * that on purpose), or `NEXT_PUBLIC_VERCEL_ENV=preview`/`development`
 * (Vercel's own environment signal, distinct from `NODE_ENV` which Next.js
 * sets to `production` for `next build` even on preview deploys).
 */
export function resolveFixtureModeGate(env: {
  readonly nodeEnv: string | undefined;
  readonly allowFixtureMode: string | undefined;
  readonly vercelEnv: string | undefined;
}): FixtureModeGate {
  if (env.nodeEnv !== "production") return { allowed: true };
  if (isTruthy(env.allowFixtureMode)) return { allowed: true };
  if (env.vercelEnv === "preview" || env.vercelEnv === "development") return { allowed: true };
  return {
    allowed: false,
    reason:
      "FLIGHTDECK_API_URL is not set and this is a production build (NODE_ENV=production) — " +
      "refusing to silently serve bundled fixture/demo data under a live hostname. Set " +
      "FLIGHTDECK_API_URL, or set ALLOW_FIXTURE_MODE=1 if this production deploy is " +
      "intentionally fixture-only (e.g. a demo environment).",
  };
}
