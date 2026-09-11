import { NextResponse } from "next/server";
import { getAccountClient } from "@/lib/account-client";
import { getShopperSession } from "@/lib/account-session";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";

/**
 * Wishlist BFF (LOO-3138) — the browser calls THIS, never persons directly.
 * Two route-level gates make the surface "ship dark" when off:
 *
 *  1. `wishlist.enabled` false (or an unknown/non-live store) → 404. The
 *     route answers as though the surface does not exist, not merely hiding
 *     UI (the emailCapture/wishlist posture the manifest docblock describes).
 *  2. No shopper session → 401. The person is derived SERVER-SIDE by persons
 *     from the Bearer secret, never from anything the client sends, so a
 *     shopper can only ever touch their OWN wishlist.
 *
 * Honest absence: a failed backend read returns 502, never an empty list.
 */

async function gate(): Promise<
  { ok: true; secret: string } | { ok: false; response: NextResponse }
> {
  const resolution = await getRequestManifest();
  if (
    resolution?.manifest.store.status !== "live" ||
    !resolveBehavior(resolution.manifest).wishlist.enabled
  ) {
    return { ok: false, response: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  const session = await getShopperSession();
  if (session === null) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true, secret: session.secret };
}

export async function GET() {
  const gated = await gate();
  if (!gated.ok) return gated.response;
  const result = await getAccountClient().listWishlist(gated.secret);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.code }, { status: 502 });
  }
  return NextResponse.json({ items: result.value.map((productRef) => ({ productRef })) });
}

export async function POST(request: Request) {
  const gated = await gate();
  if (!gated.ok) return gated.response;
  const body = (await request.json().catch(() => null)) as { ref?: unknown } | null;
  const ref = typeof body?.ref === "string" ? body.ref.trim() : "";
  if (ref.length === 0) {
    return NextResponse.json({ error: "ref is required" }, { status: 400 });
  }
  const result = await getAccountClient().addWishlistItem(gated.secret, ref);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.code }, { status: 502 });
  }
  return NextResponse.json({ saved: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const gated = await gate();
  if (!gated.ok) return gated.response;
  const ref = (new URL(request.url).searchParams.get("ref") ?? "").trim();
  if (ref.length === 0) {
    return NextResponse.json({ error: "ref is required" }, { status: 400 });
  }
  const result = await getAccountClient().removeWishlistItem(gated.secret, ref);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.code }, { status: 502 });
  }
  return NextResponse.json({ deleted: true });
}
