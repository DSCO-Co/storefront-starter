import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CART_ACTIVITY_DEBOUNCE_MS,
  cartRefStorageKey,
  clearCartRef,
  getOrCreateCartRef,
  pingCartActivity,
  scheduleCartActivityPing,
} from "@/lib/cart-activity-client";

function grantConsentContext() {
  // Non-enforcing store: the layout did NOT stamp data-consent-required.
  delete document.body.dataset.consentRequired;
}

function enforceConsentWithoutGrant() {
  document.body.dataset.consentRequired = "1";
  // No fd_consent cookie — the visitor never granted.
  // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
  document.cookie = "fd_consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
}

beforeEach(() => {
  window.localStorage.clear();
  grantConsentContext();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getOrCreateCartRef", () => {
  it("mints once and returns the SAME ref until cleared (one row per cart server-side)", () => {
    const first = getOrCreateCartRef("store-a");
    expect(first).toMatch(/^cart_/);
    expect(getOrCreateCartRef("store-a")).toBe(first);
    // Namespaced per store — two stores never share a cart identity.
    expect(getOrCreateCartRef("store-b")).not.toBe(first);
    expect(window.localStorage.getItem(cartRefStorageKey("store-a"))).toBe(first);
  });

  it("clearCartRef retires the ref so the next cart is a new cart", () => {
    const first = getOrCreateCartRef("store-a");
    clearCartRef("store-a");
    expect(getOrCreateCartRef("store-a")).not.toBe(first);
  });
});

describe("pingCartActivity", () => {
  it("POSTs the ping, including the email only when known", async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    pingCartActivity({ cartRef: "cart_1", itemCount: 3 }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cart-activity");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ cartRef: "cart_1", itemCount: 3 });
    expect(body.email).toBeUndefined();

    pingCartActivity(
      { cartRef: "cart_1", itemCount: 3, email: " jane@a.test ", checkedOut: true },
      fetchFn,
    );
    const body2 = JSON.parse(String((fetchFn.mock.calls[1] as [string, RequestInit])[1].body));
    expect(body2).toEqual({
      cartRef: "cart_1",
      itemCount: 3,
      email: "jane@a.test",
      checkedOut: true,
    });
  });

  it("consent-absent on an enforcing store: NO round-trip at all (mirrors track.ts)", () => {
    enforceConsentWithoutGrant();
    const fetchFn = vi.fn().mockResolvedValue({});
    pingCartActivity({ cartRef: "cart_1", itemCount: 3, email: "jane@a.test" }, fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("never throws into the caller when the send fails", () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    expect(() => pingCartActivity({ cartRef: "cart_1", itemCount: 1 }, fetchFn)).not.toThrow();
  });
});

describe("scheduleCartActivityPing (debounce)", () => {
  it("collapses a burst of cart edits into ONE trailing ping with the latest count", () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue({});
    scheduleCartActivityPing("store-a", { cartRef: "cart_1", itemCount: 1 }, { fetchFn });
    scheduleCartActivityPing("store-a", { cartRef: "cart_1", itemCount: 2 }, { fetchFn });
    scheduleCartActivityPing("store-a", { cartRef: "cart_1", itemCount: 5 }, { fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CART_ACTIVITY_DEBOUNCE_MS);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchFn.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.itemCount).toBe(5);
  });

  it("debounces per store — two stores never coalesce", () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue({});
    scheduleCartActivityPing("store-a", { cartRef: "cart_a", itemCount: 1 }, { fetchFn });
    scheduleCartActivityPing("store-b", { cartRef: "cart_b", itemCount: 2 }, { fetchFn });
    vi.advanceTimersByTime(CART_ACTIVITY_DEBOUNCE_MS);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
