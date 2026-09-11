"use client";

import { useState } from "react";

/**
 * Age-verification interstitial (LOO-3050 item 3). SERVER-DRIVEN: the layout
 * mounts this ONLY when the store's age gate is `interstitial` AND the
 * request carries no `fd_age_ok` httpOnly pass cookie. Affirming POSTs
 * `/api/age-gate`, which sets that httpOnly cookie server-side, then the
 * page reloads — so the server re-evaluates the gate against a cookie client
 * JS cannot forge. A cleared storage / reload can no longer bypass it: only
 * a real server-set pass clears the gate.
 *
 * `checkbox` mode does NOT mount this (it gates CHECKOUT server-side instead,
 * via the `/api/checkout` route) — the layout passes `mode` so a future
 * variant could branch, but today only `interstitial` reaches here.
 */
export function AgeGate({ minAge, mode }: { minAge: number; mode: "interstitial" | "checkbox" }) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/age-gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) {
        setSubmitting(false);
        setError("Could not verify. Please try again.");
        return;
      }
      // Reload so the SERVER re-renders without the gate (the httpOnly pass
      // cookie is now set) — the anti-bypass property.
      window.location.reload();
    } catch {
      setSubmitting(false);
      setError("Could not verify. Please check your connection.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Age verification"
      data-testid="age-gate"
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.85)" }}
    >
      <div
        className="w-full max-w-md rounded-lg p-8 text-center"
        style={{ background: "var(--color-surface, #fff)", color: "var(--color-text, #111)" }}
      >
        <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
          Age verification
        </h2>
        <p className="mt-3 text-sm">You must be {minAge} or older to enter this site.</p>
        {mode === "checkbox" ? (
          <label className="mt-4 flex items-start justify-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="fd-checkbox mt-1"
              data-testid="age-gate-checkbox"
            />
            <span>I confirm that I am {minAge} years of age or older.</span>
          </label>
        ) : null}
        {error ? (
          <p
            className="mt-3 text-sm"
            data-testid="age-gate-error"
            style={{ color: "var(--color-error, #b00)" }}
          >
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <a
            href="https://www.google.com"
            className="rounded border px-4 py-2 text-sm"
            style={{ borderColor: "var(--color-border, #e5e5e5)" }}
          >
            Exit
          </a>
          <button
            type="button"
            data-testid="age-gate-confirm"
            disabled={submitting || (mode === "checkbox" && !checked)}
            onClick={() => void confirm()}
            className="fd-btn fd-btn-primary fd-btn-md"
          >
            {submitting ? "Verifying…" : `I am ${minAge} or older`}
          </button>
        </div>
      </div>
    </div>
  );
}
