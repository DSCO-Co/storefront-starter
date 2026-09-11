import { getRequestManifest } from "@/lib/request-manifest";

/**
 * Two distinct 404 surfaces share this file (the App Router routes every
 * `notFound()` here):
 *
 * 1. UNKNOWN/UNVERIFIED HOST (ADR 0003, fail-closed): `layout.tsx` calls
 *    `notFound()` before it renders `<html>`, so this branch supplies its own
 *    bare document shell — no store resolved, so there are no theme tokens to
 *    paint with and no home to link back to.
 *
 * 2. IN-STORE 404 (bad product/policy/collection slug): the host resolved and
 *    the layout rendered — the store's token CSS vars are live — so this
 *    branch renders a THEMED "Page not found" inside the store chrome with a
 *    way back home. Before this split, a light store's bad slug rendered the
 *    hardcoded-dark "This store could not be found" shell with no exit.
 */
export default async function NotFound() {
  const resolution = await getRequestManifest();

  if (resolution) {
    return (
      <main
        id="main"
        data-testid="store-not-found"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 py-12 text-center"
        style={{ color: "var(--color-text)" }}
      >
        <div>
          <h1
            className="text-3xl"
            style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
          >
            Page not found
          </h1>
          <p className="mt-3 text-sm" style={{ color: "var(--color-muted)" }}>
            The page you&apos;re looking for doesn&apos;t exist or has moved.
          </p>
        </div>
        <a href="/" className="fd-btn fd-btn-primary fd-btn-md">
          Back to {resolution.manifest.brand.name}
        </a>
      </main>
    );
  }

  return (
    <html lang="en">
      <body
        style={{ fontFamily: "system-ui, sans-serif", background: "#0b0d12", color: "#e7e9ee" }}
      >
        <main
          id="main"
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "2rem",
          }}
        >
          <p>This store could not be found.</p>
        </main>
      </body>
    </html>
  );
}
