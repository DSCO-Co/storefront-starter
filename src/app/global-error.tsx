"use client";

/**
 * Root error boundary (Next.js App Router convention) — catches a throw in
 * `layout.tsx` itself, which `error.tsx` cannot (a segment boundary can't
 * catch an error in its own parent layout). Because the root layout never
 * renders here, this file supplies its own minimal `<html>`/`<body>` shell
 * — same reasoning as `not-found.tsx`'s existing doc comment. Deliberately
 * self-contained (no CSS import, no shared components) so it can render
 * even if the failure that got us here was in shared UI plumbing.
 */
import { useEffect } from "react";
import { getCorrelationId } from "@/lib/client-error";
import { reportClientError } from "@/lib/sentry";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const correlationId = getCorrelationId(error);

  useEffect(() => {
    reportClientError(error, { correlationId, digest: error.digest, boundary: "global" });
  }, [error, correlationId]);

  return (
    <html lang="en">
      <body
        style={{ fontFamily: "system-ui, sans-serif", background: "#0b0d12", color: "#e7e9ee" }}
      >
        <main
          id="main"
          role="alert"
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "1.125rem", fontWeight: 500 }}>Something went wrong.</p>
          <p style={{ opacity: 0.75, fontSize: "0.875rem" }}>
            This page couldn&apos;t load. Please try again.
          </p>
          {correlationId ? (
            <p data-testid="error-correlation-id" style={{ opacity: 0.6, fontSize: "0.75rem" }}>
              Reference: {correlationId}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: 6,
              border: "1px solid #e7e9ee",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
