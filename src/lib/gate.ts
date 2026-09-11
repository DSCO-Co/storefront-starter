import "server-only";

import { GATE_ADMIT_COOKIE, GATE_COOKIE, verifyGateSession } from "@/lib/gate-token";
import type { ResolvedBehavior } from "@/lib/manifest";

/**
 * Funnel-gate enforcement decision (P8) — server-side, used by the root
 * layout. The gate is a PAID add-on: the manifest flag alone is not trusted
 * (a merchant can set it via the raw JSON editor), so enforcement requires
 * BOTH `behavior.gating.funnelGuard.mode === "challenge"` AND the
 * `funnel_gate` entitlement installed. Failing to read the entitlement
 * degrades the gate to OFF — a customer is never blocked by an entitlements
 * hiccup (the wallet route-404 posture: an unpaid/unverifiable add-on
 * behaves as though absent).
 *
 * The decision is one of:
 *  - "off"      — no gate; render normally.
 *  - "blocked"  — no valid admission; render the gate interstitial.
 *  - "admitted" — a fresh session; render normally.
 *  - "renew"    — an authentic session past half-life, OR an expired one
 *                 still inside the outage-grace window: render normally AND
 *                 mount the silent renewer (the fix for the 15-minute
 *                 checkout-bounce class — a shopper is never walled mid-flow).
 */
export type GateDecision = "off" | "blocked" | "admitted" | "renew";

/** Exempt path prefixes even when the gate is on (health, gate BFF, assets). */
const ALWAYS_EXEMPT = ["/api/", "/_next/", "/favicon.ico", "/robots.txt", "/sitemap.xml"];

export function isGateExemptPath(pathname: string, configured: readonly string[]): boolean {
  if (ALWAYS_EXEMPT.some((p) => pathname.startsWith(p))) return true;
  return configured.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Read whether the funnel_gate add-on is installed for the tenant, through
 * the entitlements storefront check. Any failure → false (gate off — never
 * block on a read error). Env is read lazily (no build-time inlining).
 */
export async function funnelGateInstalled(tenantRef: string): Promise<boolean> {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  const token = process.env.FLIGHTDECK_STOREFRONT_TOKEN;
  if (!apiBaseUrl || !token) return false;
  try {
    const url = new URL(
      `${apiBaseUrl.replace(/\/+$/, "")}/entitlements/v1/entitlements/storefront/check`,
    );
    url.searchParams.set("tenant_ref", tenantRef);
    url.searchParams.set("feature_key", "funnel_gate");
    const res = await fetch(url, {
      headers: { "x-storefront-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (res.status !== 200) return false;
    const body = (await res.json().catch(() => null)) as { installed?: unknown } | null;
    return body?.installed === true;
  } catch {
    return false;
  }
}

export interface GateContext {
  readonly behavior: ResolvedBehavior;
  readonly tenantRef: string;
  readonly pathname: string;
  readonly gateCookie: string | undefined;
  readonly userAgent: string | null;
  readonly now: Date;
}

/**
 * The full decision. Callers (the layout) resolve `installed` via
 * `funnelGateInstalled` and pass it in — kept out of this fn so the
 * decision stays pure/testable and the network read is at the edge of the
 * layout.
 */
export async function resolveGateDecision(
  ctx: GateContext,
  installed: boolean,
): Promise<GateDecision> {
  const fg = ctx.behavior.gating.funnelGuard;
  if (fg.mode !== "challenge" || !installed) return "off";
  if (isGateExemptPath(ctx.pathname, fg.exemptPaths)) return "off";

  const secret = process.env.FUNNEL_GATE_SECRET;
  const state = await verifyGateSession(secret, ctx.gateCookie, ctx.userAgent, ctx.now);
  if (state.state === "valid") {
    return state.staleBy < fg.cookieTtlSeconds / 2 ? "renew" : "admitted";
  }
  if (state.state === "expired") {
    // Authentic but lapsed: renew if still inside outage grace, else block.
    return state.expiredForSeconds <= fg.outageGraceSeconds ? "renew" : "blocked";
  }
  return "blocked";
}

export { GATE_ADMIT_COOKIE, GATE_COOKIE };
