import { createLogger } from "@/lib/logger";

/**
 * The ONLY place the storefront talks to the shopper-account backend
 * (persons' shopper-login/address routes, commerce's shopper order-history,
 * payments' cards-on-file) — same discipline as `checkout.ts` and the
 * portal's `identity-client.ts`: never a bespoke `fetch()` from a page, never
 * a DB connection, never a module import. Selection mirrors every other
 * live/fixture seam here: `FLIGHTDECK_API_URL` set -> live HTTP; unset (local
 * dev / tests) -> an in-memory fixture, so `pnpm dev`/`pnpm test` need no
 * running flightdeck app or comms send path. LOO-3041.
 *
 * HONEST-ABSENCE (root CLAUDE.md): every read returns a `Result`. `ok: false`
 * means the check itself could not be completed (a 503 / network error) — the
 * caller renders "we couldn't load this", NEVER "you have none". Only an
 * `ok: true` empty array is a real, verified "none".
 */

const logger = createLogger("account-client");

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

export interface ShopperIdentity {
  readonly personId: string;
  readonly tenantRef: string;
  readonly email: string;
  readonly name: string | null;
}

export interface ExchangedShopper extends ShopperIdentity {
  readonly sessionSecret: string;
}

export interface OrderSummary {
  readonly id: string;
  readonly orderNumber: number;
  readonly status: string;
  readonly totalCents: number;
  readonly currency: string;
  readonly couponCode: string | null;
}

