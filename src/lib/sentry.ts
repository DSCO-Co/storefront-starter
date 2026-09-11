/**
 * Client-side Sentry init + error reporting, gated on
 * `NEXT_PUBLIC_SENTRY_DSN` (same no-silent-mocks posture as the backend's
 * `@dscodotco/observability.initObservability`: unset -> a real, visible no-op;
 * set -> active, PHI/secret-scrubbed reporting).
 *
 * This deliberately does NOT import `@dscodotco/observability`'s `initObservability`
 * / `captureError` (those pull `@sentry/node`, a Node-only SDK that must
 * never enter the browser bundle). Uses @sentry/browser rather than
 * @sentry/nextjs (the latter's build-tool integration/source-map plugins
 * import Node-only tooling not meant for direct runtime import — it broke
 * under vitest with "The URL must be of scheme file"; @sentry/browser is
 * the plain runtime SDK the Next-specific package wraps). This also does
 * NOT reuse @dscodotco/observability's `sentryBeforeSend` (which internally
 * imports the bare `@dscodotco/core` specifier — that resolves to the package's
 * full `index.ts` barrel, which itself pulls `postgres`/`hono`).
 * Instead it reuses just the two PURE, sync, dependency-free redactors —
 * `scrubPhi` (packages/core/src/phi-redaction.ts) and `scrubSecrets`
 * (packages/core/src/secret-redaction.ts) — via the direct-file
 * tsconfig path aliases in ./tsconfig.json (`@dscodotco-shared/*`), and composes
 * them the same way the backend's `sentry-scrub.ts` does
 * (`scrubSecrets(scrubPhi(value))`), just without that file's per-field
 * typed walk — a whole-event recursive scrub is sufficient here since both
 * scrubbers already walk objects/arrays recursively.
 */
"use client";

import { scrubPhi } from "@dscodotco-shared/phi-redaction";
import { scrubSecrets } from "@dscodotco-shared/secret-redaction";
import * as Sentry from "@sentry/browser";

const SCRUB_FAILED = "[SCRUB_FAILED]";

/** Never let a redactor bug ship an unscrubbed event — see sentry-scrub.ts's docblock for the same posture server-side. */
function scrubEvent<T>(event: T): T {
  try {
    return scrubSecrets(scrubPhi(event)) as T;
  } catch {
    return { message: SCRUB_FAILED } as T;
  }
}

let initialized = false;
let enabled = false;

/**
 * Idempotent — safe to call from every error boundary's mount. Returns
 * whether reporting is active (DSN set) so callers can decide whether to
 * bother calling `reportClientError`.
 */
export function initSentryClient(): boolean {
  if (initialized) return enabled;
  initialized = true;

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn === undefined || dsn === "") {
    // Client bundle has no server logger (this surface's createLogger
    // writes to process.stdout/stderr, unavailable in the browser — see
    // panel-boundary.tsx's identical precedent). console.error is the one
    // sink biome.json allows repo-wide; used here for a benign one-time
    // notice, not an actual error.
    console.error(
      "[storefront:sentry] NEXT_PUBLIC_SENTRY_DSN not set — client error reporting is a no-op",
    );
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.NEXT_PUBLIC_BUILD_SHA || undefined,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
  enabled = true;
  return true;
}

/**
 * Reports a caught error to Sentry (no-op if the DSN isn't set), tagging it
 * with the backend correlation id when the failure that led here carried
 * one (see lib/checkout.ts's `x-request-id` capture) — so a user-reported
 * failure maps to the same id in backend logs/Sentry.
 */
export function reportClientError(
  error: unknown,
  context: { correlationId?: string | undefined; [key: string]: unknown } = {},
): void {
  if (!initSentryClient()) return;
  const { correlationId, ...extra } = context;
  Sentry.captureException(error, {
    tags: correlationId ? { correlationId } : undefined,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  });
}
