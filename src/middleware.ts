import { type NextRequest, NextResponse } from "next/server";
import { readCookie } from "@/lib/compliance-cookies";
import {
  CONSENT_COOKIE,
  gpcHeaderDenied,
  nonEssentialAllowed,
  parseConsentCookie,
} from "@/lib/consent";
import { resolveBehavior, storeHasBrowserTracking } from "@/lib/manifest";
import { resolveManifest } from "@/lib/manifest-source";
import { POLICY_PATH_ALIASES, resolvePolicyAlias } from "@/lib/policy-aliases";
import {
  PREVIEW_COOKIE,
  PREVIEW_QUERY_PARAM,
  previewAllowedOnHost,
  resolvePreviewByToken,
} from "@/lib/preview";
import { resolveProductSlugAlias } from "@/lib/product-aliases";
import {
  parseReferralParam,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/referral";
import { cookieConsentEnforced, resolveRequestGeo } from "@/lib/region";

/**
 * Two narrow rewrite/redirect concerns, each scoped by an explicit matcher so
 * no other route pays for middleware here:
 *
 * 1. Product slug 301 aliases (FD Epic 15). A renamed product's old
 *    `/products/{old-slug}` URL is 301'd to its current
 *    `/products/{current-slug}` so bookmarks and inbound links survive the
 *    rename. This is the REDIRECT MECHANISM; the alias data is
 *    manifest-driven (`resolveProductSlugAlias`, lib/product-aliases.ts) and
 *    the decision is a pure, unit-tested function.
 *
 *    A genuine HTTP 301 (permanent, cacheable) — not App Router's 308
 *    `permanentRedirect` — because search engines treat 301 as the canonical
 *    "moved permanently" signal for URL consolidation.
 *
 *    An alias key is by construction NOT a current product slug, so this can
 *    never shadow a live PDP: a real product slug isn't in the map and falls
 *    straight through to the page.
 *
 * 2. Conventional legal-slug aliases (LOO-3050 item 1). `/terms`, `/privacy`,
 *    `/returns`, … are REWRITTEN (URL preserved — these are the canonical
 *    conventional addresses, not moved pages) onto the manifest-driven
 *    `/policies/{slug}` route via `resolvePolicyAlias`
 *    (lib/policy-aliases.ts), so the conventional URLs never 404 on a store
 *    carrying a legal pack. A store that carries no such policy still 404s —
 *    honestly — at the `/policies/[slug]` route itself. This branch is pure
 *    path mapping: no manifest resolution happens here.
 */
/**
 * Referral capture (gap brief docs/briefs/referral-capture-gap-2026-09-06.md,
 * third concern below): a `?ref=<code>` landing on ANY path stashes the code
 * in the httpOnly `fd_ref` cookie so the checkout BFF can attach it at
 * payment. Matcher-scoped by a `has: query ref` condition — a request without
 * the param never pays for the manifest read. Fail-closed three ways: store
 * not live / `behavior.referrals.enabled` off → no capture; cookie-consent
 * enforced for this region without an explicit grant → no capture (the SAME
 * `cookieConsentEnforced` × `nonEssentialAllowed` predicate every other
 * non-essential cookie/pixel uses); malformed code → silently dropped. The
 * page renders normally in every case — a referral param can never break or
 * redirect a landing.
 */
async function capturableReferralCode(request: NextRequest): Promise<string | null> {
  const code = parseReferralParam(request.nextUrl.searchParams.get("ref"));
  if (code === null) return null;

  const host = request.headers.get("host") ?? "";
  const resolution = await resolveManifest(host);
  if (resolution?.manifest.store?.status !== "live") return null;
  const behavior = resolveBehavior(resolution.manifest);
  if (!behavior.referrals.enabled) return null;

  const enforced = cookieConsentEnforced(
    behavior.compliance.cookieConsent,
    resolveRequestGeo(request.headers),
    // Kill-switch tightening (wave 2): tracking stores can't disable the gate.
    storeHasBrowserTracking(resolution.manifest, behavior),
  );
  const signal = parseConsentCookie(readCookie(request.headers, CONSENT_COOKIE));
  // Global Privacy Control (F1): stateless opt-out, wins over any cookie.
  if (gpcHeaderDenied(request.headers) || !nonEssentialAllowed(enforced, signal)) return null;

  return code;
}

/**
 * Draft-preview handshake (concern 4, lib/preview.ts): a request carrying
 * `?__preview=<token>` on ANY page verifies the token against the stores
 * module, stashes it in the short-lived httpOnly `fd_preview` cookie, and
 * redirects to the clean URL — `request-manifest.ts` then renders the
 * tokened draft while the cookie lives. Every refusal is EXPLICIT (a plain
 * 4xx/503 page, never a silent fall-through to the live site): a merchant
 * following a preview link must never mistake the live site for their draft.
 * Cross-tenant refusal: the token's tenant must match what this Host would
 * resolve to (the shared onrender host, which resolves nothing, is the
 * sanctioned preview surface).
 */
async function handlePreviewEntry(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get(PREVIEW_QUERY_PARAM) ?? "";
  const outcome = await resolvePreviewByToken(token);
  if (outcome.kind === "invalid") {
    return new NextResponse(
      "This preview link is invalid or has expired. Open the site builder and generate a fresh preview link.",
      { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  if (outcome.kind === "unavailable") {
    // We could NOT verify the token — that is never "render the draft" and
    // never silently "render live" either.
    return new NextResponse(
      "Preview is temporarily unavailable: the preview token could not be verified. Try again shortly.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const host = request.headers.get("host") ?? "";
  const pinnedTenant = process.env.FLIGHTDECK_TENANT?.trim() || null;
  const live = pinnedTenant !== null ? null : await resolveManifest(host);
  const allowed = previewAllowedOnHost({
    previewTenant: outcome.resolution.tenantRef,
    hostname: host,
    hostTenant: live?.tenantRef ?? null,
    pinnedTenant,
  });
  if (!allowed) {
    return new NextResponse("This preview link belongs to a different store.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const target = request.nextUrl.clone();
  target.searchParams.delete(PREVIEW_QUERY_PARAM);
  const response = NextResponse.redirect(target);
  const ttlSeconds = Math.max(
    1,
    Math.floor((Date.parse(outcome.resolution.preview.expiresAt) - Date.now()) / 1000),
  );
  response.cookies.set(PREVIEW_COOKIE, token, {
    path: "/",
    maxAge: ttlSeconds,
    sameSite: "lax",
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}

/** The alias routing decision (concerns 1 + 2) — untouched by referral capture. */
async function routeResponse(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // ── legal-slug aliases: pure rewrite, no manifest read ──────────────────
  if (POLICY_PATH_ALIASES[pathname] !== undefined) {
    const target = request.nextUrl.clone();
    target.pathname = resolvePolicyAlias(pathname);
    return NextResponse.rewrite(target);
  }

  // Default pass-through STAMPS the pathname onto the downstream request so
  // the root layout can honor per-page funnel-gate exemptions (P8). Server
  // layouts don't receive the pathname; response headers aren't readable
  // there — only request-header mutation via `next({request})` is. Pure, no
  // manifest read.
  const passThrough = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-fd-pathname", pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  // ── product slug 301 aliases ────────────────────────────────────────────
  if (!pathname.startsWith("/products/")) return passThrough();
  const slug = pathname.slice("/products/".length);
  if (slug.length === 0) return passThrough();

  const host = request.headers.get("host") ?? "";
  const resolution = await resolveManifest(host);
  if (!resolution) return passThrough();

  const currentSlug = resolveProductSlugAlias(resolution.manifest, decodeURIComponent(slug));
  if (!currentSlug) return passThrough();

  const target = request.nextUrl.clone();
  target.pathname = `/products/${currentSlug}`;
  return NextResponse.redirect(target, 301);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Draft-preview handshake first: a `?__preview=` request is a mode switch,
  // not a page view — it either sets the cookie + redirects clean, or states
  // its refusal. Nothing else in this middleware applies to it.
  if (request.nextUrl.searchParams.has(PREVIEW_QUERY_PARAM)) {
    return handlePreviewEntry(request);
  }

  // The routing decision (aliases) is computed FIRST and never altered by
  // referral capture — a ?ref-carrying alias URL still rewrites/redirects
  // exactly as before; the cookie simply rides on whatever response the
  // routing produced (and survives a 301, so the code isn't lost when the
  // landing URL was an old product slug).
  const response = await routeResponse(request);

  if (request.nextUrl.searchParams.has("ref")) {
    const code = await capturableReferralCode(request);
    if (code !== null) {
      // Last-click wins: a fresh ?ref overwrites an older stash (the
      // affiliates side bonds a customer only on the FIRST attributed order).
      response.cookies.set(REFERRAL_COOKIE, code, {
        path: "/",
        maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
        sameSite: "lax",
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
      });
    }
  }

  return response;
}

export const config = {
  // Product aliases: single path segment only (`/products/foo` matches,
  // `/products` and `/products/foo/bar` do not). Legal aliases: the exact
  // conventional paths, enumerated — they MUST mirror the keys of
  // `POLICY_PATH_ALIASES` (middleware matchers are statically analyzed by
  // Next, so this list cannot be derived from the map at runtime; the
  // middleware test pins the two in sync).
  // Referral capture: ANY page path carrying a `?ref=` query param (the
  // `has` condition keeps every ref-less request out of the middleware
  // entirely). API/asset paths are excluded — a referral lands on a page.
  matcher: [
    "/products/:slug",
    "/terms",
    "/terms-of-service",
    "/privacy",
    "/privacy-policy",
    "/shipping",
    "/returns",
    "/shipping-returns",
    "/ruo-terms",
    {
      source: "/((?!api/|_next/|favicon.ico).*)",
      has: [{ type: "query", key: "ref" }],
    },
    // Draft-preview handshake: any page carrying `?__preview=` (the `has`
    // condition keeps every other request out, same as referral capture).
    {
      source: "/((?!api/|_next/|favicon.ico).*)",
      has: [{ type: "query", key: "__preview" }],
    },
    // Funnel-gate pathname stamp (P8): every page request (assets/api
    // excluded) so the root layout can honor per-page gate exemptions. No
    // manifest read happens for a request that matches only this entry — the
    // middleware just stamps the header and returns.
    "/((?!api/|_next/|favicon.ico|.*\\.).*)",
  ],
};
