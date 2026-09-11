/**
 * StoreDisclaimerFooter — the compact non-removable disclaimer fallback the
 * layout mounts when a template carries no legal-footer section (audit
 * P1-6). Carries the RUO disclaimer + compliance links; the privacy-policy
 * link follows the ComplianceLinks honesty rule (audit P0-1).
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StoreDisclaimerFooter } from "./store-compliance";

afterEach(cleanup);

describe("StoreDisclaimerFooter", () => {
  it("renders the disclaimer + compliance links, without a privacy link by default", () => {
    const { container } = render(<StoreDisclaimerFooter />);
    expect(container.querySelector('[data-testid="ruo-disclaimer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="compliance-links"]')).not.toBeNull();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/privacy-choices");
    expect(hrefs).toContain("/accessibility");
    expect(hrefs).not.toContain("/policies/privacy");
  });

  it("links the privacy policy when the caller verified the store carries one", () => {
    const { container } = render(<StoreDisclaimerFooter showPrivacyPolicy={true} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/policies/privacy");
  });
});
