"use server";

import { revalidatePath } from "next/cache";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";

/**
 * Subscription self-serve mutations (FD Epic 7). Every action re-asserts the
 * surface (`accounts.enabled`) AND the sub-flag (`accounts.subscriptionSelfServe`)
 * — a store with self-serve off has actions as invisible as its page — and
 * scopes to the session's OWN person: the subscriptions module cancels/pauses
 * only a row whose person_id matches, so a client can never target another
 * shopper's subscription.
 */

async function mutate(formData: FormData, action: "cancel" | "pause" | "resume"): Promise<void> {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "subscriptionSelfServe");
  const session = await requireShopper();
  const subscriptionId = String(formData.get("subscriptionId") ?? "").trim();
  if (subscriptionId.length === 0) return;

  const client = getAccountClient();
  const input = { tenantRef: ctx.tenantRef, personId: session.personId, subscriptionId };
  if (action === "cancel") {
    await client.cancelSubscription(input);
  } else if (action === "resume") {
    await client.resumeSubscription(input);
  } else {
    await client.pauseSubscription(input);
  }
  revalidatePath("/account/subscriptions");
}

export async function cancelSubscriptionAction(formData: FormData): Promise<void> {
  await mutate(formData, "cancel");
}

export async function pauseSubscriptionAction(formData: FormData): Promise<void> {
  await mutate(formData, "pause");
}

/** C4 (consumer-compliance remediation 2026-09-09): resume a paused subscription. */
export async function resumeSubscriptionAction(formData: FormData): Promise<void> {
  await mutate(formData, "resume");
}
