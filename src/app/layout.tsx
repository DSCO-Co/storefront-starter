import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AgeGate } from "@/components/age-gate";
import { CartBadge } from "@/components/cart/cart-badge";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { FunnelGate, GateRenewer } from "@/components/funnel-gate";
import { LiveAnnouncer } from "@/components/live-announcer";
import { PixelScripts } from "@/components/pixels/pixel-scripts";
import { PreviewBanner } from "@/components/preview-banner";
import { StoreChrome } from "@/components/store-chrome";
import { StoreDisclaimerFooter } from "@/components/store-compliance";
import { SupportWidget } from "@/components/support-widget";
import { hasAgePass, readCookie } from "@/lib/compliance-cookies";
import { renderScopedCustomCss } from "@/lib/custom-css-scope";
import { funnelGateInstalled, GATE_COOKIE, resolveGateDecision } from "@/lib/gate";
import { createLogger } from "@/lib/logger";
import { resolveBehavior, storeHasBrowserTracking } from "@/lib/manifest";
import { cookieConsentEnforced, resolveRequestGeo } from "@/lib/region";
import { getRequestManifest } from "@/lib/request-manifest";
import { layoutMetadata } from "@/lib/seo";
import { themeContrastFindings, themeToRootCss } from "@/lib/theme";
import { hasPolicyPage } from "@/sections/policy-page";
import "@/styles/globals.css";

const layoutLogger = createLogger("storefront-layout");

