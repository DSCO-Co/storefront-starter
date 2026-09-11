import { NextResponse } from "next/server";
import { getCheckoutGateway } from "@/lib/checkout";
import { createLogger } from "@/lib/logger";
import { resolveBehavior } from "@/lib/manifest";
import { resolvedPricingConfig } from "@/lib/pricing";
import { getRequestManifest } from "@/lib/request-manifest";

const logger = createLogger("api-checkout-preview");

/**
 * Coupon/pricing preview BFF (money-honesty follow-up to LOO-3156). The
 * checkout coupon UI used to say only "applied when you pay" — this route
 * lets it show the SERVER-computed discount before payment. It proxies the
 * checkout module's read-only `/checkout/preview` (the same commerce
 * coupon-validation + fail-closed shipping/tax legs placement runs; NEVER
 * client math) using the same server-only storefront token posture as
 * `/api/checkout`.
 *
 * TENANCY: resolved from the request Host (ADR 0003), never the POST body.
 * The pricing POLICY is resolved server-side from the manifest here; the
 * client sends only its cart lines, coupon code, and shipping-speed choice.
 *
 * HONEST OUTCOMES, three-valued:
 *  - `priced`          — the authoritative totals, incl. the coupon discount;
 *  - `invalid_coupon`  — placement would refuse this code (same reason);
 *  - `unavailable`     — the preview could not be computed. NEVER collapsed
 *    into "$0 discount" or "bad code" — the UI keeps its
 *    applied-at-payment copy instead of inventing a claim.
 */
export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "unavailable", message: "unknown store" }, { status: 404 });
  }
  if (resolution.manifest.store.status !== "live") {
    return NextResponse.json(
      { outcome: "unavailable", message: "this store is not currently available" },
      { status: 404 },
    );
  }
  const behavior = resolveBehavior(resolution.manifest);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const couponCode =
    typeof body?.couponCode === "string" && body.couponCode.trim().length > 0
      ? body.couponCode.trim()
      : null;
  const expedited = body?.expedited === true;
  const rawItems = Array.isArray(body?.items) ? body.items : null;
  if (rawItems === null || rawItems.length === 0) {
    return NextResponse.json(
      { outcome: "unavailable", message: "invalid preview request" },
      { status: 400 },
    );
  }
  const items: Array<{ variantId: string; quantity: number }> = [];
  for (const raw of rawItems) {
    const item = raw as { variantId?: unknown; quantity?: unknown };
    if (
      typeof item.variantId !== "string" ||
      item.variantId.length === 0 ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      return NextResponse.json(
        { outcome: "unavailable", message: "invalid preview request" },
        { status: 400 },
      );
    }
    items.push({ variantId: item.variantId, quantity: item.quantity });
  }

  // Same gate as placement (LOO-3156): a promotions-off store REFUSES a
  // coupon honestly rather than pricing without it.
  if (couponCode !== null && !behavior.promotions.enabled) {
    return NextResponse.json(
      {
        outcome: "invalid_coupon",
        code: "promotions_disabled",
        message: "Coupon codes are not enabled for this store.",
      },
      { status: 400 },
    );
  }

  try {
    const outcome = await getCheckoutGateway().preview({
      tenantRef: resolution.tenantRef,
      // Guest previews (no verified shopper email yet) price at list; the
      // eventual placement re-prices with the real customer_ref anyway.
      customerRef: "",
      items,
      couponCode,
      pricing: resolvedPricingConfig(behavior, expedited),
    });
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    // getCheckoutGateway() throws when misconfigured — a preview must never
    // surface that as a coupon verdict.
    logger.error("checkout preview threw", {
      tenantRef: resolution.tenantRef,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { outcome: "unavailable", message: "preview unavailable" },
      { status: 200 },
    );
  }
}
