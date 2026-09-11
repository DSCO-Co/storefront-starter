import { describe, expect, it } from "vitest";
import { createFixtureAccountStore } from "@/lib/account-fixture-store";

/**
 * The fixture store must ISOLATE shoppers exactly as the live backend does —
 * one shopper never sees another's orders or addresses. This is the
 * storefront-layer analog of the app's `account-ownership.integration.test.ts`
 * (which proves the same against real Postgres), runnable without Docker.
 */
describe("fixture account store — shopper isolation", () => {
  function signIn(store: ReturnType<typeof createFixtureAccountStore>, email: string) {
    const token = store.requestLogin("acme", email);
    const exchanged = store.exchange(token);
    if (exchanged === null) throw new Error("exchange failed");
    return exchanged;
  }

  it("a session verifies to its own person and a bad secret is null", () => {
    const store = createFixtureAccountStore();
    const alice = signIn(store, "alice@example.com");
    expect(store.verify(alice.sessionSecret)?.personId).toBe(alice.personId);
    expect(store.verify("shsess_not_a_real_secret")).toBeNull();
  });

  it("a token is single-use (a second exchange returns null)", () => {
    const store = createFixtureAccountStore();
    const token = store.requestLogin("acme", "alice@example.com");
    expect(store.exchange(token)).not.toBeNull();
    expect(store.exchange(token)).toBeNull();
  });

  it("shopper A cannot see shopper B's addresses", () => {
    const store = createFixtureAccountStore();
    const alice = signIn(store, "alice@example.com");
    const bob = signIn(store, "bob@example.com");
    expect(alice.personId).not.toBe(bob.personId);

    store.upsertAddress(alice.personId, {
      label: "Home",
      line1: "1 Alice Way",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US",
    });

    expect(store.listAddresses(alice.personId)).toHaveLength(1);
    expect(store.listAddresses(bob.personId)).toHaveLength(0);
  });

  it("each shopper's seeded order belongs only to them", () => {
    const store = createFixtureAccountStore();
    const alice = signIn(store, "alice@example.com");
    const bob = signIn(store, "bob@example.com");

    const aliceOrders = store.listOrders(alice.personId);
    const bobOrders = store.listOrders(bob.personId);
    expect(aliceOrders).toHaveLength(1);
    expect(bobOrders).toHaveLength(1);
    const aliceOrder = aliceOrders[0];
    if (aliceOrder === undefined) throw new Error("expected an order");
    // A's order id must not resolve under B and vice-versa.
    expect(store.getOrder(bob.personId, aliceOrder.id)).toBeNull();
    expect(store.getOrder(alice.personId, aliceOrder.id)).not.toBeNull();
  });

  it("setting a new default address unsets the previous default", () => {
    const store = createFixtureAccountStore();
    const alice = signIn(store, "alice@example.com");
    const base = { line1: "x", city: "c", state: "s", postalCode: "p", country: "US" };
    store.upsertAddress(alice.personId, { label: "Home", ...base, isDefault: true });
    store.upsertAddress(alice.personId, { label: "Work", ...base, isDefault: true });
    const defaults = store.listAddresses(alice.personId).filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.label).toBe("Work");
  });

  // SEAM 2a: a vaulted card round-trips (add → readable at /account/payment),
  // is PCI-safe (last4/brand only), the first is default, and is per-shopper.
  it("vaults a card and reads it back, PCI-safe and scoped to the shopper", () => {
    const store = createFixtureAccountStore();
    const alice = signIn(store, "alice@example.com");
    const bob = signIn(store, "bob@example.com");
    expect(store.listCards(alice.personId)).toHaveLength(0);

    const saved = store.vaultCard(alice.personId, { ccnumber: "4111111111111111", ccexp: "0129" });
    expect(saved.brand).toBe("visa");
    expect(saved.last4).toBe("1111");
    expect(saved.isDefault).toBe(true);
    // No PAN is ever stored on the summary.
    expect(JSON.stringify(saved)).not.toContain("4111111111111111");

    const aliceCards = store.listCards(alice.personId);
    expect(aliceCards).toHaveLength(1);
    expect(aliceCards[0]?.id).toBe(saved.id);
    // Bob never sees Alice's card.
    expect(store.listCards(bob.personId)).toHaveLength(0);

    // A second card does not steal the default.
    const second = store.vaultCard(alice.personId, { ccnumber: "5555555555554444", ccexp: "0230" });
    expect(second.brand).toBe("mastercard");
    expect(second.isDefault).toBe(false);
    expect(store.listCards(alice.personId)).toHaveLength(2);
  });
});

describe("fixture account store — returns (FD Epic 12 shopper RMA)", () => {
  function signIn(store: ReturnType<typeof createFixtureAccountStore>, email: string) {
    const token = store.requestLogin("acme", email);
    const exchanged = store.exchange(token);
    if (exchanged === null) throw new Error("exchange failed");
    return exchanged;
  }

  it("starts a return against an owned order's line and lists it as 'requested'", () => {
    const store = createFixtureAccountStore();
    const alice = signIn(store, "alice@example.com");
    const [order] = store.listOrders(alice.personId);
    if (!order) throw new Error("seeded order missing");
    const detail = store.getOrder(alice.personId, order.id);
    const item = detail?.items[0];
    if (!item) throw new Error("seeded item missing");

    const created = store.createReturn(alice.personId, order.id, "damaged vial", [
      { orderItemId: item.id, quantity: 1 },
    ]);
    expect(typeof created).not.toBe("string");
    if (typeof created === "string") return;
    expect(created.status).toBe("requested");
    expect(created.orderId).toBe(order.id);

    const listed = store.listReturns(alice.personId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.reason).toBe("damaged vial");
  });

  it("refuses honestly: unknown order, unknown line, quantity over what was ordered, empty lines", () => {
    const store = createFixtureAccountStore();
    const alice = signIn(store, "alice@example.com");
    const [order] = store.listOrders(alice.personId);
    const item = store.getOrder(alice.personId, order?.id ?? "")?.items[0];
    if (!order || !item) throw new Error("seed missing");

    expect(store.createReturn(alice.personId, "ghost-order", null, [])).toMatch(/no such order/);
    expect(
      store.createReturn(alice.personId, order.id, null, [
        { orderItemId: "ghost-item", quantity: 1 },
      ]),
    ).toMatch(/no such order item/);
    expect(
      store.createReturn(alice.personId, order.id, null, [
        { orderItemId: item.id, quantity: item.quantity + 5 },
      ]),
    ).toMatch(/only \d+ ordered/);
    expect(store.createReturn(alice.personId, order.id, null, [])).toMatch(/at least one line/);
  });

  it("shopper A can never open a return against shopper B's order (same 'no such order' as the backend)", () => {
    const store = createFixtureAccountStore();
    const alice = signIn(store, "alice@example.com");
    const bob = signIn(store, "bob@example.com");
    const [bobOrder] = store.listOrders(bob.personId);
    if (!bobOrder) throw new Error("seed missing");

    const refused = store.createReturn(alice.personId, bobOrder.id, null, [
      { orderItemId: "any", quantity: 1 },
    ]);
    expect(refused).toMatch(/no such order/);
    expect(store.listReturns(bob.personId)).toHaveLength(0);
  });
});
