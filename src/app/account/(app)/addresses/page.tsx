import { getAccountClient } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";
import { deleteAddress } from "./actions";
import { AddressForm } from "./address-form";

/**
 * `/account/addresses` — the shopper's address book (LOO-3137). Gated by
 * `accounts.addressBook` (404 when off — the same flag that gates the
 * checkout saved-address picker). Reads are scoped SERVER-SIDE to the
 * session's person by persons (Bearer-derived), never a client id.
 *
 * HONEST-ABSENCE: a failed read renders an error, never "no addresses".
 */
export default async function AddressesPage() {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "addressBook");
  const session = await requireShopper();

  const result = await getAccountClient().listAddresses(session.secret);

  return (
    <div className="grid gap-6">
      <h1
        className="text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Addresses
      </h1>

      {!result.ok ? (
        <p
          className="rounded-[var(--radius-card,12px)] border p-4 text-sm"
          style={{ borderColor: "var(--color-error, #ef4343)" }}
        >
          We couldn&apos;t load your addresses right now. Please try again in a moment.
        </p>
      ) : result.value.length === 0 ? (
        <p className="text-sm opacity-70">You don&apos;t have any saved addresses yet.</p>
      ) : (
        <ul className="grid gap-3">
          {result.value.map((address) => (
            <li
              key={address.id}
              className="flex items-start justify-between rounded-[var(--radius-card,12px)] border p-4"
              style={{ borderColor: "var(--color-border, #e5e5e5)" }}
            >
              <div className="text-sm">
                <div className="font-medium">
                  {address.label}
                  {address.isDefault ? (
                    <span
                      className="ml-2 rounded-[var(--radius-button,6px)] px-1.5 py-0.5 text-xs"
                      style={{ backgroundColor: "var(--color-muted, #eee)" }}
                    >
                      Default
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 opacity-70">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}
                  <br />
                  {address.city}, {address.state} {address.postalCode}
                  <br />
                  {address.country}
                </div>
              </div>
              <form action={deleteAddress}>
                <input type="hidden" name="addressId" value={address.id} />
                <button type="submit" className="text-sm underline opacity-70 hover:opacity-100">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div
        className="rounded-[var(--radius-card,12px)] border p-4"
        style={{ borderColor: "var(--color-border, #e5e5e5)" }}
      >
        <h2 className="mb-3 font-medium">Add or update an address</h2>
        <AddressForm />
      </div>
    </div>
  );
}
