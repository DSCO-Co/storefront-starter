import { getAccountClient } from "@/lib/account-client";
import { requireAccountSurface, requireShopper } from "@/lib/account-context";
import { CardForm } from "./card-form";

/**
 * `/account/payment` — cards on file (LOO-3041). Reads payments' real,
 * customer-scoped vaulted-cards route (a REAL read of a REAL table, honest
 * about absence — never a fabricated card) AND now lets the shopper ADD a
 * card: the `vaultCard` provider method (port + NMI + fake) plus payments'
 * vault route close the write seam that migrations/0004_vaulted_cards.sql
 * documented as the follow-up. Adding a card round-trips: save → it appears
 * in the list. NOT gated by its own sub-flag (there is none) — it lives under
 * `accounts.enabled` like the overview.
 */
export default async function PaymentPage() {
  const ctx = await requireAccountSurface();
  const session = await requireShopper();

  const result = await getAccountClient().listCards({
    tenantRef: ctx.tenantRef,
    personId: session.personId,
  });

  return (
    <div className="grid gap-6">
      <h1
        className="text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Payment
      </h1>

      {!result.ok ? (
        <p
          className="rounded-[var(--radius-card,12px)] border p-4 text-sm"
          style={{ borderColor: "var(--color-error, #ef4343)" }}
        >
          We couldn&apos;t load your saved cards right now. Please try again in a moment.
        </p>
      ) : result.value.length === 0 ? (
        <div className="grid gap-2 text-sm">
          <p className="opacity-70">You have no saved cards.</p>
          <p className="opacity-70">Add a card below to save it securely on file.</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {result.value.map((card) => (
            <li
              key={card.id}
              className="flex items-center justify-between rounded-[var(--radius-card,12px)] border p-4"
              style={{ borderColor: "var(--color-border, #e5e5e5)" }}
            >
              <div className="text-sm">
                <span className="font-medium">{card.brand ?? "Card"}</span> ending{" "}
                {card.last4 ?? "••••"}
                {card.expMonth && card.expYear ? (
                  <span className="opacity-70">
                    {" "}
                    · exp {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                  </span>
                ) : null}
              </div>
              {card.isDefault ? (
                <span
                  className="rounded-[var(--radius-button,6px)] px-1.5 py-0.5 text-xs"
                  style={{ backgroundColor: "var(--color-muted, #eee)" }}
                >
                  Default
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div
        className="rounded-[var(--radius-card,12px)] border p-4"
        style={{ borderColor: "var(--color-border, #e5e5e5)" }}
      >
        <h2 className="mb-3 font-medium">Add a card</h2>
        <CardForm />
      </div>
    </div>
  );
}
