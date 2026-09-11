import { ComplianceLinks, RuoDisclaimer } from "@dscodotco/storefront-sections";

/**
 * The mandatory, non-removable RUO disclaimer footer — the compact fallback
 * for stores whose template carries NO `legal-footer` section. Mounted by
 * `app/layout.tsx` (audit P1-6): the layout renders the manifest's full
 * legal-footer as footer chrome when the template has one, and this compact
 * footer otherwise — every page gets exactly one of the two structurally,
 * and no page renders the disclaimer twice. Age gate and cookie consent are
 * likewise mounted globally in the layout.
 *
 * `showPrivacyPolicy` follows the ComplianceLinks honesty rule (audit P0-1):
 * true only when the caller verified the manifest carries the privacy
 * policy page.
 */
export function StoreDisclaimerFooter({
  showPrivacyPolicy = false,
  showTermsOfService = false,
}: {
  showPrivacyPolicy?: boolean;
  /** Same honesty rule (E2): true only when the manifest carries a terms page. */
  showTermsOfService?: boolean;
}) {
  return (
    <footer className="px-6 py-10">
      <RuoDisclaimer />
      <ComplianceLinks
        showPrivacyPolicy={showPrivacyPolicy}
        showTermsOfService={showTermsOfService}
      />
    </footer>
  );
}
