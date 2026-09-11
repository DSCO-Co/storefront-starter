"use client";

import { useState } from "react";
import { CONSENT_COOKIE, parseConsentCookie, signalCategories } from "@/lib/consent";

/**
 * Working privacy controls (E3, consumer-compliance remediation 2026-09-09):
 * the CCPA/CPRA opt-out of sale/sharing and the GDPR-shaped withdrawal of ALL
 * non-essential consent — each ONE click, exactly as easy as granting was.
 *
 * Both POST to `/api/consent` (source: "privacy-choices"), which persists an
 * append-only consent record AND resets the `fd_consent` cookie so every
 * server/client gate sees the new state immediately:
 *  - "Opt out of sale/sharing" denies the ADVERTISING category (the
 *    cross-context behavioral-advertising leg — pixels, CAPI forwarding),
 *    leaving a previously granted analytics choice untouched;
 *  - "Withdraw all non-essential consent" denies BOTH categories — the
 *    cookie is reset to essential-only.
 *
 * A failed write is shown honestly — never a "you're opted out" claim the
 * server didn't confirm.
 */

type Status =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "done"; message: string }
  | { state: "error" };

function currentAnalyticsChoice(): boolean {
  if (typeof document === "undefined") return false;
  const raw = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  const signal = parseConsentCookie(raw ? decodeURIComponent(raw) : null);
  return signalCategories(signal).analytics;
}

export function PrivacyChoicesControls() {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const submit = async (categories: { analytics: boolean; advertising: boolean }, done: string) => {
    setStatus({ state: "submitting" });
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "denied", categories, source: "privacy-choices" }),
      });
      if (res.ok) {
        setStatus({ state: "done", message: done });
        return;
      }
      setStatus({ state: "error" });
    } catch {
      setStatus({ state: "error" });
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-3" data-testid="privacy-choices-controls">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="fd-btn fd-btn-primary fd-btn-sm"
          data-testid="privacy-choices-opt-out"
          disabled={status.state === "submitting"}
          onClick={() =>
            void submit(
              { analytics: currentAnalyticsChoice(), advertising: false },
              "You are opted out of the sale/sharing of your personal information on this device.",
            )
          }
        >
          Opt out of sale/sharing
        </button>
        <button
          type="button"
          className="fd-btn fd-btn-secondary fd-btn-sm"
          data-testid="privacy-choices-withdraw"
          disabled={status.state === "submitting"}
          onClick={() =>
            void submit(
              { analytics: false, advertising: false },
              "All non-essential consent has been withdrawn — only essential cookies remain.",
            )
          }
        >
          Withdraw all non-essential consent
        </button>
      </div>
      {/* Outcome, announced politely for assistive tech (D6 live-region
          pattern, self-contained here so this page works standalone). */}
      <p aria-live="polite" className="text-sm" data-testid="privacy-choices-status">
        {status.state === "done" ? status.message : null}
        {status.state === "error"
          ? "We couldn't record your choice just now. Please try again — your request was NOT saved."
          : null}
      </p>
    </div>
  );
}
