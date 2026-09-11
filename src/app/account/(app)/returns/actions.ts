"use server";

import { redirect } from "next/navigation";
import { getAccountClient, type ReturnLineInput } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";

/**
 * Start-a-return submission (FD Epic 12 shopper surface). Re-asserts the
 * surface + sub-flag exactly like the pages (a store with order history off
 * has this action as invisible as its route) and scopes to the SESSION's
 * person — the backend then re-asserts the order belongs to that person, so
 * a forged form can never open a return against someone else's order.
 *
 * Refusals (unknown line, quantity over what was ordered, not your order)
 * surface the backend's reason verbatim — never rewritten, never swallowed.
 */

export interface ReturnFormState {
  readonly error: string | null;
}

export async function submitReturn(
  _prev: ReturnFormState,
  formData: FormData,
): Promise<ReturnFormState> {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "orderHistory");
  const session = await requireShopper();

  const orderId = String(formData.get("orderId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (orderId.length === 0) return { error: "Missing order — start again from your returns page." };

  // One quantity field per order line, named `qty:<orderItemId>`; zero/blank
  // means "not returning this line".
  const lines: ReturnLineInput[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty:")) continue;
    const orderItemId = key.slice("qty:".length);
    const quantity = Number(String(value));
    if (orderItemId.length === 0 || !Number.isInteger(quantity) || quantity <= 0) continue;
    lines.push({ orderItemId, quantity });
  }
  if (lines.length === 0) {
    return { error: "Pick at least one item (a quantity above zero) to return." };
  }

  const result = await getAccountClient().createReturn({
    tenantRef: ctx.tenantRef,
    personId: session.personId,
    orderId,
    reason: reason.length > 0 ? reason : null,
    lines,
  });
  if (!result.ok) {
    return { error: `Could not submit your return: ${result.error.message}` };
  }
  redirect("/account/returns");
}
