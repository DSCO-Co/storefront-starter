"use client";

import { useActionState } from "react";
import { type AddressFormState, saveAddress } from "./actions";

const initialState: AddressFormState = { error: null, ok: false };

/**
 * Add/update an address. Posts to the `saveAddress` server action (which is
 * (person, label)-upsert, matching the persons repo): re-submitting the same
 * label updates that address in place.
 */
export function AddressForm() {
  const [state, formAction, pending] = useActionState(saveAddress, initialState);

  return (
    <form action={formAction} className="grid gap-3 text-sm">
      <Field name="label" label="Label (e.g. Home)" required />
      <Field name="line1" label="Address line 1" required />
      <Field name="line2" label="Address line 2" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="city" label="City" required />
        <Field name="state" label="State / Region" required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="postalCode" label="Postal code" required />
        <Field name="country" label="Country" required />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="isDefault" className="fd-checkbox" />
        <span>Make this my default address</span>
      </label>
      {state.error ? (
        <p style={{ color: "var(--color-error, #ef4343)" }}>{state.error}</p>
      ) : state.ok ? (
        <p style={{ color: "var(--color-primary)" }}>Address saved.</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="fd-btn fd-btn-primary fd-btn-md justify-self-start"
      >
        {pending ? "Saving…" : "Save address"}
      </button>
    </form>
  );
}

function Field({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="grid gap-1">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <input type="text" name={name} required={required} className="fd-input px-3 py-2" />
    </label>
  );
}