export interface OrderItem {
  /** The commerce order-item id — the key a return line names (FD Epic 12). */
  readonly id: string;
  readonly productName: string;
  readonly sku: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

export interface OrderDetail extends OrderSummary {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly items: readonly OrderItem[];
}

export interface Address {
  readonly id: string;
  readonly label: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
  readonly isDefault: boolean;
}

export interface AddressInput {
  readonly label: string;
  readonly line1: string;
  readonly line2?: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
  readonly isDefault?: boolean;
}

export interface SavedCard {
  readonly id: string;
  readonly brand: string | null;
  readonly last4: string | null;
  readonly expMonth: number | null;
  readonly expYear: number | null;
  readonly isDefault: boolean;
}

/** One shopper return (RMA), as the checkout module's shopper surface reports it. */
export interface ReturnSummary {
  readonly id: string;
  readonly orderId: string;
  readonly status: string;
  readonly reason: string | null;
  readonly refundedCents: number;
}

export interface ReturnLineInput {
  readonly orderItemId: string;
  readonly quantity: number;
}

export interface SubscriptionSummary {
  readonly id: string;
  readonly planRef: string;
  readonly status: "active" | "past_due" | "paused" | "canceled";
  readonly interval: "day" | "week" | "month" | "year";
  readonly intervalCount: number;
  readonly unitPriceCents: number;
  readonly currency: string;
  readonly nextBillAt: string;
  readonly failureCount: number;
}

export interface AccountClient {
  requestLogin(input: {
    tenantRef: string;
    email: string;
    signInBaseUrl: string;
    /** The shopper's real IP, forwarded so persons can throttle per client (security #10). */
    clientIp?: string | null;
  }): Promise<Result<{ devToken?: string }>>;
  /** `ok: true, value: null` means a real 401 — the link is invalid/expired/used. */
  exchangeToken(token: string, clientIp?: string | null): Promise<Result<ExchangedShopper | null>>;
  verifySession(secret: string): Promise<Result<ShopperIdentity | null>>;
  logout(secret: string): Promise<Result<void>>;
  listOrders(input: { tenantRef: string; personId: string }): Promise<Result<OrderSummary[]>>;
  getOrder(input: {
    tenantRef: string;
    personId: string;
    orderId: string;
  }): Promise<Result<OrderDetail | null>>;
  listAddresses(secret: string): Promise<Result<Address[]>>;
  upsertAddress(secret: string, input: AddressInput): Promise<Result<Address>>;
  deleteAddress(secret: string, addressId: string): Promise<Result<void>>;
  /**
   * Shopper wishlist (LOO-3138) — Bearer-scoped to the session's person (the
   * same person-from-session ownership as the address book). Refs are the
   * catalog slugs the shopper saved; the caller hydrates product details from
   * the catalog. Every read returns a `Result`: `ok: false` means the check
   * failed (never "empty wishlist").
   */
  listWishlist(secret: string): Promise<Result<string[]>>;
  addWishlistItem(secret: string, ref: string): Promise<Result<void>>;
  removeWishlistItem(secret: string, ref: string): Promise<Result<{ removed: boolean }>>;
  /** Union the guest refs into the server wishlist (idempotent) and return the full list. */
  mergeWishlist(secret: string, refs: readonly string[]): Promise<Result<string[]>>;
  /**
   * Shopper returns (FD Epic 12, `/account/returns`). Person-scoped exactly
   * like `listOrders`: the person id comes from the server-verified session,
   * and the backend's query is strictly (tenant, person). A failed read is
   * `ok: false` (rendered "we couldn't load"), never "no returns".
   */
  listReturns(input: { tenantRef: string; personId: string }): Promise<Result<ReturnSummary[]>>;
  /**
   * Start a return against ONE of the shopper's own orders. The backend
   * re-asserts ownership (order must belong to this person) and validates
   * every line (real order item, quantity ≤ ordered) — refusals surface the
   * backend's reason verbatim.
   */
  createReturn(input: {
    tenantRef: string;
    personId: string;
    orderId: string;
    reason: string | null;
    lines: readonly ReturnLineInput[];
  }): Promise<Result<ReturnSummary>>;
  listCards(input: { tenantRef: string; personId: string }): Promise<Result<SavedCard[]>>;
  listSubscriptions(input: {
    tenantRef: string;
    personId: string;
  }): Promise<Result<SubscriptionSummary[]>>;
  cancelSubscription(input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>>;
  pauseSubscription(input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>>;
  /**
   * Resume a PAUSED subscription (C4, consumer-compliance remediation
   * 2026-09-09). Mirrors cancel/pause exactly: `POST …/subscriptions/:id/
   * resume`, ownership asserted in SQL server-side (404 on not-yours).
   */
  resumeSubscription(input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>>;
  /**
   * Vault a NEW card on file (LOO-3041). The PAN leaves the browser only to
   * THIS server surface (a server action / Route Handler), which forwards to
   * payments' `vaultCard` route — the same platform-served boundary as
   * checkout. Returns the stored PCI-safe summary (never a PAN).
   */
  vaultCard(input: {
    tenantRef: string;
    personId: string;
    card: { ccnumber: string; ccexp: string; cvv?: string };
    idempotencyKey: string;
  }): Promise<Result<SavedCard>>;
}

type ApiError = { error?: { code?: string; message?: string } };

// ── Live client ────────────────────────────────────────────────────────────

export class LiveAccountClient implements AccountClient {
  constructor(
    private readonly apiBaseUrl: string,
    /** The narrow storefront credential (checkout.ts's `FLIGHTDECK_STOREFRONT_TOKEN`) — commerce/payments reads only. */
    private readonly storefrontToken: string | undefined,
  ) {}

  private async json(
    path: string,
    init: RequestInit,
  ): Promise<{ status: number; body: unknown } | null> {
    try {
      const res = await fetch(`${this.apiBaseUrl}${path}`, { ...init, cache: "no-store" });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    } catch (error) {
      logger.error("account request failed", { path, error });
      return null;
    }
  }

  private requireStorefrontToken(): string | null {
    if (this.storefrontToken === undefined) {
      logger.error("FLIGHTDECK_STOREFRONT_TOKEN unset — cannot read shopper orders/cards");
      return null;
    }
    return this.storefrontToken;
  }

  /**
   * Headers the shopper-login routes now require (security #10): the narrow
   * storefront credential authenticates the BFF so persons will accept the
   * request AND trust the forwarded shopper IP; the IP itself drives the
   * per-client throttle. The token is included only when configured — an
   * unconfigured dev BFF talks to an unconfigured (still-open) persons.
   */
  private loginHeaders(clientIp?: string | null): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.storefrontToken !== undefined) h["x-storefront-token"] = this.storefrontToken;
    if (clientIp) h["x-flightdeck-client-ip"] = clientIp;
    return h;
  }

  async requestLogin(input: {
    tenantRef: string;
    email: string;
    signInBaseUrl: string;
    clientIp?: string | null;
  }): Promise<Result<{ devToken?: string }>> {
    const res = await this.json("/persons/v1/shopper-login/request", {
      method: "POST",
      headers: { "content-type": "application/json", ...this.loginHeaders(input.clientIp) },
      body: JSON.stringify({
        tenant_ref: input.tenantRef,
        email: input.email,
        sign_in_base_url: input.signInBaseUrl,
      }),
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status !== 202) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "login request failed");
    }
    const devToken = (res.body as { devToken?: string })?.devToken;
    return ok(devToken !== undefined ? { devToken } : {});
  }

