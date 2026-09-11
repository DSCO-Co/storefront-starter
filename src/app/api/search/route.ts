import { NextResponse } from "next/server";
import { getCatalogSource } from "@/lib/catalog-source";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";

/**
 * Typeahead search BFF (LOO-3044 / LOO-3134). The header search box's
 * debounced client fetches THIS route; the browser never talks to
 * `@dscodotco/commerce` directly and `FLIGHTDECK_API_URL` stays server-only —
 * same ADR-0003 platform-served posture as the checkout BFF.
 *
 * TENANCY: `tenantRef` is resolved HERE, server-side, from the request Host
 * via `getRequestManifest()` (the fail-closed `Host → verified domain-
 * mapping row → tenant_ref` path) — never from client data.
 *
 * GATING mirrors the /search page: a non-live store 404s, and a store that
 * has turned search OFF (`behavior.search.enabled === false`) 404s too, so
 * the typeahead endpoint can't be used to read a catalog the store chose
 * not to expose through search. A backend failure surfaces as a 502 rather
 * than an empty `{ results: [] }` — a failed read is never "no results".
 */
export async function GET(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ error: "unknown store" }, { status: 404 });
  }
  if (resolution.manifest.store.status !== "live") {
    return NextResponse.json({ error: "store unavailable" }, { status: 404 });
  }
  const behavior = resolveBehavior(resolution.manifest);
  if (!behavior.search.enabled) {
    return NextResponse.json({ error: "search disabled" }, { status: 404 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length === 0) {
    return NextResponse.json({ query: "", results: [] });
  }

  try {
    const products = await getCatalogSource().searchProducts(resolution.tenantRef, query, {
      limit: 6,
    });
    const results = products.map((product) => ({
      slug: product.slug,
      name: product.name,
      priceCents:
        product.variants.length > 0
          ? Math.min(...product.variants.map((variant) => variant.priceCents))
          : product.priceCents,
    }));
    return NextResponse.json({ query, results });
  } catch {
    // The catalog source already logged the underlying fault. Report an
    // honest 502 — NOT an empty result set that would read as "nothing
    // matched" when the truth is "we could not find out".
    return NextResponse.json({ error: "search temporarily unavailable" }, { status: 502 });
  }
}
