import { createLogger } from "@/lib/logger";

/**
 * Store-credit balance reader (LOO-3156) — the storefront's server-side call
 * into `@dscodotco/checkout`'s store-credit affordance route
 * (`GET /v1/tenants/:tenant/store-credit/balance`). Used ONLY server-side
 * (the checkout page's affordance decision + the `/api/store-credit/balance`
 * BFF), so the narrow `FLIGHTDECK_STOREFRONT_TOKEN` never reaches the
 * browser — the same platform-served posture as `lib/checkout.ts`.
 *
 * The result is deliberately a THREE-way type, not a number: a failed read
 * is `unavailable`, NEVER a `0` balance. The affordance renders only on a
 * `known` positive balance, so the shopper is never falsely told "you have
 * no credit" when the truth is "we could not find out" (root convention 1).
 * With no `FLIGHTDECK_API_URL` (local dev / tests) there is no ledger to
 * read, so the honest answer is `unavailable` and the affordance stays dark.
 */
const logger = createLogger("store-credit");

export type StoreCreditBalance =
  | { readonly kind: "known"; readonly balanceCents: number; readonly currency: string }
  | { readonly kind: "unavailable" };

type BalanceBody = { balance_cents?: unknown; currency?: unknown };

export async function readStoreCreditBalance(
  tenantRef: string,
  customerRef: string,
): Promise<StoreCreditBalance> {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  const storefrontToken = process.env.FLIGHTDECK_STOREFRONT_TOKEN;
  if (!apiBaseUrl || !storefrontToken) {
    // No backend to read from — honestly unknown, never a fabricated zero.
    return { kind: "unavailable" };
  }

  let res: Response;
  try {
    const url = `${apiBaseUrl.replace(/\/+$/, "")}/checkout/v1/tenants/${encodeURIComponent(
      tenantRef,
    )}/store-credit/balance?customer_ref=${encodeURIComponent(customerRef)}`;
    res = await fetch(url, {
      headers: { "x-storefront-token": storefrontToken },
      cache: "no-store",
    });
  } catch (cause) {
    logger.error("store-credit balance fetch failed", { tenantRef, cause });
    return { kind: "unavailable" };
  }

  if (res.status !== 200) {
    // A 503 (read fault) or anything non-200 is unknown, not zero.
    return { kind: "unavailable" };
  }
  const body = (await res.json().catch(() => null)) as BalanceBody | null;
  if (body === null || typeof body.balance_cents !== "number") {
    return { kind: "unavailable" };
  }
  return {
    kind: "known",
    balanceCents: body.balance_cents,
    currency: typeof body.currency === "string" ? body.currency : "USD",
  };
}