  async exchangeToken(
    token: string,
    clientIp?: string | null,
  ): Promise<Result<ExchangedShopper | null>> {
    const res = await this.json("/persons/v1/shopper-login/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", ...this.loginHeaders(clientIp) },
      body: JSON.stringify({ token }),
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status === 401) return ok(null);
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "token exchange failed");
    }
    const body = res.body as {
      sessionSecret: string;
      tenantRef: string;
      person: { id: string; email: string; name: string | null };
    };
    return ok({
      sessionSecret: body.sessionSecret,
      tenantRef: body.tenantRef,
      personId: body.person.id,
      email: body.person.email,
      name: body.person.name,
    });
  }

  async verifySession(secret: string): Promise<Result<ShopperIdentity | null>> {
    const res = await this.json("/persons/v1/shopper-sessions/verify", {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status === 401) return ok(null);
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "session verify failed");
    }
    const body = res.body as {
      personId: string;
      tenantRef: string;
      email: string;
      name: string | null;
    };
    return ok(body);
  }

  async logout(secret: string): Promise<Result<void>> {
    const res = await this.json("/persons/v1/shopper-login/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, ...this.loginHeaders() },
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    return ok(undefined);
  }

  async listOrders(input: {
    tenantRef: string;
    personId: string;
  }): Promise<Result<OrderSummary[]>> {
    const token = this.requireStorefrontToken();
    if (token === null) return fail("misconfigured", "storefront token not configured");
    const res = await this.json(
      `/commerce/v1/tenants/${encodeURIComponent(input.tenantRef)}/shopper/orders?person_id=${encodeURIComponent(input.personId)}`,
      { method: "GET", headers: { "x-storefront-token": token } },
    );
    if (res === null) return fail("network_error", "could not reach the order service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "order list failed");
    }
    return ok(((res.body as { orders?: unknown[] })?.orders ?? []).map(toOrderSummary));
  }

  async getOrder(input: {
    tenantRef: string;
    personId: string;
    orderId: string;
  }): Promise<Result<OrderDetail | null>> {
    const token = this.requireStorefrontToken();
    if (token === null) return fail("misconfigured", "storefront token not configured");
    const res = await this.json(
      `/commerce/v1/tenants/${encodeURIComponent(input.tenantRef)}/shopper/orders/${encodeURIComponent(input.orderId)}?person_id=${encodeURIComponent(input.personId)}`,
      { method: "GET", headers: { "x-storefront-token": token } },
    );
    if (res === null) return fail("network_error", "could not reach the order service");
    if (res.status === 404) return ok(null);
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "order lookup failed");
    }
    const body = res.body as { order: RawOrder; items: RawOrderItem[] };
    return ok(toOrderDetail(body.order, body.items));
  }

  async listReturns(input: {
    tenantRef: string;
    personId: string;
  }): Promise<Result<ReturnSummary[]>> {
    const token = this.requireStorefrontToken();
    if (token === null) return fail("misconfigured", "storefront token not configured");
    const res = await this.json(
      `/checkout/v1/tenants/${encodeURIComponent(input.tenantRef)}/shopper/returns?person_id=${encodeURIComponent(input.personId)}`,
      { method: "GET", headers: { "x-storefront-token": token } },
    );
    if (res === null) return fail("network_error", "could not reach the returns service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "return list failed");
    }
    return ok(((res.body as { returns?: unknown[] })?.returns ?? []).map(toReturnSummary));
  }

  async createReturn(input: {
    tenantRef: string;
    personId: string;
    orderId: string;
    reason: string | null;
    lines: readonly ReturnLineInput[];
  }): Promise<Result<ReturnSummary>> {
    const token = this.requireStorefrontToken();
    if (token === null) return fail("misconfigured", "storefront token not configured");
    const res = await this.json(
      `/checkout/v1/tenants/${encodeURIComponent(input.tenantRef)}/shopper/returns`,
      {
        method: "POST",
        headers: { "x-storefront-token": token, "content-type": "application/json" },
        body: JSON.stringify({
          order_id: input.orderId,
          person_id: input.personId,
          reason: input.reason,
          lines: input.lines.map((l) => ({ order_item_id: l.orderItemId, quantity: l.quantity })),
        }),
      },
    );
    if (res === null) return fail("network_error", "could not reach the returns service");
    if (res.status !== 201) {
      const b = res.body as ApiError;
      // The backend's reason (not yours, quantity exceeds ordered, …) is
      // surfaced verbatim — never rewritten into a vaguer claim.
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "return request failed");
    }
    return ok(toReturnSummary((res.body as { return: unknown }).return));
  }

  async listAddresses(secret: string): Promise<Result<Address[]>> {
    const res = await this.json("/persons/v1/shopper/addresses", {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "address list failed");
    }
    return ok(((res.body as { addresses?: Address[] })?.addresses ?? []) as Address[]);
  }

  async upsertAddress(secret: string, input: AddressInput): Promise<Result<Address>> {
    const res = await this.json("/persons/v1/shopper/addresses", {
      method: "PUT",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "address save failed");
    }
    return ok((res.body as { address: Address }).address);
  }

  async deleteAddress(secret: string, addressId: string): Promise<Result<void>> {
    const res = await this.json(`/persons/v1/shopper/addresses/${encodeURIComponent(addressId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${secret}` },
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "address delete failed");
    }
    return ok(undefined);
  }

  async listWishlist(secret: string): Promise<Result<string[]>> {
    const res = await this.json("/persons/v1/shopper/wishlist", {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "wishlist list failed");
    }
    const items = (res.body as { items?: Array<{ productRef: string }> })?.items ?? [];
    return ok(items.map((i) => i.productRef));
  }

  async addWishlistItem(secret: string, ref: string): Promise<Result<void>> {
    const res = await this.json("/persons/v1/shopper/wishlist", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ product_ref: ref }),
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status !== 201 && res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "wishlist add failed");
    }
    return ok(undefined);
  }

  async removeWishlistItem(secret: string, ref: string): Promise<Result<{ removed: boolean }>> {
    const res = await this.json(`/persons/v1/shopper/wishlist/${encodeURIComponent(ref)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${secret}` },
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    // 404 = already not saved; the desired end-state, not a failure.
    if (res.status === 404) return ok({ removed: false });
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "wishlist remove failed");
    }
    return ok({ removed: true });
  }

  async mergeWishlist(secret: string, refs: readonly string[]): Promise<Result<string[]>> {
    const res = await this.json("/persons/v1/shopper/wishlist/merge", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ refs }),
    });
    if (res === null) return fail("network_error", "could not reach the account service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "wishlist merge failed");
    }
    const items = (res.body as { items?: Array<{ productRef: string }> })?.items ?? [];
    return ok(items.map((i) => i.productRef));
  }

  async listCards(input: { tenantRef: string; personId: string }): Promise<Result<SavedCard[]>> {
    const token = this.requireStorefrontToken();
    if (token === null) return fail("misconfigured", "storefront token not configured");
    const res = await this.json(
      `/payments/v1/tenants/${encodeURIComponent(input.tenantRef)}/customers/${encodeURIComponent(input.personId)}/cards`,
      { method: "GET", headers: { "x-storefront-token": token } },
    );
    if (res === null) return fail("network_error", "could not reach the payment service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "card list failed");
    }
    return ok(((res.body as { cards?: SavedCard[] })?.cards ?? []) as SavedCard[]);
  }

  async listSubscriptions(input: {
    tenantRef: string;
    personId: string;
  }): Promise<Result<SubscriptionSummary[]>> {
    const token = this.requireStorefrontToken();
    if (token === null) return fail("misconfigured", "storefront token not configured");
    const res = await this.json(
      `/subscriptions/v1/tenants/${encodeURIComponent(input.tenantRef)}/customers/${encodeURIComponent(input.personId)}/subscriptions`,
      { method: "GET", headers: { "x-storefront-token": token } },
    );
    if (res === null) return fail("network_error", "could not reach the subscriptions service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "subscription list failed");
    }
    return ok(
      ((res.body as { subscriptions?: unknown[] })?.subscriptions ?? []).map(toSubscriptionSummary),
    );
  }

  async cancelSubscription(input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>> {
    return this.subscriptionAction(input, "cancel");
  }

  async pauseSubscription(input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>> {
    return this.subscriptionAction(input, "pause");
  }

  async resumeSubscription(input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>> {
    return this.subscriptionAction(input, "resume");
  }

  private async subscriptionAction(
    input: { tenantRef: string; personId: string; subscriptionId: string },
    action: "cancel" | "pause" | "resume",
  ): Promise<Result<void>> {
    const token = this.requireStorefrontToken();
    if (token === null) return fail("misconfigured", "storefront token not configured");
    const res = await this.json(
      `/subscriptions/v1/tenants/${encodeURIComponent(input.tenantRef)}/customers/${encodeURIComponent(input.personId)}/subscriptions/${encodeURIComponent(input.subscriptionId)}/${action}`,
      { method: "POST", headers: { "x-storefront-token": token } },
    );
    if (res === null) return fail("network_error", "could not reach the subscriptions service");
    if (res.status !== 200) {
      const b = res.body as ApiError;
      return fail(
        b.error?.code ?? "unavailable",
        b.error?.message ?? `subscription ${action} failed`,
      );
    }
    return ok(undefined);
  }

  async vaultCard(input: {
    tenantRef: string;
    personId: string;
    card: { ccnumber: string; ccexp: string; cvv?: string };
    idempotencyKey: string;
  }): Promise<Result<SavedCard>> {
    const token = this.requireStorefrontToken();
    if (token === null) return fail("misconfigured", "storefront token not configured");
    const res = await this.json(
      `/payments/v1/tenants/${encodeURIComponent(input.tenantRef)}/customers/${encodeURIComponent(input.personId)}/cards`,
      {
        method: "POST",
        headers: {
          "x-storefront-token": token,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({ card: input.card }),
      },
    );
    if (res === null) return fail("network_error", "could not reach the payment service");
    if (res.status === 402) {
      const b = res.body as ApiError;
      return fail("card_declined", b.error?.message ?? "your card could not be saved");
    }
    if (res.status !== 201) {
      const b = res.body as ApiError;
      return fail(b.error?.code ?? "unavailable", b.error?.message ?? "card save failed");
    }
    return ok((res.body as { card: SavedCard }).card);
  }
}

// ── Response shapes + mappers ────────────────────────────────────────────────

type RawOrder = {
  id: string;
  order_number: number;
  status: string;
  total_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  currency: string;
  coupon_code: string | null;
};
type RawOrderItem = {
  id: string;
  product_name: string;
  sku: string;
  variant_id: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

type RawReturn = {
  id: string;
  order_id: string;
  status: string;
  reason: string | null;
  refunded_cents: number;
};

function toReturnSummary(raw: unknown): ReturnSummary {
  const r = raw as RawReturn;
  return {
    id: r.id,
    orderId: r.order_id,
    status: r.status,
    reason: r.reason ?? null,
    refundedCents: r.refunded_cents ?? 0,
  };
}

function toOrderSummary(raw: unknown): OrderSummary {
  const o = raw as RawOrder;
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    totalCents: o.total_cents,
    currency: o.currency,
    couponCode: o.coupon_code ?? null,
  };
}

type RawSubscription = {
  id: string;
  plan_ref: string;
  status: SubscriptionSummary["status"];
  interval: SubscriptionSummary["interval"];
  interval_count: number;
  unit_price_cents: number;
  currency: string;
  next_bill_at: string;
  failure_count: number;
};

function toSubscriptionSummary(raw: unknown): SubscriptionSummary {
  const s = raw as RawSubscription;
  return {
    id: s.id,
    planRef: s.plan_ref,
    status: s.status,
    interval: s.interval,
    intervalCount: s.interval_count,
    unitPriceCents: s.unit_price_cents,
    currency: s.currency,
    nextBillAt: s.next_bill_at,
    failureCount: s.failure_count,
  };
}

function toOrderDetail(order: RawOrder, items: RawOrderItem[]): OrderDetail {
  return {
    ...toOrderSummary(order),
    subtotalCents: order.subtotal_cents,
    discountCents: order.discount_cents,
    items: items.map((i) => ({
      id: i.id,
      productName: i.product_name,
      sku: i.sku,
      variantId: i.variant_id,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.line_total_cents,
    })),
  };
}

// ── Fixture client — dev/test with no running flightdeck app ─────────────────

import { createFixtureAccountStore, type FixtureAccountStore } from "@/lib/account-fixture-store";

export class FixtureAccountClient implements AccountClient {
  constructor(private readonly store: FixtureAccountStore = createFixtureAccountStore()) {}

  requestLogin(input: {
    tenantRef: string;
    email: string;
    signInBaseUrl: string;
    clientIp?: string | null;
  }): Promise<Result<{ devToken?: string }>> {
    const token = this.store.requestLogin(input.tenantRef, input.email);
    // Dev convenience (never done by the live client): hand the token back so
    // the flow completes without an inbox.
    return Promise.resolve(ok({ devToken: token }));
  }

  exchangeToken(
    token: string,
    _clientIp?: string | null,
  ): Promise<Result<ExchangedShopper | null>> {
    const exchanged = this.store.exchange(token);
    return Promise.resolve(ok(exchanged));
  }

  verifySession(secret: string): Promise<Result<ShopperIdentity | null>> {
    return Promise.resolve(ok(this.store.verify(secret)));
  }

  logout(secret: string): Promise<Result<void>> {
    this.store.logout(secret);
    return Promise.resolve(ok(undefined));
  }

  listOrders(input: { tenantRef: string; personId: string }): Promise<Result<OrderSummary[]>> {
    return Promise.resolve(ok(this.store.listOrders(input.personId)));
  }

  getOrder(input: {
    tenantRef: string;
    personId: string;
    orderId: string;
  }): Promise<Result<OrderDetail | null>> {
    return Promise.resolve(ok(this.store.getOrder(input.personId, input.orderId)));
  }

  listAddresses(secret: string): Promise<Result<Address[]>> {
    const id = this.store.verify(secret);
    if (id === null) return Promise.resolve(fail("invalid_session", "session expired"));
    return Promise.resolve(ok(this.store.listAddresses(id.personId)));
  }

  upsertAddress(secret: string, input: AddressInput): Promise<Result<Address>> {
    const id = this.store.verify(secret);
    if (id === null) return Promise.resolve(fail("invalid_session", "session expired"));
    return Promise.resolve(ok(this.store.upsertAddress(id.personId, input)));
  }

  deleteAddress(secret: string, addressId: string): Promise<Result<void>> {
    const id = this.store.verify(secret);
    if (id === null) return Promise.resolve(fail("invalid_session", "session expired"));
    this.store.deleteAddress(id.personId, addressId);
    return Promise.resolve(ok(undefined));
  }

  listWishlist(secret: string): Promise<Result<string[]>> {
    const id = this.store.verify(secret);
    if (id === null) return Promise.resolve(fail("invalid_session", "session expired"));
    return Promise.resolve(ok(this.store.listWishlist(id.personId)));
  }

  addWishlistItem(secret: string, ref: string): Promise<Result<void>> {
    const id = this.store.verify(secret);
    if (id === null) return Promise.resolve(fail("invalid_session", "session expired"));
    this.store.addWishlistItem(id.personId, ref);
    return Promise.resolve(ok(undefined));
  }

  removeWishlistItem(secret: string, ref: string): Promise<Result<{ removed: boolean }>> {
    const id = this.store.verify(secret);
    if (id === null) return Promise.resolve(fail("invalid_session", "session expired"));
    return Promise.resolve(ok({ removed: this.store.removeWishlistItem(id.personId, ref) }));
  }

  mergeWishlist(secret: string, refs: readonly string[]): Promise<Result<string[]>> {
    const id = this.store.verify(secret);
    if (id === null) return Promise.resolve(fail("invalid_session", "session expired"));
    return Promise.resolve(ok(this.store.mergeWishlist(id.personId, refs)));
  }

  listReturns(input: { tenantRef: string; personId: string }): Promise<Result<ReturnSummary[]>> {
    return Promise.resolve(ok(this.store.listReturns(input.personId)));
  }

  createReturn(input: {
    tenantRef: string;
    personId: string;
    orderId: string;
    reason: string | null;
    lines: readonly ReturnLineInput[];
  }): Promise<Result<ReturnSummary>> {
    const created = this.store.createReturn(input.personId, input.orderId, input.reason, [
      ...input.lines,
    ]);
    if (typeof created === "string") return Promise.resolve(fail("invalid_return", created));
    return Promise.resolve(ok(created));
  }

  listCards(input: { tenantRef: string; personId: string }): Promise<Result<SavedCard[]>> {
    // A real read of the fixture-vaulted cards for this person — empty until
    // the shopper adds one via `vaultCard`, never a fabricated card.
    return Promise.resolve(ok(this.store.listCards(input.personId)));
  }

  vaultCard(input: {
    tenantRef: string;
    personId: string;
    card: { ccnumber: string; ccexp: string; cvv?: string };
    idempotencyKey: string;
  }): Promise<Result<SavedCard>> {
    // Mirror the fake provider's magic-card convention: a card ending "0002"
    // is declined at vault time, so dev/tests exercise the decline branch too.
    if (input.card.ccnumber.replace(/\s/g, "").endsWith("0002")) {
      return Promise.resolve(fail("card_declined", "fixture: card declined at vault (…0002)"));
    }
    return Promise.resolve(
      ok(
        this.store.vaultCard(input.personId, {
          ccnumber: input.card.ccnumber,
          ccexp: input.card.ccexp,
        }),
      ),
    );
  }

  listSubscriptions(_input: {
    tenantRef: string;
    personId: string;
  }): Promise<Result<SubscriptionSummary[]>> {
    // Honest: fixture mode (local dev / tests with no running flightdeck app)
    // has no subscriptions engine behind it — a real, verified empty list,
    // never a fabricated subscription. The LIVE client reads the real
    // @dscodotco/subscriptions module.
    return Promise.resolve(ok([]));
  }

  cancelSubscription(_input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>> {
    return Promise.resolve(ok(undefined));
  }

  pauseSubscription(_input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>> {
    return Promise.resolve(ok(undefined));
  }

  resumeSubscription(_input: {
    tenantRef: string;
    personId: string;
    subscriptionId: string;
  }): Promise<Result<void>> {
    return Promise.resolve(ok(undefined));
  }
}

// ── Selection ────────────────────────────────────────────────────────────────

let liveClient: LiveAccountClient | null = null;
let fixtureClient: FixtureAccountClient | null = null;

export function getAccountClient(): AccountClient {
  const apiBaseUrl = process.env.FLIGHTDECK_API_URL;
  if (apiBaseUrl) {
    liveClient ??= new LiveAccountClient(
      apiBaseUrl.replace(/\/+$/, ""),
      process.env.FLIGHTDECK_STOREFRONT_TOKEN,
    );
    return liveClient;
  }
  fixtureClient ??= new FixtureAccountClient();
  return fixtureClient;
}
