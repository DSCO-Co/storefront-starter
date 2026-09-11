"use client";

import { useActionState, useEffect, useRef } from "react";
import { type ExchangeState, exchangeShopperToken } from "@/app/account/actions";

const initialState: ExchangeState = { error: null };

/**
 * Auto-submits the token exchange on mount (no click for the common "just
 * clicked the emailed link" path) while staying a real `<form>` — the
 * "Continue" button is the no-JS / failed-auto-submit fallback. A successful
 * exchange redirects server-side, so this component only ever re-renders to
 * show an error.
 */
export function CallbackRunner({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(exchangeShopperToken, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    formRef.current?.requestSubmit();
  }, []);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      {state.error ? (
        <>
          <p className="text-sm" style={{ color: "var(--color-error, #ef4343)" }}>
            {state.error}
          </p>
          <a
            href="/account/login"
            className="text-sm underline"
            style={{ color: "var(--color-primary)" }}
          >
            Request a new sign-in link
          </a>
        </>
      ) : (
        <p className="text-sm opacity-70">One moment…</p>
      )}
      <button type="submit" disabled={pending} className="fd-btn fd-btn-primary fd-btn-md">
        {pending ? "Signing you in…" : "Continue"}
      </button>
    </form>
  );
}
