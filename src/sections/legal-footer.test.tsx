/**
 * ComplianceLinks honesty (audit P0-1): "Your Privacy Choices" and the
 * accessibility statement are real routes this app serves unconditionally —
 * always linked. `/policies/privacy` exists only when the manifest carries
 * that policy page, so the Privacy Policy link renders only when the caller
 * verified it does (and the default is NOT to link).
 */

import { ComplianceLinks, renderSection } from "@dscodotco/storefront-sections";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import designDark from "@/fixtures/manifests/design-dark.json";
import bioArchetype from "@/fixtures/manifests/store-0-bio-archetype.json";
import { storeManifestSchema } from "@/lib/manifest";
import { hasPolicyPage } from "@/sections/policy-page";

afterEach(cleanup);

function hrefs(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
}

describe("ComplianceLinks", () => {
  it("always links the real privacy-choices and accessibility routes", () => {
    const { container } = render(<ComplianceLinks showPrivacyPolicy={false} />);
    expect(hrefs(container)).toEqual(["/privacy-choices", "/accessibility"]);
  });

  it("links the privacy policy only when the store verifiably carries one", () => {
    const { container } = render(<ComplianceLinks showPrivacyPolicy={true} />);
    expect(hrefs(container)).toContain("/policies/privacy");
  });

  it("defaults to NOT linking the privacy policy", () => {
    const { container } = render(<ComplianceLinks />);
    expect(hrefs(container)).not.toContain("/policies/privacy");
  });

  // ── E2: Terms of Service (2026-09-09 wave 2) ────────────────────────────

  it("links the Terms of Service only when the store verifiably carries a terms page", () => {
    const { container } = render(<ComplianceLinks showTermsOfService />);
    expect(hrefs(container)).toContain("/policies/terms");
    cleanup();
    const bare = render(<ComplianceLinks />);
    expect(hrefs(bare.container)).not.toContain("/policies/terms");
  });

  // ── E4: CPRA opt-out icon (2026-09-09 wave 2) ───────────────────────────

  it("renders the opt-out icon beside 'Your Privacy Choices', decorative with the text as label", () => {
    const { container } = render(<ComplianceLinks />);
    const link = [...container.querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "/privacy-choices",
    );
    if (!link) throw new Error("privacy-choices link must render");
    const icon = link.querySelector('[data-testid="privacy-optout-icon"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(link.textContent).toContain("Your Privacy Choices");
  });
});

describe("legal-footer section", () => {
  it("renders the privacy-policy link only for a manifest that carries the policy page", () => {
    // store-0 carries the split legal pack (privacy included); design-dark
    // carries no policy-page sections at all.
    const withPolicies = storeManifestSchema.parse(bioArchetype);
    const withoutPolicies = storeManifestSchema.parse(designDark);
    expect(hasPolicyPage(withPolicies, "privacy")).toBe(true);
    expect(hasPolicyPage(withoutPolicies, "privacy")).toBe(false);

    const linkedSection = withPolicies.template.sections.find((s) => s.type === "legal-footer");
    if (!linkedSection) throw new Error("store-0 fixture must carry a legal-footer section");
    // design-dark's legal-footer carries NO marketing links of its own — the
    // compliance nav is the only place a /policies/privacy href could come
    // from, which is what this pins.
    const bareSection = withoutPolicies.template.sections.find((s) => s.type === "legal-footer");
    if (!bareSection) throw new Error("design-dark fixture must carry a legal-footer section");

    const linked = render(
      renderSection(linkedSection, {
        storeKey: "store-0-bio-archetype",
        brandName: "Helix Bio",
        products: [],
        hasPrivacyPolicy: true,
      }),
    );
    expect(hrefs(linked.container)).toContain("/policies/privacy");
    cleanup();

    const unlinked = render(
      renderSection(bareSection, {
        storeKey: "design-dark",
        brandName: "Demo",
        products: [],
        hasPrivacyPolicy: false,
      }),
    );
    expect(hrefs(unlinked.container)).not.toContain("/policies/privacy");
  });
});
