import { getAccountClient } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";
import { formatCents } from "@/lib/format";

/**
 * `/account/orders` — the signed-in shopper's order history. Gated by
 * `accounts.orderHistory` (404 when off). Orders are scoped SERVER-SIDE to
 * the session's `personId` — never a client-supplied id.
 *
 * HONEST-ABSENCE: a failed read (`ok: false`) renders "we couldn't load your
 * orders", NEVER "you have no orders". Only a verified empty list is "no
 * orders yet".
 */
export default async function OrdersPage() {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "orderHistory");
  const session = await requireShopper();

  const result = await getAccountClient().listOrders({
    tenantRef: ctx.tenantRef,
    personId: session.personId,
  });

  return (
    <div className="grid gap-6">
      <h1
        className="text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Orders
      </h1>

      {!result.ok ? (
        <p
          className="rounded-[var(--radius-card,12px)] border p-4 text-sm"
          style={{ borderColor: "var(--color-error, #ef4343)" }}
        >
          We couldn&apos;t load your orders right now. Please try again in a moment.
        </p>
      ) : result.value.length === 0 ? (
        <p className="text-sm opacity-70">You haven&apos;t placed any orders yet.</p>
      ) : (
        <ul className="grid gap-3">
          {result.value.map((order) => (
            <li
              key={order.id}
              className="flex items-center justify-between rounded-[var(--radius-card,12px)] border p-4"
              style={{ borderColor: "var(--color-border, #e5e5e5)" }}
            >
              <div>
                <a
                  href={`/account/orders/${encodeURIComponent(order.id)}`}
                  className="font-medium underline"
                  style={{ color: "var(--color-primary)" }}
                >
                  Order #{order.orderNumber}
                </a>
                <div className="mt-1 text-sm opacity-70">{humanStatus(order.status)}</div>
              </div>
              <div className="text-right font-medium">{formatCents(order.totalCents)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function humanStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
