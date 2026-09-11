"use server";

import { revalidatePath } from "next/cache";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountSurface, requireShopper, requireWishlist } from "@/lib/account-context";

/**
 * Wishlist mutations from the account page (LOO-3138). Every action
 * re-asserts the account surface (`accounts.enabled`) AND the wishlist gate
 * (`wishlist.enabled`) — a store with the wishlist off has actions as
 * invisible as its page — and scopes to the session's person (the Bearer
 * secret is forwarded to persons, which derives the person from it; a client
 * can never target another shopper's wishlist).
 */

export async function removeFromWishlist(formData: FormData): Promise<void> {
  const ctx = await requireAccountSurface();
  requireWishlist(ctx);
  const session = await requireShopper();
  const ref = String(formData.get("ref") ?? "").trim();
  if (ref.length === 0) return;
  await getAccountClient().removeWishlistItem(session.secret, ref);
  revalidatePath("/account/wishlist");
}
