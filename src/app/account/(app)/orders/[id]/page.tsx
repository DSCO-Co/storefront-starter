import { notFound } from "next/navigation";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";
import { formatCents } from "@/lib/format";
import { ReorderButton } from "./reorder-button";

/**
 * `/account/orders/[id]` — one order's detail, scoped SERVER-SIDE to the
 * session's `personId` (a shopper can never open another shopper's order:
 * the backend returns the same 404 for "not found" and "not yours"). Carries
 * the reorder widget (LOO-3137). Gated by `accounts.orderHistory`.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "orderHistory");
  const session = await requireShopper();
  const { id } = await params;

  const result = await getAccountClient().getOrder({
    tenantRef: ctx.tenantRef,
    personId: session.personId,
    orderId: id,
  });

  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <a
          href="/account/orders"
          className="text-sm underline"
          style={{ color: "var(--color-primary)" }}
        >
          ← Orders
        </a>
        <p
          className="rounded-[var(--radius-card,12px)] border p-4 text-sm"
          style={{ borderColor: "var(--color-error, #ef4343)" }}
        >
          We couldn&apos;t load this order right now. Please try again in a moment.
        </p>
      </div>
    );
  }
  // A verified "not found or not yours" — a real absence, so a real 404.
  if (result.value === null) notFound();
  const order = result.value;

  return (
    <div className="grid gap-6">
      <a
        href="/account/orders"
        className="text-sm underline"
        style={{ color: "var(--color-primary)" }}
      >
        ← Orders
      </a>
      <div className="flex items-center justify-between">
        <h1
          className="text-3xl"
          style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
        >
          Order #{order.orderNumber}
        </h1>
        <ReorderButton
          storeKey={ctx.storeKey}
          items={order.items.map((i) => ({
            slug: i.sku,
            name: i.productName,
            variantLabel: i.sku,
            variantId: i.variantId,
            unitPriceCents: i.unitPriceCents,
            quantity: i.quantity,
          }))}
        />
      </div>
      <p className="text-sm opacity-70">{order.status.replace(/_/g, " ")}</p>

      <ul className="grid gap-2">
        {order.items.map((item) => (
          <li
            key={`${item.variantId}-${item.sku}`}
            className="flex items-center justify-between rounded-[var(--radius-card,12px)] border p-3"
            style={{ borderColor: "var(--color-border, #e5e5e5)" }}
          >
            <div>
              <div className="font-medium">{item.productName}</div>
              <div className="text-sm opacity-70">
                {item.sku} · Qty {item.quantity}
              </div>
            </div>
            <div className="font-medium">{formatCents(item.lineTotalCents)}</div>
          </li>
        ))}
      </ul>

      <div className="grid gap-1 text-sm">
        <Row label="Subtotal" value={formatCents(order.subtotalCents)} />
        {order.discountCents > 0 ? (
          <Row
            label={`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`}
            value={`-${formatCents(order.discountCents)}`}
          />
        ) : null}
        <Row label="Total" value={formatCents(order.totalCents)} strong />
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <span className="opacity-70">{label}</span>
      <span>{value}</span>
    </div>
  );
}
