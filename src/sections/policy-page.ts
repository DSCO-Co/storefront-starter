import { type PolicyPage, policyPagePropsSchema } from "@dscodotco/storefront-sections";
import { defaultCopyVars, sanitizeCopyDeep } from "@/lib/copy-tokens";
import type { StoreManifest } from "@/lib/manifest";

/**
 * Manifest-traversal helpers for `policy-page` sections. These are route/SEO
 * concerns (they need the server-resolved `StoreManifest`), NOT section
 * presentation — so they stay storefront-side while the section def +
 * `policyPagePropsSchema` live in `@dscodotco/storefront-sections`. Imported by the
 * `/policies/[slug]` route, `store-chrome`, `seo.ts`, and layout/home.
 */

export type { PolicyPage };

/** All valid policy pages a manifest carries, in template order. */
export function policyPagesFromManifest(manifest: StoreManifest): PolicyPage[] {
  return manifest.template.sections
    .filter((section) => section.type === "policy-page")
    .flatMap((section) => {
      const props = policyPagePropsSchema.safeParse(section.props ?? {});
      // Copy-token firewall (LOO-3163): this route bypasses renderSection's
      // sanitizer (content carrier), and the provisioning legal pack is
      // TEMPLATED text — the classic `{{TOKEN}}` leak vector. Same rule:
      // known tokens resolve, unknown tokens are unrenderable.
      return props.success
        ? [sanitizeCopyDeep(props.data, defaultCopyVars(manifest.brand.name))]
        : [];
    });
}

/**
 * Slug synonyms (LOO-3050): the provisioning legal pack ships a combined
 * `shipping-returns` page while Store #0's fixture splits `shipping`/`returns`
 * — either convention answers the other's URL so no legal path 404s.
 */
const POLICY_SLUG_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  terms: ["terms-of-service"],
  "terms-of-service": ["terms"],
  privacy: ["privacy-policy"],
  "privacy-policy": ["privacy"],
  shipping: ["shipping-returns"],
  returns: ["shipping-returns"],
  "shipping-returns": ["shipping", "returns"],
};

/** True when the manifest carries a policy page answering this slug (synonyms included). */
export function hasPolicyPage(manifest: StoreManifest, slug: string): boolean {
  return findPolicyPage(manifest, slug) !== null;
}

export function findPolicyPage(manifest: StoreManifest, slug: string): PolicyPage | null {
  const pages = policyPagesFromManifest(manifest);
  const exact = pages.find((page) => page.slug === slug);
  if (exact) return exact;
  for (const synonym of POLICY_SLUG_SYNONYMS[slug] ?? []) {
    const match = pages.find((page) => page.slug === synonym);
    if (match) return match;
  }
  return null;
}
