import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { cartStorageKey, lineKey } from "@/lib/cart";
import { useCart } from "@/lib/use-cart";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useCart", () => {
  it("starts empty, then hydrates from localStorage", async () => {
    window.localStorage.setItem(
      cartStorageKey("store-a"),
      JSON.stringify({
        lines: [
          {
            slug: "bpc-157",
            name: "BPC-157",
            variantLabel: "10mg",
            variantId: "var-1",
            unitPriceCents: 4500,
            quantity: 2,
          },
        ],
      }),
    );
    const { result } = renderHook(() => useCart("store-a"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.cart.lines).toHaveLength(1);
    expect(result.current.cart.lines[0]?.quantity).toBe(2);
  });

  it("add() merges and persists", async () => {
    const { result } = renderHook(() => useCart("store-a"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.add({
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
      });
    });
    act(() => {
      result.current.add({
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 2,
      });
    });

    expect(result.current.cart.lines).toHaveLength(1);
    expect(result.current.cart.lines[0]?.quantity).toBe(3);

    const persisted = JSON.parse(window.localStorage.getItem(cartStorageKey("store-a")) ?? "{}");
    expect(persisted.lines[0].quantity).toBe(3);
  });

  it("updateQuantity and remove operate on the live cart", async () => {
    const { result } = renderHook(() => useCart("store-a"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.add({
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
      });
    });
    const key = lineKey({ slug: "bpc-157", variantId: "var-1" });

    act(() => result.current.updateQuantity(key, 5));
    expect(result.current.cart.lines[0]?.quantity).toBe(5);

    act(() => result.current.remove(key));
    expect(result.current.cart.lines).toHaveLength(0);
  });

  it("clear() empties the cart and the storage entry", async () => {
    const { result } = renderHook(() => useCart("store-a"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.add({
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
      });
    });
    act(() => result.current.clear());
    expect(result.current.cart.lines).toHaveLength(0);
    expect(window.localStorage.getItem(cartStorageKey("store-a"))).toBeNull();
  });

  it("namespaces per storeKey — two stores never see each other's cart", async () => {
    const a = renderHook(() => useCart("store-a"));
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    act(() => {
      a.result.current.add({
        slug: "bpc-157",
        name: "BPC-157",
        variantLabel: "10mg",
        variantId: "var-1",
        unitPriceCents: 4500,
        quantity: 1,
      });
    });

    const b = renderHook(() => useCart("store-b"));
    await waitFor(() => expect(b.result.current.hydrated).toBe(true));
    expect(b.result.current.cart.lines).toHaveLength(0);
  });
});
