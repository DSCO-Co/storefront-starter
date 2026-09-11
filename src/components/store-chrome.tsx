import type { SectionContext } from "@dscodotco/storefront-sections";
import { renderSections } from "@dscodotco/storefront-sections";
import type { ReactNode } from "react";
import { readBrandAssets } from "@/lib/brand-assets";
import { resolveBehavior, type StoreManifest } from "@/lib/manifest";
import { readThemeVariants } from "@/lib/theme";
import { hasPolicyPage } from "@/sections/policy-page";

/**
 * Store chrome — the manifest-driven pieces that must appear on EVERY page
 * of a hosted store, rendered from the shared layout instead of only on the
 * home page's section list. Before this existed, `/products`, PDPs, `/cart`,
 * etc. rendered with NO header at all: the template's `header-nav` section
 * lived exclusively in the home page's `renderSections` pass (the exact
 * inconsistency LOO-called-out on the demo store).
 *
 * TWO positions (audit P1-6): `header` chrome (announcement bar + header nav)
 * renders BEFORE the page, `footer` chrome (the manifest's `legal-footer`)
 * renders AFTER it. The layout mounts one `<StoreChrome/>` per position; the
 * home page filters ALL chrome types out of its own section render (see
 * `CHROME_SECTION_TYPES`) so the manifest stays the single source of truth
 * and nothing renders twice. Inner pages that previously carried only the
 * compact `StoreDisclaimerFooter` now get the store's full legal footer;
 * `StoreDisclaimerFooter` self-gates to avoid a double disclaimer.
 *
 * `products` is intentionally empty here: no chrome section consumes the
 * catalog, and the layout must not pay a catalog fetch on every route. If a
 * future chrome section needs products, lift the fetch — do not pass a
 * silently-wrong empty list to a section that renders from it.
 */
export const CHROME_HEADER_SECTION_TYPES: readonly string[] = ["announcement-bar", "header-nav"];
export const CHROME_FOOTER_SECTION_TYPES: readonly string[] = ["legal-footer"];
export const CHROME_SECTION_TYPES: readonly string[] = [
  ...CHROME_HEADER_SECTION_TYPES,
  ...CHROME_FOOTER_SECTION_TYPES,
];

export type StoreChromePosition = "header" | "footer";

export function StoreChrome({
  manifest,
  position = "header",
}: {
  manifest: StoreManifest;
  position?: StoreChromePosition;
}): ReactNode {
  const types = position === "header" ? CHROME_HEADER_SECTION_TYPES : CHROME_FOOTER_SECTION_TYPES;
  const chrome = manifest.template.sections.filter((section) => types.includes(section.type));
  if (chrome.length === 0) return null;
  const brandAssets = readBrandAssets(manifest);
  const ctx: SectionContext = {
    storeKey: manifest.catalog.storeKey,
    brandName: manifest.brand.name,
    products: [],
    ...(Object.keys(brandAssets).length > 0 ? { brandAssets } : {}),
    behavior: resolveBehavior(manifest),
    theme: readThemeVariants(manifest.theme.tokens),
    hasPrivacyPolicy: hasPolicyPage(manifest, "privacy"),
    hasTermsPolicy: hasPolicyPage(manifest, "terms"),
  };
  return <>{renderSections(chrome, ctx)}</>;
}
