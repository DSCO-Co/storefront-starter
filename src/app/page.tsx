import type { SectionContext } from "@dscodotco/storefront-sections";
import { renderSections } from "@dscodotco/storefront-sections";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHROME_SECTION_TYPES } from "@/components/store-chrome";
import { getCatalogSource } from "@/lib/catalog-source";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";
import { homeMetadata, resolveSeoProfile } from "@/lib/seo";
import { JsonLd, organizationJsonLd, websiteJsonLd } from "@/lib/structured-data";
import { readThemeVariants } from "@/lib/theme";
import { hasPolicyPage } from "@/sections/policy-page";

export async function generateMetadata(): Promise<Metadata> {
  const resolution = await getRequestManifest();
  return resolution ? homeMetadata(resolution.manifest) : {};
}

/**
 * The store home page — manifest → sections render path (ADR 0003).
 * Age-gate/cookie-consent are mounted in `app/layout.tsx`, not here — see
 * that file's header comment.
 */
export default async function HomePage() {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const { manifest } = resolution;

  // The kill-switch honor: a draft/suspended store never falls through to
  // its sections, no matter what the manifest's template holds.
  if (manifest.store.status !== "live") {
    return (
      <main id="main" className="flex min-h-[60vh] items-center justify-center px-6 text-center">
        <p style={{ color: "var(--color-muted, #666)" }}>
          {manifest.brand.name} is not currently available.
        </p>
      </main>
    );
  }

  const products = await getCatalogSource().listProducts(resolution.tenantRef);
  const behavior = resolveBehavior(manifest);
  const theme = readThemeVariants(manifest.theme.tokens);
  const seoProfile = resolveSeoProfile(manifest);
  const open = seoProfile === "open";

  const ctx: SectionContext = {
    storeKey: manifest.catalog.storeKey,
    brandName: manifest.brand.name,
    products,
    ...(manifest.brand.assets ? { brandAssets: manifest.brand.assets } : {}),
    // Closes the faq-section JSON-LD gate that had no producer before this
    // epic — sections read the store's SEO posture from here.
    seoProfile,
    behavior,
    theme,
    hasPrivacyPolicy: hasPolicyPage(manifest, "privacy"),
    hasTermsPolicy: hasPolicyPage(manifest, "terms"),
    // Platform config, NEVER manifest content — the provenance-seal section
    // builds its widget script src from this (see the section's security
    // note). Unset ⇒ the section renders nothing.
    ...(process.env.NEXT_PUBLIC_PROVENANCE_ORIGIN
      ? { provenanceOrigin: process.env.NEXT_PUBLIC_PROVENANCE_ORIGIN }
      : {}),
  };

  return (
    <>
      {/* Organization is neutral (name + url) and safe on any store; the logo,
          WebSite + SearchAction ride only on an open-profile store. */}
      <JsonLd data={organizationJsonLd(manifest, { withAssets: open })} />
      {open ? <JsonLd data={websiteJsonLd(manifest)} /> : null}
      {/* Chrome sections (announcement-bar, header-nav, legal-footer) are
          rendered by the shared layout on every page — filtered here so they
          never double. */}
      <main id="main">
        {renderSections(
          manifest.template.sections.filter(
            (section) => !CHROME_SECTION_TYPES.includes(section.type),
          ),
          ctx,
        )}
      </main>
      {/* RUO_DISCLAIMER is mandatory and non-removable (compliance surface).
          The layout mounts exactly one footer per page: the manifest's
          legal-footer as footer chrome, or the compact StoreDisclaimerFooter
          fallback when the template carries none. */}
    </>
  );
}
