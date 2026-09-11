import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addLine, EMPTY_CART, saveCart } from "@/lib/cart";
import { CartBadge } from "./cart-badge";

const STORE_KEY = "store-a";

afterEach(cleanup);

describe("CartBadge", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders nothing before hydration, then the item count", async () => {
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 3,
      }),
    );
    render(<CartBadge storeKey={STORE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("cart-badge-count")).toHaveTextContent("3"));
  });

  it("shows 0 for an empty cart, and links to /cart", async () => {
    render(<CartBadge storeKey={STORE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("cart-badge-count")).toHaveTextContent("0"));
    expect(screen.getByTestId("cart-badge")).toHaveAttribute("href", "/cart");
  });

  it("namespaces per store — a different store's badge never shows this store's count", async () => {
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 3,
      }),
    );
    render(<CartBadge storeKey="a-different-store" />);
    await waitFor(() => expect(screen.getByTestId("cart-badge-count")).toHaveTextContent("0"));
  });
});