/**
 * Per-host base metadata: `metadataBase` (so rooted asset URLs resolve
 * absolute), the store name title default, the favicon, and — the meta half of
 * the robots.txt lockdown — `noindex` for any non-open store. Per-page
 * `generateMetadata` layers canonical/OpenGraph on top. An unresolvable host
 * contributes nothing here; the layout body's own `notFound()` handles it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const resolution = await getRequestManifest();
  if (!resolution) return {};
  const base = layoutMetadata(resolution.manifest);
  // Draft preview: FORCED noindex, unconditionally — an unpublished version
  // must never be indexable, whatever the manifest's own SEO posture says.
  if (resolution.preview) {
    return { ...base, robots: { index: false, follow: false } };
  }
  return base;
}

/**
 * The composition root for every hosted store. Resolves the request's Host
 * header to a manifest (ADR 0003, fail-closed — unknown host is a hard 404,
 * never a fallback store) and injects the store's DTCG tokens as `--*` CSS
 * custom properties. Components consume ONLY those vars, never hardcoded
 * brand colors — that is the entire theming mechanism of the multi-tenant
 * renderer.
 *
 * Compliance blocks (age gate, cookie consent) mount HERE, not per-page —
 * both components' own header comments already documented "the layout
 * gates it" as the intent; `app/page.tsx` rendering them itself (until this
 * change) was drift from that. Mounting once in the layout means every
 * route under it — home, and the shop routes added alongside this change
 * (`/products`, `/cart`, `/checkout`, …) — inherits them structurally,
 * instead of each new page needing to remember to re-render them.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const { manifest } = resolution;
  const rootCss = themeToRootCss(manifest.theme.tokens);
  // Advisory contrast check on the tenant's theme (audit F4: tenant tokens
  // were never contrast-checked). Never render-blocking — a finding is a
  // logged defect for the store's operators, not a refused storefront.
  const contrastFindings = themeContrastFindings(manifest.theme.tokens);
  if (contrastFindings.length > 0) {
    layoutLogger.warn("storefront theme fails contrast floors", {
      storeKey: manifest.catalog.storeKey,
      findings: contrastFindings,
    });
  }
  // Per-store custom CSS — the last rung of the extension ladder. Sanitized
  // (validate-verbatim-or-reject) and nested under this store's root selector;
  // a manifest with no customCss contributes ZERO bytes here.
  const customCssBlock = renderScopedCustomCss(manifest.catalog.storeKey, manifest.theme.customCss);
  const behavior = resolveBehavior(manifest);
  const hasLegalFooter = manifest.template.sections.some(
    (section) => section.type === "legal-footer",
  );
  const ageGate = behavior.compliance.ageGate;
  const cookieConsent = behavior.compliance.cookieConsent;

  // Server-aware compliance decisions (LOO-3050) — resolved from the request
  // headers so a reload cannot bypass them.
  const requestHeaders = await headers();
  const geo = resolveRequestGeo(requestHeaders);
  // The cookie-consent banner shows only when the gate is ENFORCED for this
  // visitor's region (the SAME predicate the checkout beacon-suppression
  // uses — one source of truth for "is consent required here").
  // Kill-switch tightening (wave 2): a store with browser tracking cannot
  // opt out of the banner via `cookieConsent.enabled: false`.
  const showConsentBanner = cookieConsentEnforced(
    cookieConsent,
    geo,
    storeHasBrowserTracking(manifest, behavior),
  );
  // Interstitial age gate: BLOCK entry until the httpOnly pass cookie is
  // present. Because this is decided server-side from an httpOnly cookie,
  // clearing storage / reloading re-triggers it — the anti-bypass property.
  // `checkbox` mode is NOT blocked at entry; it gates checkout server-side.
  const ageGateBlocking =
    ageGate.enabled && ageGate.mode === "interstitial" && !hasAgePass(requestHeaders);

  // Funnel gate (P8): the paid verification wall. Decided server-side from
  // the manifest mode + the funnel_gate entitlement (the flag alone is not
  // trusted) + the signed session cookie. "blocked" replaces the entire
  // page (no catalog markup behind it); "renew" mounts the silent renewer so
  // an active shopper is never bounced mid-flow.
  const fgConfig = behavior.gating.funnelGuard;
  const gateInstalled =
    fgConfig.mode === "challenge" ? await funnelGateInstalled(resolution.tenantRef) : false;
  const gateDecision = await resolveGateDecision(
    {
      behavior,
      tenantRef: resolution.tenantRef,
      pathname: requestHeaders.get("x-fd-pathname") ?? "",
      gateCookie: readCookie(requestHeaders, GATE_COOKIE) ?? undefined,
      userAgent: requestHeaders.get("user-agent"),
      now: new Date(),
    },
    gateInstalled,
  );

  // Browser pixels (gap brief 2026-09-06): triple-gated at MOUNT — the store
  // opted in (`browserPixelEnabled`, default false), it configured at least
  // one pixel id, and it is live (a draft/suspended store fires nothing,
  // same kill-switch posture as the chrome/cart gates below). A store
  // failing any gate mounts NOTHING — zero extra bytes. Consent is the
  // component's own fourth gate, client-side, same predicate as `track()`.
  const pixelRefs = manifest.refs.pixels ?? {};
  const mountPixels =
    behavior.analytics.browserPixelEnabled &&
    manifest.store.status === "live" &&
    Object.values(pixelRefs).some((id) => typeof id === "string" && id.trim().length > 0);

  return (
    <html lang="en">
      {/* `data-consent-required` mirrors the banner-mount gate so the client
          `track()` helper can short-circuit funnel fires WITHOUT a round-trip
          when consent is enforced-but-not-granted — the server /api/track
          route re-checks the same gate as the authority. */}
      <body
        data-store-root={manifest.catalog.storeKey}
        data-consent-required={showConsentBanner ? "1" : "0"}
      >
        {/* Skip link (WCAG 2.4.1, D5): the FIRST focusable element on every
            page — visually hidden until keyboard focus, jumps to the page's
            `<main id="main">`. `fd-skip-link` (globals.css) carries the
            hide/reveal itself: composing Tailwind's `.sr-only` with `.fd-btn`
            broke — fd-btn's `position: relative` loads after utilities and
            defeats sr-only's clip, leaving a stray "main" sliver visible in
            the corner of every page. */}
        <a href="#main" className="fd-btn fd-btn-primary fd-btn-sm fd-skip-link">
          Skip to main content
        </a>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: themeToRootCss sanitizes every token value (lib/tokens.ts strips `;{}<>`); input is the resolved manifest, not user input. */}
        <style dangerouslySetInnerHTML={{ __html: rootCss }} />
        {customCssBlock !== null ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the sheet passed sanitizeCustomCss (verbatim-or-rejected) and is nested under this store's root selector (lib/custom-css-scope.ts). Rendered AFTER the token block so stores layer on top of tokens.
          <style dangerouslySetInnerHTML={{ __html: customCssBlock }} />
        ) : null}
        {gateDecision === "blocked" ? (
          // The verification wall replaces the page entirely — themed shell,
          // no chrome, no catalog markup behind it.
          <FunnelGate
            turnstileSiteKey={fgConfig.turnstileSiteKey}
            requireAgeConfirmation={fgConfig.requireAgeConfirmation}
            minAge={ageGate.minAge}
          />
        ) : (
          <>
            {/* Store chrome renders on EVERY page of a live store: header chrome
            (announcement bar + header nav) before the page, footer chrome
            (the manifest's legal-footer) after it. The home page filters
            these section types out of its own render. A draft/suspended
            store gets no chrome — same kill-switch posture as the cart
            badge below. */}
            {manifest.store.status === "live" ? (
              <StoreChrome manifest={manifest} position="header" />
            ) : null}
            {children}
            {/* EXACTLY ONE footer per page, mounted structurally (audit P1-6):
            the manifest's full legal-footer as footer chrome when the
            template carries one, else the compact non-removable disclaimer
            fallback. Pages render neither themselves. */}
            {manifest.store.status === "live" ? (
              hasLegalFooter ? (
                <StoreChrome manifest={manifest} position="footer" />
              ) : (
                <StoreDisclaimerFooter
                  showPrivacyPolicy={hasPolicyPage(manifest, "privacy")}
                  showTermsOfService={hasPolicyPage(manifest, "terms")}
                />
              )
            ) : null}
            {/* A draft/suspended store's shop pages never render a cart worth
            badging — each page's own status check shows the "not currently
            available" state instead of a cart. */}
            {manifest.store.status === "live" ? (
              <CartBadge storeKey={manifest.catalog.storeKey} />
            ) : null}
            {ageGateBlocking ? <AgeGate minAge={ageGate.minAge} mode={ageGate.mode} /> : null}
            {gateDecision === "renew" ? <GateRenewer /> : null}
          </>
        )}
        {/* Polite live region (D6): mounted once so add-to-cart / cart-count /
            coupon / checkout announcements reach screen readers everywhere. */}
        <LiveAnnouncer />
        {mountPixels ? <PixelScripts pixels={pixelRefs} /> : null}
        {showConsentBanner ? (
          <CookieConsentBanner showPrivacyPolicy={hasPolicyPage(manifest, "privacy")} />
        ) : null}
        <SupportWidget />
        {/* Draft preview: the fixed, non-dismissible marker — the ONE honest
            signal that this render is an unpublished version. */}
        {resolution.preview ? <PreviewBanner version={resolution.preview.version} /> : null}
      </body>
    </html>
  );
}
