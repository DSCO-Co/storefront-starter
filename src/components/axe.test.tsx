import type { OrderPricingConfig } from "@dscodotco-shared/order-totals";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckoutForm } from "@/app/checkout/CheckoutForm";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { LiveAnnouncer } from "@/components/live-announcer";
import { PdpPurchasePanel } from "@/components/product/pdp-purchase-panel";
import { addLine, EMPTY_CART, saveCart } from "@/lib/cart";
import type { ProductVariant } from "@/lib/catalog-source";

/**
 * Axe smoke tests (consumer-compliance remediation 2026-09-09, D7): the
 * rendered DOM of the storefront's key interactive components must produce
 * ZERO axe violations — the failable check behind the accessibility
 * statement's "automated axe checks on key components" claim.
 *
 * Scope: WCAG 2.0/2.1 A + AA rule tags. `color-contrast` is excluded
 * because jsdom has no layout/paint engine to compute rendered colors from
 * the CSS-variable theme (contrast is a theme-token concern, checked
 * manually per the statement).
 */
async function expectNoViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: {
      // jsdom cannot compute rendered colors (no layout engine).
      "color-contrast": { enabled: false },
    },
  });
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual([]);
}

const STORE_KEY = "store-a";

const VARIANTS: ProductVariant[] = [
  { label: "5mg", sku: "BPC-5", priceCents: 4000 },
  { label: "10mg", sku: "BPC-10", priceCents: 6000 },
];

const PRICING: OrderPricingConfig = {
  shipping: {
    mode: "flat",
    flatRateCents: 895,
    expeditedRateCents: 895,
    maxCents: 10000,
    freeShippingThresholdCents: null,
  },
  tax: { provider: "null", rateBps: 0 },
  expedited: false,
};

afterEach(cleanup);

describe("axe smoke — storefront components", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // biome-ignore lint/suspicious/noDocumentCookie: test harness clears the consent cookie directly — no CookieStore in jsdom.
    document.cookie = "fd_consent=; max-age=0; path=/";
  });

  it("PDP purchase panel has no violations", async () => {
    const { container } = render(
      <PdpPurchasePanel
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variants={VARIANTS}
        initialVariantLabel={null}
      />,
    );
    await expectNoViolations(container);
  });

  it("cookie consent banner (with and without the privacy-policy link) has no violations", async () => {
    const first = render(<CookieConsentBanner showPrivacyPolicy />);
    await screen.findByTestId("cookie-consent-banner");
    await expectNoViolations(first.container);
    first.unmount();

    const second = render(<CookieConsentBanner showPrivacyPolicy={false} />);
    await screen.findByTestId("cookie-consent-banner");
    await expectNoViolations(second.container);
  });

  it("checkout form (seeded cart, RUO ack, coupon + gift card affordances) has no violations", async () => {
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 2,
      }),
    );
    const { container } = render(
      <CheckoutForm
        storeKey={STORE_KEY}
        pricing={PRICING}
        ageGate={{ minAge: 21 }}
        promotionsEnabled
        giftCardsEnabled
      />,
    );
    await screen.findByTestId("checkout-form");
    await expectNoViolations(container);
  });

  it("live announcer region is itself violation-free", async () => {
    const { container } = render(<LiveAnnouncer />);
    await expectNoViolations(container);
  });
});
