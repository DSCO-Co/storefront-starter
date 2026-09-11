/**
 * A thin `Error` subclass that carries the backend's `x-request-id`
 * correlation id, so a page that decides to `throw` on a failed BFF call
 * (rather than render its own `Result`-failure state) still surfaces the
 * SAME id `error.tsx` shows the shopper and reports to Sentry — which is
 * also what a support agent or backend log line keys on. Never required —
 * a plain `Error`/thrown value still hits `error.tsx` and falls back to
 * Next's own `error.digest`, which is production-only and NOT the same id
 * as our backend's `x-request-id` (see `getCorrelationId` below).
 */
export class AppClientError extends Error {
  readonly correlationId: string | undefined;

  constructor(message: string, correlationId?: string | undefined) {
    super(message);
    this.name = "AppClientError";
    this.correlationId = correlationId;
  }
}

/**
 * Best-effort correlation id extraction for an error caught by
 * `error.tsx`/`global-error.tsx`: prefers our own backend-issued id
 * (`AppClientError.correlationId`), falls back to Next's own per-error
 * `digest` (present in production builds only) so there is still SOMETHING
 * to quote even for a bug that never touched a BFF call.
 */
export function getCorrelationId(error: unknown): string | undefined {
  if (error instanceof AppClientError && error.correlationId) {
    return error.correlationId;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.length > 0
  ) {
    return (error as { digest: string }).digest;
  }
  return undefined;
}
