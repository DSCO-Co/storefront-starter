"use server";

import { revalidatePath } from "next/cache";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";

/**
 * Address-book mutations (LOO-3137). Every action re-asserts the surface
 * (`accounts.enabled`) AND the sub-flag (`accounts.addressBook`) — a store
 * with the address book off has actions as invisible as its page — and
 * scopes to the session's person (the Bearer secret is forwarded to persons,
 * which derives the person from it; a client can never target another
 * shopper's address book).
 */

export interface AddressFormState {
  readonly error: string | null;
  readonly ok: boolean;
}

export async function saveAddress(
  _prev: AddressFormState,
  formData: FormData,
): Promise<AddressFormState> {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "addressBook");
  const session = await requireShopper();

  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const input = {
    label: field("label"),
    line1: field("line1"),
    line2: field("line2") || null,
    city: field("city"),
    state: field("state"),
    postalCode: field("postalCode"),
    country: field("country"),
    isDefault: formData.get("isDefault") === "on",
  };
  if (
    input.label.length === 0 ||
    input.line1.length === 0 ||
    input.city.length === 0 ||
    input.state.length === 0 ||
    input.postalCode.length === 0 ||
    input.country.length === 0
  ) {
    return {
      error: "Label, line 1, city, state, postal code and country are required.",
      ok: false,
    };
  }

  const result = await getAccountClient().upsertAddress(session.secret, input);
  if (!result.ok) {
    return { error: `Could not save that address (${result.error.message}).`, ok: false };
  }
  revalidatePath("/account/addresses");
  return { error: null, ok: true };
}

export async function deleteAddress(formData: FormData): Promise<void> {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "addressBook");
  const session = await requireShopper();
  const addressId = String(formData.get("addressId") ?? "").trim();
  if (addressId.length === 0) return;
  await getAccountClient().deleteAddress(session.secret, addressId);
  revalidatePath("/account/addresses");
}
