"use server";

import { revalidatePath } from "next/cache";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountSurface, requireShopper } from "@/lib/account-context";

/**
 * Card-on-file mutation (LOO-3041 — the vault-CREATE seam now that payments
 * has a `vaultCard` provider method). Re-asserts the account surface
 * (`accounts.enabled`) and scopes to the session's person; the card leaves
 * the browser only to THIS server action, which forwards it to payments'
 * vault route (platform-served, ADR 0003 — never a client-side call to a
 * gateway). The page's card list is a real read of the real table, so a
 * successful save round-trips: add here → appears at /account/payment.
 *
 * Not gated by its own sub-flag (there is none) — it lives under
 * `accounts.enabled` like the payment page itself.
 */

export interface CardFormState {
  readonly error: string | null;
  readonly ok: boolean;
}

export async function saveCard(_prev: CardFormState, formData: FormData): Promise<CardFormState> {
  const ctx = await requireAccountSurface();
  const session = await requireShopper();

  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const ccnumber = field("ccnumber").replace(/\s/g, "");
  const ccexp = field("ccexp").replace(/\s/g, "");
  const cvv = field("cvv");
  if (ccnumber.length < 12 || !/^\d{4}$/.test(ccexp)) {
    return { error: "Enter a valid card number and expiry (MMYY).", ok: false };
  }

  // Deterministic idempotency key (never randomUUID): re-submitting the SAME
  // card for the SAME shopper dedups rather than double-vaulting.
  const idempotencyKey = `card:${session.personId}:${ccnumber.slice(-4)}:${ccexp}`;
  const result = await getAccountClient().vaultCard({
    tenantRef: ctx.tenantRef,
    personId: session.personId,
    card: { ccnumber, ccexp, ...(cvv.length > 0 ? { cvv } : {}) },
    idempotencyKey,
  });
  if (!result.ok) {
    return {
      error:
        result.error.code === "card_declined"
          ? "That card was declined and not saved. Try a different card."
          : `Could not save that card (${result.error.message}).`,
      ok: false,
    };
  }
  revalidatePath("/account/payment");
  return { error: null, ok: true };
}
