import { beforeEach, describe, expect, it } from "vitest";
import {
  addLine,
  type Cart,
  type CartLine,
  cartItemCount,
  cartStorageKey,
  cartTotalCents,
  clearCart,
  EMPTY_CART,
  lineKey,
  lineTotalCents,
  loadCart,
  removeLine,
  saveCart,
  setLineQuantity,
} from "@/lib/cart";

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    slug: "bpc-157",
    name: "BPC-157",
    variantLabel: "10mg",
    variantId: "var-1",
    unitPriceCents: 4500,
    quantity: 1,
    ...overrides,
  };
}

describe("cart namespacing", () => {
  it("scopes the storage key per store", () => {
    expect(cartStorageKey("bio-archetype")).toBe("fd_cart:bio-archetype");
    expect(cartStorageKey("leo-research")).not.toBe(cartStorageKey("bio-archetype"));
  });
});

describe("addLine / lineKey", () => {
  it("adds a new line", () => {
    const cart = addLine(EMPTY_CART, line());
    expect(cart.lines).toHaveLength(1);
  });

  it("merges quantity for the same slug+variantId", () => {
    const cart = addLine(addLine(EMPTY_CART, line({ quantity: 2 })), line({ quantity: 3 }));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(5);
  });

  it("keeps two different variants of the same product as separate lines", () => {
    const cart = addLine(
      addLine(EMPTY_CART, line({ variantId: "var-1" })),
      line({ variantId: "var-2" }),
    );
    expect(cart.lines).toHaveLength(2);
  });
});

describe("setLineQuantity / removeLine", () => {
  it("updates quantity", () => {
    const cart = addLine(EMPTY_CART, line());
    const key = lineKey(cart.lines[0] as CartLine);
    const updated = setLineQuantity(cart, key, 5);
    expect(updated.lines[0]?.quantity).toBe(5);
  });

  it("qty <= 0 removes the line", () => {
    const cart = addLine(EMPTY_CART, line());
    const key = lineKey(cart.lines[0] as CartLine);
    expect(setLineQuantity(cart, key, 0).lines).toHaveLength(0);
  });

  it("removeLine drops exactly the matching line", () => {
    const cart = addLine(
      addLine(EMPTY_CART, line({ variantId: "var-1" })),
      line({ variantId: "var-2" }),
    );
    const removed = removeLine(cart, lineKey({ slug: "bpc-157", variantId: "var-1" }));
    expect(removed.lines).toHaveLength(1);
    expect(removed.lines[0]?.variantId).toBe("var-2");
  });
});

describe("totals", () => {
  it("computes line and cart totals in integer cents", () => {
    const cart: Cart = {
      lines: [
        line({ unitPriceCents: 4500, quantity: 2 }),
        line({ variantId: "var-2", unitPriceCents: 3000, quantity: 1 }),
      ],
    };
    expect(lineTotalCents(cart.lines[0] as CartLine)).toBe(9000);
    expect(cartTotalCents(cart)).toBe(12000);
    expect(cartItemCount(cart)).toBe(3);
  });
});

describe("persistence", () => {
  class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
    private store = new Map<string, string>();
    getItem(key: string) {
      return this.store.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.store.set(key, value);
    }
    removeItem(key: string) {
      this.store.delete(key);
    }
  }

  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("round-trips a saved cart", () => {
    const cart = addLine(EMPTY_CART, line());
    saveCart("bio-archetype", cart, storage);
    expect(loadCart("bio-archetype", storage)).toEqual(cart);
  });

  it("a different storeKey never sees another store's cart", () => {
    saveCart("bio-archetype", addLine(EMPTY_CART, line()), storage);
    expect(loadCart("leo-research", storage)).toEqual(EMPTY_CART);
  });

  it("returns EMPTY_CART for a corrupt/foreign payload rather than throwing", () => {
    storage.setItem(cartStorageKey("bio-archetype"), "{not json");
    expect(loadCart("bio-archetype", storage)).toEqual(EMPTY_CART);
  });

  it("clearCart removes the stored entry", () => {
    saveCart("bio-archetype", addLine(EMPTY_CART, line()), storage);
    clearCart("bio-archetype", storage);
    expect(loadCart("bio-archetype", storage)).toEqual(EMPTY_CART);
  });

  it("loadCart with no window/storage returns EMPTY_CART", () => {
    expect(loadCart("bio-archetype", null)).toEqual(EMPTY_CART);
  });
});
