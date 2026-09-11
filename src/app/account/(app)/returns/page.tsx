import { getAccountClient } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";
import { formatCents } from "@/lib/format";

/**
 * `/account/returns` — the signed-in shopper's returns (RMA) over the
 * checkout module's shopper surface (FD Epic 12: the backend + portal +
 * console existed; this is the missing shopper page). Gated by
 * `accounts.orderHistory` (a return is an action on an order — same gate,
 * same 404-when-off posture, and the nav link is gated identically).
 *
 * HONEST-ABSENCE: each of the two reads (returns, orders) renders its OWN
 * failure state — a failed returns read is "we couldn't load your returns",
 * NEVER "no returns yet"; a failed orders read hides the start-a-return
 * picker rather than claiming there is nothing to return.
 */
export default async function ReturnsPage() {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "orderHistory");
  const session = await requireShopper();

  const client = getAccountClient();
  const [returns, orders] = await Promise.all([
    client.listReturns({ tenantRef: ctx.tenantRef, personId: session.personId }),
    client.listOrders({ tenantRef: ctx.tenantRef, personId: session.personId }),
  ]);

  return (
    <div className="grid gap-8">
      <h1
        className="text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Returns
      </h1>

      {!returns.ok ? (
        <p
          className="rounded-[var(--radius-card,12px)] border p-4 text-sm"
          data-testid="returns-load-error"
          style={{ borderColor: "var(--color-error, #ef4343)" }}
        >
          We couldn&apos;t load your returns right now. Please try again in a moment.
        </p>
      ) : returns.value.length === 0 ? (
        <p className="text-sm opacity-70" data-testid="returns-empty">
          You haven&apos;t requested any returns.
        </p>
      ) : (
        <ul className="grid gap-3" data-testid="returns-list">
          {returns.value.map((ret) => (
            <li
              key={ret.id}
              className="flex items-center justify-between rounded-[var(--radius-card,12px)] border p-4"
              style={{ borderColor: "var(--color-border, #e5e5e5)" }}
            >
              <div>
                <div className="font-medium">Return · {humanStatus(ret.status)}</div>
                <div className="mt-1 text-sm opacity-70">
                  <a
                    href={`/account/orders/${encodeURIComponent(ret.orderId)}`}
                    className="underline"
                    style={{ color: "var(--color-primary)" }}
                  >
                    View order
                  </a>
                  {ret.reason ? ` · ${ret.reason}` : null}
                </div>
              </div>
              <div className="text-right text-sm">
                {ret.status === "refunded" ? (
                  <span className="font-medium">Refunded {formatCents(ret.refundedCents)}</span>
                ) : (
                  <span className="opacity-70">{statusHint(ret.status)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3">
        <h2 className="text-xl font-semibold">Start a return</h2>
        {!orders.ok ? (
          <p
            className="rounded-[var(--radius-card,12px)] border p-4 text-sm"
            data-testid="returns-orders-error"
            style={{ borderColor: "var(--color-error, #ef4343)" }}
          >
            We couldn&apos;t load your orders right now, so a return can&apos;t be started here.
            Please try again in a moment.
          </p>
        ) : orders.value.length === 0 ? (
          <p className="text-sm opacity-70">
            You have no orders yet, so there&apos;s nothing to return.
          </p>
        ) : (
          <ul className="grid gap-2">
            {orders.value.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between rounded-[var(--radius-card,12px)] border p-3"
                style={{ borderColor: "var(--color-border, #e5e5e5)" }}
              >
                <span className="text-sm">
                  Order #{order.orderNumber} · {formatCents(order.totalCents)}
                </span>
                <a
                  href={`/account/returns/new?order=${encodeURIComponent(order.id)}`}
                  className="fd-btn fd-btn-secondary fd-btn-sm"
                  data-testid="returns-start-link"
                >
                  Start a return
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function humanStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusHint(status: string): string {
  switch (status) {
    case "requested":
      return "Waiting for review";
    case "approved":
      return "Approved — ship it back";
    case "rejected":
      return "Not approved";
    default:
      return humanStatus(status);
  }
}
