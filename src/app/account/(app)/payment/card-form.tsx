"use client";

import { useActionState } from "react";
import { type CardFormState, saveCard } from "./actions";

const initialState: CardFormState = { error: null, ok: false };

/**
 * Add a card on file (LOO-3041). Posts to the `saveCard` server action, which
 * forwards the card to payments' vault route server-side (the card never goes
 * to a gateway from the browser — platform-served, ADR 0003). On success the
 * page revalidates and the new card appears in the list above.
 */
export function CardForm() {
  const [state, formAction, pending] = useActionState(saveCard, initialState);

  return (
    <form action={formAction} className="grid gap-3 text-sm" data-testid="card-form">
      <label className="grid gap-1">
        <span>Card number *</span>
        <input
          type="text"
          name="ccnumber"
          inputMode="numeric"
          autoComplete="cc-number"
          required
          className="fd-input px-3 py-2"
          data-testid="card-ccnumber"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span>Expiry (MMYY) *</span>
          <input
            type="text"
            name="ccexp"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="0129"
            required
            className="rounded-[var(--radius-base,8px)] border px-3 py-2"
            style={{ borderColor: "var(--color-border, #ccc)" }}
            data-testid="card-ccexp"
          />
        </label>
        <label className="grid gap-1">
          <span>CVV</span>
          <input
            type="text"
            name="cvv"
            inputMode="numeric"
            autoComplete="cc-csc"
            className="rounded-[var(--radius-base,8px)] border px-3 py-2"
            style={{ borderColor: "var(--color-border, #ccc)" }}
            data-testid="card-cvv"
          />
        </label>
      </div>
      {state.error ? (
        <p style={{ color: "var(--color-error, #ef4343)" }} data-testid="card-form-error">
          {state.error}
        </p>
      ) : state.ok ? (
        <p style={{ color: "var(--color-primary)" }} data-testid="card-form-ok">
          Card saved.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="fd-btn fd-btn-primary fd-btn-md justify-self-start"
        data-testid="card-form-submit"
      >
        {pending ? "Saving…" : "Save card"}
      </button>
    </form>
  );
}
