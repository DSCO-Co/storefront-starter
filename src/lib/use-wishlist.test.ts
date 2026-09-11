import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWishlist } from "@/lib/use-wishlist";
import { wishlistStorageKey } from "@/lib/wishlist";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useWishlist — guest (localStorage)", () => {
  it("hydrates from localStorage", async () => {
    window.localStorage.setItem(
      wishlistStorageKey("store-a"),
      JSON.stringify({ refs: ["bpc-157"] }),
    );
    const { result } = renderHook(() => useWishlist("store-a", { enabled: true, signedIn: false }));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.isSaved("bpc-157")).toBe(true);
  });

  it("toggle adds then removes, persisting each time", async () => {
    const { result } = renderHook(() => useWishlist("store-a", { enabled: true, signedIn: false }));
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.toggle("tb-500"));
    expect(result.current.isSaved("tb-500")).toBe(true);
    expect(
      JSON.parse(window.localStorage.getItem(wishlistStorageKey("store-a")) ?? "{}").refs,
    ).toEqual(["tb-500"]);

    act(() => result.current.toggle("tb-500"));
    expect(result.current.isSaved("tb-500")).toBe(false);
    expect(
      JSON.parse(window.localStorage.getItem(wishlistStorageKey("store-a")) ?? "{}").refs,
    ).toEqual([]);
  });

  it("namespaces per storeKey — two stores never see each other's saves", async () => {
    const a = renderHook(() => useWishlist("store-a", { enabled: true, signedIn: false }));
    await waitFor(() => expect(a.result.current.hydrated).toBe(true));
    act(() => a.result.current.toggle("x"));

    const b = renderHook(() => useWishlist("store-b", { enabled: true, signedIn: false }));
    await waitFor(() => expect(b.result.current.hydrated).toBe(true));
    expect(b.result.current.isSaved("x")).toBe(false);
  });

  it("is inert when disabled — toggle is a no-op, nothing persists", async () => {
    const { result } = renderHook(() =>
      useWishlist("store-a", { enabled: false, signedIn: false }),
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.toggle("x"));
    expect(result.current.isSaved("x")).toBe(false);
    expect(window.localStorage.getItem(wishlistStorageKey("store-a"))).toBeNull();
  });
});

describe("useWishlist — merge on auth", () => {
  it("folds the guest localStorage wishlist into the server list, then clears local", async () => {
    window.localStorage.setItem(
      wishlistStorageKey("store-a"),
      JSON.stringify({ refs: ["guest-only"] }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      expect(String(input)).toBe("/api/wishlist/merge");
      // Server returns the union (guest ref + a ref saved on another device).
      return new Response(
        JSON.stringify({ items: [{ productRef: "guest-only" }, { productRef: "server-b" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWishlist("store-a", { enabled: true, signedIn: true }));

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    // Server list is now the source of truth.
    expect(result.current.isSaved("guest-only")).toBe(true);
    expect(result.current.isSaved("server-b")).toBe(true);
    expect(result.current.loadError).toBe(false);
    // The merge posted the guest ref.
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body.refs).toEqual(["guest-only"]);
    // Guest copy dropped so it can't re-merge onto a different account later.
    expect(window.localStorage.getItem(wishlistStorageKey("store-a"))).toBeNull();
  });

  it("honest absence — a failed merge surfaces loadError, never an empty wishlist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 502 })),
    );
    const { result } = renderHook(() => useWishlist("store-a", { enabled: true, signedIn: true }));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.loadError).toBe(true);
    expect(result.current.refs).toEqual([]);
  });
});
