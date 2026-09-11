/**
 * Store chrome contract: the header (and announcement bar) must render on
 * EVERY page via the shared layout — and, since audit P1-6, the manifest's
 * legal-footer renders as FOOTER chrome after the page on every route. The
 * home page must not render any chrome section a second time. Regression pin
 * for the demo-store bug where /products, PDPs, and /cart shipped with no
 * header at all — header-nav lived only in the home page's section render.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import designDark from "@/fixtures/manifests/design-dark.json";
import { storeManifestSchema } from "@/lib/manifest";
import {
  CHROME_FOOTER_SECTION_TYPES,
  CHROME_HEADER_SECTION_TYPES,
  CHROME_SECTION_TYPES,
  StoreChrome,
} from "./store-chrome";

afterEach(cleanup);

const manifest = storeManifestSchema.parse(designDark);

describe("StoreChrome", () => {
  it("header position renders the manifest's header-nav and announcement-bar, not the footer", () => {
    const { container } = render(<StoreChrome manifest={manifest} position="header" />);
    expect(container.querySelector('[data-section="header-nav"]')).not.toBeNull();
    // The wordmark renders the header-nav section's logoText, not brand.name.
    expect(container.textContent).toContain("Demo storefront");
    expect(container.textContent).toContain("Catalog");
    expect(container.querySelector('[data-section="legal-footer"]')).toBeNull();
  });

  it("footer position renders ONLY the legal-footer (the layout mounts it after children)", () => {
    const { container } = render(<StoreChrome manifest={manifest} position="footer" />);
    expect(container.querySelector('[data-section="legal-footer"]')).not.toBeNull();
    expect(container.querySelector('[data-section="header-nav"]')).toBeNull();
    expect(container.querySelector('[data-section="announcement-bar"]')).toBeNull();
    // The full footer carries the mandatory disclaimer + compliance links —
    // this is what lets inner pages' StoreDisclaimerFooter self-gate off.
    expect(container.querySelector('[data-testid="ruo-disclaimer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="compliance-links"]')).not.toBeNull();
  });

  it("position defaults to header", () => {
    const { container } = render(<StoreChrome manifest={manifest} />);
    expect(container.querySelector('[data-section="header-nav"]')).not.toBeNull();
    expect(container.querySelector('[data-section="legal-footer"]')).toBeNull();
  });

  it("renders nothing for a manifest with no chrome sections", () => {
    const bare = storeManifestSchema.parse({
      ...designDark,
      template: {
        ...manifest.template,
        sections: manifest.template.sections.filter(
          (section) => !CHROME_SECTION_TYPES.includes(section.type),
        ),
      },
    });
    expect(render(<StoreChrome manifest={bare} position="header" />).container.innerHTML).toBe("");
    cleanup();
    expect(render(<StoreChrome manifest={bare} position="footer" />).container.innerHTML).toBe("");
  });

  it("chrome types cover exactly announcement-bar, header-nav, and legal-footer", () => {
    // The home page filters CHROME_SECTION_TYPES out of its own render — a
    // type added to a position list without landing in the combined list
    // would double-render on home; one only in the combined list would
    // never render at all.
    expect([...CHROME_HEADER_SECTION_TYPES].sort()).toEqual(["announcement-bar", "header-nav"]);
    expect([...CHROME_FOOTER_SECTION_TYPES]).toEqual(["legal-footer"]);
    expect([...CHROME_SECTION_TYPES].sort()).toEqual([
      "announcement-bar",
      "header-nav",
      "legal-footer",
    ]);
  });
});
