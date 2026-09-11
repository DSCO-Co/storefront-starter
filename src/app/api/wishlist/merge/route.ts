import { NextResponse } from "next/server";
import { getAccountClient } from "@/lib/account-client";
import { getShopperSession } from "@/lib/account-session";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";

/**
 * Merge-on-auth BFF (LOO-3138) — the guest→server fold. `use-wishlist.ts`
 * POSTs the guest localStorage refs here on the first signed-in render; this
 * unions them into the shopper's server wishlist (idempotent — persons
 * upserts ON CONFLICT DO NOTHING) and returns the full list, which the hook
 * adopts as the source of truth.
 *
 * Same two gates as `../route.ts`: `wishlist.enabled` off / non-live store →
 * 404 (surface ships dark); no session → 401. The person is derived
 * server-side from the Bearer secret, never from the request.
 */
export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (
    resolution?.manifest.store.status !== "live" ||
    !resolveBehavior(resolution.manifest).wishlist.enabled
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const session = await getShopperSession();
  if (session === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { refs?: unknown } | null;
  const refs = Array.isArray(body?.refs)
    ? body.refs.filter((r): r is string => typeof r === "string")
    : [];

  const result = await getAccountClient().mergeWishlist(session.secret, refs);
  if (!result.ok) {
    // Honest absence: the merge/read failed — never a silent empty wishlist.
    return NextResponse.json({ error: result.error.code }, { status: 502 });
  }
  return NextResponse.json({ items: result.value.map((productRef) => ({ productRef })) });
}
