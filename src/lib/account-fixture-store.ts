import { randomUUID } from "node:crypto";
import type {
  Address,
  AddressInput,
  ExchangedShopper,
  OrderDetail,
  OrderSummary,
  ReturnLineInput,
  ReturnSummary,
  SavedCard,
  ShopperIdentity,
} from "@/lib/account-client";

/** Card fields entered at "add a card" (dev/test only — no real vault). */
export interface FixtureCardInput {
  readonly ccnumber: string;
  readonly ccexp: string;
}

/** PCI-safe display summary from a fixture card — never stores the PAN. */
function fixtureCardSummary(card: FixtureCardInput): {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
} {
  const digits = card.ccnumber.replace(/\D/g, "");
  const brand = digits.startsWith("4")
    ? "visa"
    : /^5[1-5]/.test(digits)
      ? "mastercard"
      : /^3[47]/.test(digits)
        ? "amex"
        : null;
  const exp = card.ccexp.replace(/\D/g, "");
  const expMonth = exp.length === 4 ? Number(exp.slice(0, 2)) : null;
  const expYear = exp.length === 4 ? 2000 + Number(exp.slice(2, 4)) : null;
  return {
    brand,
    last4: digits.length >= 4 ? digits.slice(-4) : null,
    expMonth,
    expYear,
  };
}

/**
 * In-memory backing store for `FixtureAccountClient` — the shopper-account
 * analog of the other fixture sources in this surface (`FixtureManifestSource`,
 * `FixtureCheckoutGateway`). Process-lifetime, no DB, no network, so
 * `pnpm dev`/`pnpm test` exercise the whole account flow with no running
 * flightdeck app.
 *
 * A new fixture shopper is SEEDED with one demo order so the order-history,
 * order-detail, and reorder surfaces are demonstrable in dev. This is fixture
 * data by construction (only ever reachable when `FLIGHTDECK_API_URL` is
 * unset) — never presented as, or mistaken for, a live order.
 */

interface PendingLogin {
  readonly tenantRef: string;
  readonly personId: string;
}

interface Person {
  readonly id: string;
  readonly tenantRef: string;
  readonly email: string;
  readonly name: string | null;
}

