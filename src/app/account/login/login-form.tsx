"use client";

import { useActionState } from "react";
import { type RequestLoginState, requestShopperLogin } from "@/app/account/actions";

const initialState: RequestLoginState = { error: null, requested: false };

/**
 * The email → magic-link request form. On success it shows the "check your
 * email" state. In dev/fixture mode the action returns a `devToken` (there is
 * no inbox to receive the real link) and this form surfaces a direct
 * "continue" link — never shown in production, where the token only ever
 * arrives by email.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(requestShopperLogin, initialState);

  if (state.requested) {
    return (
      <div className="grid gap-3">
        <p className="text-sm">Check your email for a sign-in link. It expires in 15 minutes.</p>
        {state.devToken !== undefined ? (
          <a
            href={`/account/callback?token=${encodeURIComponent(state.devToken)}`}
            className="text-sm underline"
            style={{ color: "var(--color-primary)" }}
          >
            Dev mode: continue with your sign-in link →
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span>Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="fd-input px-3 py-2"
        />
      </label>
      {state.error ? (
        <p className="text-sm" style={{ color: "var(--color-error, #ef4343)" }}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="fd-btn fd-btn-primary fd-btn-md">
        {pending ? "Sending…" : "Send sign-in link"}
      </button>
    </form>
  );
}
