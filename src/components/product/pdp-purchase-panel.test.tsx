import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cartStorageKey } from "@/lib/cart";
import type { ProductVariant } from "@/lib/catalog-source";
import { PdpPurchasePanel } from "./pdp-purchase-panel";

const STORE_KEY = "store-a";

const VARIANTS: ProductVariant[] = [
  { label: "5mg", sku: "BPC-5", priceCents: 4000 },
  { label: "10mg", sku: "BPC-10", priceCents: 6000 },
];

afterEach(cleanup);

describe("PdpPurchasePanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the first variant, or preselects from initialVariantLabel", () => {
    const { unmount } = render(
      <PdpPurchasePanel
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variants={VARIANTS}
        initialVariantLabel={null}
      />,
    );
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    unmount();

    render(
      <PdpPurchasePanel
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variants={VARIANTS}
        initialVariantLabel="10mg"
      />,
    );
    expect(screen.getByText("$60.00")).toBeInTheDocument();
  });

  it("switching variant options updates the displayed price", () => {
    render(
      <PdpPurchasePanel
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variants={VARIANTS}
        initialVariantLabel={null}
      />,
    );
    fireEvent.click(screen.getAllByTestId("variant-option")[1] as HTMLElement);
    expect(screen.getByText("$60.00")).toBeInTheDocument();
  });

  it("add to cart persists the SELECTED variant's id/price, not the default", async () => {
    render(
      <PdpPurchasePanel
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variants={VARIANTS}
        initialVariantLabel={null}
      />,
    );
    fireEvent.click(screen.getAllByTestId("variant-option")[1] as HTMLElement);
    fireEvent.click(screen.getByTestId("pdp-add-to-cart"));

    await waitFor(() => expect(screen.getByText("Added to cart")).toBeInTheDocument());
    const stored = JSON.parse(window.localStorage.getItem(cartStorageKey(STORE_KEY)) ?? "{}");
    expect(stored.lines).toHaveLength(1);
    expect(stored.lines[0].variantId).toBe("BPC-10");
    expect(stored.lines[0].unitPriceCents).toBe(6000);
  });

  it("hides the variant picker for a single-variant product", () => {
    render(
      <PdpPurchasePanel
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variants={[VARIANTS[0] as ProductVariant]}
        initialVariantLabel={null}
      />,
    );
    expect(screen.queryByTestId("variant-option")).not.toBeInTheDocument();
  });

  it("renders a fallback message when there are no purchasable variants", () => {
    render(
      <PdpPurchasePanel
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variants={[]}
        initialVariantLabel={null}
      />,
    );
    expect(screen.getByText(/no purchasable size/i)).toBeInTheDocument();
  });
});
