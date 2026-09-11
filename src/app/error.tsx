"use client";

/**
 * Route-segment error boundary (Next.js App Router convention — catches a
 * render-time throw anywhere under this segment, does NOT catch
 * `global-error.tsx`'s territory: the root layout itself). Never renders
 * the raw error (message/stack) to the shopper — a generic fallback plus
 * the correlation id (if any) is the whole surface, mirroring the
 * console's `PanelBoundary` posture one level up (route, not component).
 */
import { useEffect } from "react";
import { getCorrelationId } from "@/lib/client-error";
import { reportClientError } from "@/lib/sentry";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const correlationId = getCorrelationId(error);

  useEffect(() => {
    reportClientError(error, { correlationId, digest: error.digest });
  }, [error, correlationId]);

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        minHeight: "60vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: "1.125rem", fontWeight: 500 }}>Something went wrong.</p>
      <p style={{ color: "var(--color-muted, #6b7280)", fontSize: "0.875rem" }}>
        We couldn&apos;t load this page. You can try again, or come back later.
      </p>
      {correlationId ? (
        <p
          data-testid="error-correlation-id"
          style={{ color: "var(--color-muted, #6b7280)", fontSize: "0.75rem" }}
        >
          Reference: {correlationId}
        </p>
      ) : null}
      <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
