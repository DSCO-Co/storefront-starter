/**
 * Header nav mobile reachability (audit P1-4): BOTH header architectures
 * must collapse their link row under `sm` and offer the MobileNavMenu
 * hamburger — before this, only glass-pill did, and a classic-theme store's
 * nav links were simply unreachable on a phone.
 */

import type { SectionContext } from "@dscodotco/storefront-sections";
import { renderSection } from "@dscodotco/storefront-sections";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const links = [
  { label: "Catalog", href: "#catalog" },
  { label: "About", href: "/about" },
];

function renderHeader(navStyle: "classic" | "glass-pill") {
  const ctx: SectionContext = {
    storeKey: "store-test",
    brandName: "Test Brand",
    products: [],
    theme: { navStyle, heroStyle: null, footerStyle: "columns" },
  };
  return render(renderSection({ type: "header-nav", props: { links } }, ctx));
}

describe("header-nav", () => {
  for (const navStyle of ["classic", "glass-pill"] as const) {
    it(`${navStyle} variant renders the mobile menu trigger and a sm-collapsed link row`, () => {
      const { container } = renderHeader(navStyle);
      expect(container.querySelector(`[data-nav="${navStyle}"]`)).not.toBeNull();
      expect(container.querySelector('[data-testid="mobile-nav-trigger"]')).not.toBeNull();
      // The desktop link row is hidden under sm (the hamburger is the path).
      const catalogLink = [...container.querySelectorAll("a")].find(
        (a) => a.textContent === "Catalog",
      );
      expect(catalogLink).toBeDefined();
      expect(catalogLink?.closest("span.hidden")).not.toBeNull();
    });
  }
});
