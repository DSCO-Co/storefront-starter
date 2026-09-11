import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cartStorageKey } from "@/lib/cart";
import { AddToCartButton } from "./add-to-cart-button";

const STORE_KEY = "store-a";

afterEach(cleanup);

describe("AddToCartButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("adds one unit of the given variant and briefly confirms", async () => {
    render(
      <AddToCartButton
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variantId="var-1"
        variantLabel="10mg"
        unitPriceCents={4500}
      />,
    );
    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    await waitFor(() => expect(screen.getByText("Added")).toBeInTheDocument());

    const stored = JSON.parse(window.localStorage.getItem(cartStorageKey(STORE_KEY)) ?? "{}");
    expect(stored.lines).toEqual([
      {
        slug: "bpc-157",
        name: "BPC-157",
        variantId: "var-1",
        variantLabel: "10mg",
        unitPriceCents: 4500,
        quantity: 1,
      },
    ]);
  });

  it("clicking twice merges into one line with quantity 2", async () => {
    render(
      <AddToCartButton
        storeKey={STORE_KEY}
        slug="bpc-157"
        name="BPC-157"
        variantId="var-1"
        variantLabel="10mg"
        unitPriceCents={4500}
      />,
    );
    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    fireEvent.click(screen.getByTestId("add-to-cart-button"));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(cartStorageKey(STORE_KEY)) ?? "{}");
      expect(stored.lines[0].quantity).toBe(2);
    });
  });
});
