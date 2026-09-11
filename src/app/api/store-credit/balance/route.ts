import { NextResponse } from "next/server";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";
import { readStoreCreditBalance } from "@/lib/store-credit";

/**
 * Store-credit balance BFF (LOO-3156) — the browser calls THIS (never
 * `@dscodotco/checkout` directly), so the checkout affordance can decide whether
 * to offer store credit and for how much. TENANCY is resolved server-side
 * from `Host` (the same fail-closed path every route here uses); a
 * client-supplied tenant is never trusted.
 *
 * Honest absence: the store-credit gate off, an unknown store, or a failed
 * read all return `{ available: false }` — NEVER a `0` balance the client
 * could render as "you have no credit". The affordance shows only on a
 * positive, KNOWN balance.
 */
export async function GET(request: Request) {
  const resolution = await getRequestManifest();
  if (resolution?.manifest.store.status !== "live") {
    return NextResponse.json({ available: false });
  }
  if (!resolveBehavior(resolution.manifest).storeCredit.enabled) {
    // Gated off for this store — the tender does not exist here.
    return NextResponse.json({ available: false });
  }

  const url = new URL(request.url);
  const customerRef = (url.searchParams.get("customer_ref") ?? "").trim();
  if (customerRef.length === 0) {
    return NextResponse.json({ available: false });
  }

  const balance = await readStoreCreditBalance(resolution.tenantRef, customerRef);
  if (balance.kind !== "known" || balance.balanceCents <= 0) {
    // Unknown OR genuinely zero -> no affordance. We do not distinguish them
    // to the client (both mean "do not offer"), but critically an unavailable
    // read is never rendered AS a zero elsewhere.
    return NextResponse.json({ available: false });
  }
  return NextResponse.json({
    available: true,
    balanceCents: balance.balanceCents,
    currency: balance.currency,
  });
}
