import { notFound, redirect } from "next/navigation";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";
import { ReturnForm } from "./return-form";

/**
 * `/account/returns/new?order=<id>` — the start-return flow: the picked
 * order's lines with quantity pickers + a reason, submitted to the
 * `submitReturn` server action. The order is read server-side scoped to the
 * SESSION's person (the backend answers the same 404 for "not found" and
 * "not yours"), so the flow can never render someone else's lines.
 */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "orderHistory");
  const session = await requireShopper();

  const { order: orderId } = await searchParams;
  if (!orderId || orderId.trim().length === 0) redirect("/account/returns");

  const result = await getAccountClient().getOrder({
    tenantRef: ctx.tenantRef,
    personId: session.personId,
    orderId: orderId.trim(),
  });

  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <a
          href="/account/returns"
          className="text-sm underline"
          style={{ color: "var(--color-primary)" }}
        >
          ← Returns
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
        href="/account/returns"
        className="text-sm underline"
        style={{ color: "var(--color-primary)" }}
      >
        ← Returns
      </a>
      <h1
        className="text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Return items from order #{order.orderNumber}
      </h1>
      <ReturnForm
        orderId={order.id}
        items={order.items.map((item) => ({
          id: item.id,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
        }))}
      />
    </div>
  );
}
