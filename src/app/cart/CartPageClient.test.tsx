import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addLine, EMPTY_CART, saveCart } from "@/lib/cart";
import { CartPageClient } from "./CartPageClient";

const STORE_KEY = "store-a";

afterEach(cleanup);

describe("CartPageClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows an empty-cart state with a link back to the shop", async () => {
    render(<CartPageClient storeKey={STORE_KEY} />);
    expect(await screen.findByTestId("cart-empty")).toBeInTheDocument();
    expect(screen.getByTestId("cart-empty-shop-link")).toHaveAttribute("href", "/products");
  });

  it("lists lines, updates quantity, and recomputes the total", async () => {
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
    render(<CartPageClient storeKey={STORE_KEY} />);
    await screen.findByTestId("cart-lines");
    expect(screen.getByTestId("cart-total")).toHaveTextContent("$90.00");

    fireEvent.change(screen.getByTestId("cart-line-quantity"), { target: { value: "5" } });
    await waitFor(() => expect(screen.getByTestId("cart-total")).toHaveTextContent("$225.00"));
    // The qty control rides the themed recipe — never a default white UA box.
    expect(screen.getByTestId("cart-line-quantity")).toHaveClass("fd-input");
  });

  it("removing the only line returns to the empty state", async () => {
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
      }),
    );
    render(<CartPageClient storeKey={STORE_KEY} />);
    await screen.findByTestId("cart-lines");
    fireEvent.click(screen.getByTestId("cart-line-remove"));
    await waitFor(() => expect(screen.getByTestId("cart-empty")).toBeInTheDocument());
  });

  it("links checkout from a populated cart", async () => {
    saveCart(
      STORE_KEY,
      addLine(EMPTY_CART, {
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
      }),
    );
    render(<CartPageClient storeKey={STORE_KEY} />);
    await screen.findByTestId("cart-lines");
    expect(screen.getByTestId("cart-checkout-link")).toHaveAttribute("href", "/checkout");
  });
});
