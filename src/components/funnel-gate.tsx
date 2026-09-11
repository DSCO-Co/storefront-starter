"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Funnel-gate interstitial (P8) — SERVER-DRIVEN, mounted by the layout ONLY
 * when the gate decision is "blocked". Replaces the page entirely (bots see
 * no catalog markup behind an overlay). On submit it gathers proofs —
 * optional Turnstile token, the honeypot field, and a render-to-submit
 * timing — POSTs `/api/gate/verify` (which scores through the CDP and sets
 * the httpOnly pass cookie), then reloads so the SERVER re-decides against a
 * cookie the client cannot forge.
 *
 * Turnstile loads only when the tenant configured a site key; the widget
 * writes its token into a hidden input named `cf-turnstile-response`.
 */
export function FunnelGate({
  turnstileSiteKey,
  requireAgeConfirmation,
  minAge,
}: {
  turnstileSiteKey: string | null;
  requireAgeConfirmation: boolean;
  minAge: number;
}) {
  const startedAt = useRef(Date.now());
  const [ageChecked, setAgeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (turnstileSiteKey === null) return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [turnstileSiteKey]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const form = formRef.current;
    const honeypot = (form?.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "";
    const turnstileToken =
      (form?.elements.namedItem("cf-turnstile-response") as HTMLInputElement | null)?.value ?? "";
    try {
      const res = await fetch("/api/gate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          started_at: startedAt.current,
          honeypot,
          turnstile_token: turnstileToken,
          age_confirmed: requireAgeConfirmation ? ageChecked : true,
        }),
      });
      if (!res.ok) {
        setSubmitting(false);
        setError("Could not verify. Please try again.");
        return;
      }
      const body = (await res.json().catch(() => null)) as { verdict?: string } | null;
      if (body?.verdict === "deny") {
        setSubmitting(false);
        setDenied(true);
        return;
      }
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
      aria-label="Access verification"
      data-testid="funnel-gate"
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: "var(--color-surface, #fff)" }}
    >
      <div
        className="w-full max-w-md rounded-lg p-8 text-center"
        style={{ color: "var(--color-text, #111)" }}
      >
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
          Verify to continue
        </h1>
        <p className="mt-3 text-sm">
          This is a members-only research resource. Please confirm you are a real visitor to
          continue.
        </p>
        {denied ? (
          <p
            className="mt-4 text-sm"
            data-testid="funnel-gate-denied"
            style={{ color: "var(--color-error, #b00)" }}
          >
            We couldn&apos;t verify this request. If you believe this is a mistake, please contact
            support.
          </p>
        ) : (
          <form ref={formRef} className="mt-5 grid gap-4">
            {/* Honeypot: visually hidden, tab-skipped; a filled value is a bot. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
            />
            {turnstileSiteKey !== null ? (
              <div
                className="cf-turnstile mx-auto"
                data-sitekey={turnstileSiteKey}
                data-testid="funnel-gate-turnstile"
              />
            ) : null}
            {requireAgeConfirmation ? (
              <label className="flex items-start justify-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ageChecked}
                  onChange={(e) => setAgeChecked(e.target.checked)}
                  className="fd-checkbox mt-1"
                  data-testid="funnel-gate-age"
                />
                <span>I confirm that I am {minAge} years of age or older.</span>
              </label>
            ) : null}
            {error ? (
              <p
                className="text-sm"
                data-testid="funnel-gate-error"
                style={{ color: "var(--color-error, #b00)" }}
              >
                {error}
              </p>
            ) : null}
            <button
              type="button"
              data-testid="funnel-gate-submit"
              disabled={submitting || (requireAgeConfirmation && !ageChecked)}
              onClick={() => void submit()}
              className="fd-btn fd-btn-primary fd-btn-md"
            >
              {submitting ? "Verifying…" : "Continue"}
            </button>
            <p className="text-2xs" style={{ color: "var(--color-muted, #666)" }}>
              For research and informational use only. This page does not offer products or process
              payments.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Silent session renewer (P8) — mounted when the gate decision is "renew"
 * (session past half-life or inside outage grace). Fires one background POST
 * to slide the session cookie; renders nothing. The whole reason a shopper
 * mid-checkout is never bounced back to the interstitial: the sliding window
 * refreshes before it lapses. Fire-and-forget; a failure just means the next
 * full render re-decides.
 */
export function GateRenewer() {
  useEffect(() => {
    void fetch("/api/gate/renew", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
