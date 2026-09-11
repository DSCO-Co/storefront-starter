"use client";

import { useActionState } from "react";
import { type ReturnFormState, submitReturn } from "../actions";

const initialState: ReturnFormState = { error: null };

/**
 * The start-return form: one quantity picker per order line (0 = keep it,
 * capped at the quantity ordered) + an optional reason. Submission goes to
 * the `submitReturn` server action; a backend refusal renders verbatim.
 */
export function ReturnForm({
  orderId,
  items,
}: {
  orderId: string;
  items: ReadonlyArray<{ id: string; productName: string; sku: string; quantity: number }>;
}) {
  const [state, formAction, pending] = useActionState(submitReturn, initialState);

  return (
    <form action={formAction} className="grid max-w-lg gap-4 text-sm" data-testid="return-form">
      <input type="hidden" name="orderId" value={orderId} />
      <p className="opacity-70">Choose how many of each item you&apos;re sending back.</p>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-4 rounded-[var(--radius-card,12px)] border p-3"
            style={{ borderColor: "var(--color-border, #e5e5e5)" }}
            data-testid="return-line"
          >
            <div>
              <div className="font-medium">{item.productName}</div>
              <div className="text-xs opacity-70">
                {item.sku} · {item.quantity} ordered
              </div>
            </div>
            <label className="flex items-center gap-2">
              Return
              <input
                type="number"
                name={`qty:${item.id}`}
                min={0}
                max={item.quantity}
                defaultValue={0}
                className="fd-input w-16 px-2 py-1"
                data-testid="return-line-quantity"
              />
            </label>
          </li>
        ))}
      </ul>
      <label className="grid gap-1">
        <span>Reason (optional)</span>
        <textarea
          name="reason"
          rows={3}
          className="fd-textarea px-3 py-2"
          data-testid="return-reason"
        />
      </label>
      {state.error ? (
        <p data-testid="return-error" style={{ color: "var(--color-error, #ef4343)" }}>
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="fd-btn fd-btn-primary fd-btn-md justify-self-start"
        data-testid="return-submit"
      >
        {pending ? "Submitting…" : "Request return"}
      </button>
    </form>
  );
}