export interface FixtureAccountStore {
  requestLogin(tenantRef: string, email: string): string;
  exchange(token: string): ExchangedShopper | null;
  verify(secret: string): ShopperIdentity | null;
  logout(secret: string): void;
  listOrders(personId: string): OrderSummary[];
  getOrder(personId: string, orderId: string): OrderDetail | null;
  listAddresses(personId: string): Address[];
  upsertAddress(personId: string, input: AddressInput): Address;
  deleteAddress(personId: string, addressId: string): void;
  listReturns(personId: string): ReturnSummary[];
  /** Returns the created summary, or a string refusal reason (mirrors the backend's honest 4xx). */
  createReturn(
    personId: string,
    orderId: string,
    reason: string | null,
    lines: ReturnLineInput[],
  ): ReturnSummary | string;
  listCards(personId: string): SavedCard[];
  vaultCard(personId: string, card: FixtureCardInput): SavedCard;
  listWishlist(personId: string): string[];
  addWishlistItem(personId: string, ref: string): void;
  removeWishlistItem(personId: string, ref: string): boolean;
  mergeWishlist(personId: string, refs: readonly string[]): string[];
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export function createFixtureAccountStore(): FixtureAccountStore {
  const personsByKey = new Map<string, Person>(); // `${tenant}:${email}` -> person
  const personsById = new Map<string, Person>();
  const pendingByToken = new Map<string, PendingLogin>();
  const identityBySecret = new Map<string, ShopperIdentity>();
  const ordersByPerson = new Map<string, OrderDetail[]>();
  const addressesByPerson = new Map<string, Address[]>();
  const cardsByPerson = new Map<string, SavedCard[]>();
  const returnsByPerson = new Map<string, ReturnSummary[]>();
  const wishlistByPerson = new Map<string, string[]>(); // refs, newest first

  function ensurePerson(tenantRef: string, email: string): Person {
    const key = `${tenantRef}:${normalize(email)}`;
    const existing = personsByKey.get(key);
    if (existing) return existing;
    const person: Person = {
      id: randomUUID(),
      tenantRef,
      email: email.trim(),
      name: null,
    };
    personsByKey.set(key, person);
    personsById.set(person.id, person);
    seedDemoOrder(person.id);
    return person;
  }

  function seedDemoOrder(personId: string): void {
    const order: OrderDetail = {
      id: `fixture-order-${personId.slice(0, 8)}`,
      orderNumber: 1000,
      status: "placed",
      totalCents: 12900,
      currency: "usd",
      couponCode: null,
      subtotalCents: 12900,
      discountCents: 0,
      items: [
        {
          id: `fixture-item-${personId.slice(0, 8)}`,
          productName: "Demo Peptide 10mg",
          sku: "DEMO-PEP-10",
          variantId: "DEMO-PEP-10",
          quantity: 1,
          unitPriceCents: 12900,
          lineTotalCents: 12900,
        },
      ],
    };
    ordersByPerson.set(personId, [order]);
  }

  return {
    requestLogin(tenantRef, email) {
      const person = ensurePerson(tenantRef, email);
      const token = `shlt_fixture_${randomUUID().replace(/-/g, "")}`;
      pendingByToken.set(token, { tenantRef, personId: person.id });
      return token;
    },

    exchange(token) {
      const pending = pendingByToken.get(token);
      if (!pending) return null;
      pendingByToken.delete(token); // single-use, like the real burn
      const person = personsById.get(pending.personId);
      if (!person) return null;
      const secret = `shsess_fixture_${randomUUID().replace(/-/g, "")}`;
      const identity: ShopperIdentity = {
        personId: person.id,
        tenantRef: person.tenantRef,
        email: person.email,
        name: person.name,
      };
      identityBySecret.set(secret, identity);
      return { ...identity, sessionSecret: secret };
    },

    verify(secret) {
      return identityBySecret.get(secret) ?? null;
    },

    logout(secret) {
      identityBySecret.delete(secret);
    },

    listOrders(personId) {
      return (ordersByPerson.get(personId) ?? []).map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        totalCents: o.totalCents,
        currency: o.currency,
        couponCode: o.couponCode,
      }));
    },

    getOrder(personId, orderId) {
      return (ordersByPerson.get(personId) ?? []).find((o) => o.id === orderId) ?? null;
    },

    listAddresses(personId) {
      return addressesByPerson.get(personId) ?? [];
    },

    upsertAddress(personId, input) {
      const list = addressesByPerson.get(personId) ?? [];
      const normalizedDefault = input.isDefault === true;
      // Match the real repo's (person, label) upsert key.
      const existing = list.find((a) => a.label === input.label);
      const address: Address = {
        id: existing ? existing.id : randomUUID(),
        label: input.label,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: input.country,
        isDefault: normalizedDefault,
      };
      let next = existing
        ? list.map((a) => (a.label === address.label ? address : a))
        : [...list, address];
      if (normalizedDefault) {
        next = next.map((a) => (a.id === address.id ? a : { ...a, isDefault: false }));
      }
      addressesByPerson.set(personId, next);
      return address;
    },

    deleteAddress(personId, addressId) {
      const list = addressesByPerson.get(personId) ?? [];
      addressesByPerson.set(
        personId,
        list.filter((a) => a.id !== addressId),
      );
    },

    listReturns(personId) {
      return [...(returnsByPerson.get(personId) ?? [])];
    },

    createReturn(personId, orderId, reason, lines) {
      // Mirror the backend's honest refusals: real order, real lines,
      // quantity within what was ordered.
      const order = (ordersByPerson.get(personId) ?? []).find((o) => o.id === orderId);
      if (order === undefined) return "no such order for this shopper";
      if (lines.length === 0) return "a return must name at least one line";
      const itemsById = new Map(order.items.map((i) => [i.id, i]));
      for (const line of lines) {
        const item = itemsById.get(line.orderItemId);
        if (item === undefined) return `no such order item: ${line.orderItemId}`;
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
          return "each return line needs a positive integer quantity";
        }
        if (line.quantity > item.quantity) {
          return `cannot return ${line.quantity} of order item ${line.orderItemId}; only ${item.quantity} ordered`;
        }
      }
      const created: ReturnSummary = {
        id: randomUUID(),
        orderId,
        status: "requested",
        reason,
        refundedCents: 0,
      };
      returnsByPerson.set(personId, [created, ...(returnsByPerson.get(personId) ?? [])]);
      return created;
    },

    listCards(personId) {
      return cardsByPerson.get(personId) ?? [];
    },

    vaultCard(personId, card) {
      const list = cardsByPerson.get(personId) ?? [];
      const summary = fixtureCardSummary(card);
      const saved: SavedCard = {
        id: randomUUID(),
        brand: summary.brand,
        last4: summary.last4,
        expMonth: summary.expMonth,
        expYear: summary.expYear,
        // First card vaulted is the default (mirrors the repo's insert rule).
        isDefault: list.length === 0,
      };
      cardsByPerson.set(personId, [...list, saved]);
      return saved;
    },

    listWishlist(personId) {
      return [...(wishlistByPerson.get(personId) ?? [])];
    },

    addWishlistItem(personId, ref) {
      const cur = wishlistByPerson.get(personId) ?? [];
      if (!cur.includes(ref)) wishlistByPerson.set(personId, [ref, ...cur]);
    },

    removeWishlistItem(personId, ref) {
      const cur = wishlistByPerson.get(personId) ?? [];
      if (!cur.includes(ref)) return false;
      wishlistByPerson.set(
        personId,
        cur.filter((r) => r !== ref),
      );
      return true;
    },

    mergeWishlist(personId, refs) {
      let cur = wishlistByPerson.get(personId) ?? [];
      for (const ref of refs) if (!cur.includes(ref)) cur = [ref, ...cur];
      wishlistByPerson.set(personId, cur);
      return [...cur];
    },
  };
}
