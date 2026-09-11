"use client";

import { useEffect, useState } from "react";
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/consent";

/**
 * Cookie-consent banner (LOO-3050 item 2) — rendered only when the store's
 * `behavior.compliance.cookieConsent` gate is ENFORCED for this request's
 * region (the layout resolves geo and gates the mount).
 *
 * The decision is POSTed to `/api/consent`, which (1) APPEND-ONLY-persists a
 * `persons.consent_records` compliance row and (2) sets the first-party
 * `fd_consent` cookie the checkout/beacon consent gate reads server-side.
 * The banner itself no longer writes the cookie — the durable record and the
 * runtime cookie are set together, server-side, so a grant is never a cookie
 * with no matching record.
 *
 * Until a choice is made, NOTHING non-essential fires ("unknown" ≠ consent).
 *
 * `showPrivacyPolicy` mirrors the legal footer's `ComplianceLinks` gate
 * (D4): the `/privacy` alias resolves only on a store whose manifest carries
 * a privacy policy-page section — a banner link that 404s on a store
 * without a legal pack is worse than no link.
 */
export function CookieConsentBanner({
  showPrivacyPolicy = false,
}: {
  showPrivacyPolicy?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // E5 "Manage choices" expansion — per-category toggles. Both start OFF
  // (never pre-checked: consent is opt-in, and the no-pre-checked-consent
  // gate forbids a defaulted grant).
  const [manageOpen, setManageOpen] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(false);
  const [advertisingOn, setAdvertisingOn] = useState(false);

  useEffect(() => {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${CONSENT_COOKIE}=`))
      ?.slice(CONSENT_COOKIE.length + 1);
    setVisible(parseConsentCookie(match ? decodeURIComponent(match) : null) === null);
  }, []);

  if (!visible) return null;

  const decide = async (categories: { analytics: boolean; advertising: boolean }) => {
    setSubmitting(true);
    const anyGranted = categories.analytics || categories.advertising;
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: anyGranted ? "granted" : "denied",
          categories,
        }),
      });
      // Only dismiss on a confirmed server write of the cookie. On failure
      // the banner stays up rather than pretending a choice was recorded.
      if (res.ok) {
        setVisible(false);
        // Tell same-page consent-gated loaders (PixelScripts) the grant
        // landed — they re-check the cookie (per category) themselves; this
        // is only a nudge, never the authority.
        if (anyGranted) {
          window.dispatchEvent(new CustomEvent("fd:consent-granted"));
        }
        return;
      }
      setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      data-testid="cookie-consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t px-6 py-4"
      style={{
        background: "var(--color-surface, #fff)",
        borderColor: "var(--color-border, #e5e5e5)",
        color: "var(--color-text)",
      }}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          We use essential cookies to run this site. With your consent we also use cookies for
          analytics and advertising.
          {showPrivacyPolicy ? (
            <>
              {" "}
              See our{" "}
              <a href="/privacy" className="underline">
                Privacy Policy
              </a>
              .
            </>
          ) : null}
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="cookie-consent-manage"
            disabled={submitting}
            aria-expanded={manageOpen}
            onClick={() => setManageOpen((open) => !open)}
            className="fd-btn fd-btn-ghost fd-btn-sm"
          >
            Manage choices
          </button>
          <button
            type="button"
            data-testid="cookie-consent-decline"
            disabled={submitting}
            onClick={() => void decide({ analytics: false, advertising: false })}
            className="fd-btn fd-btn-ghost fd-btn-sm"
          >
            Essential only
          </button>
          <button
            type="button"
            data-testid="cookie-consent-accept"
            disabled={submitting}
            onClick={() => void decide({ analytics: true, advertising: true })}
            className="fd-btn fd-btn-primary fd-btn-sm"
          >
            Accept all
          </button>
        </div>
      </div>
      {manageOpen ? (
        <div
          data-testid="cookie-consent-manage-panel"
          className="mx-auto mt-3 flex max-w-4xl flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="fd-checkbox mt-0.5"
                data-testid="cookie-consent-analytics-toggle"
                checked={analyticsOn}
                onChange={(event) => setAnalyticsOn(event.target.checked)}
              />
              Analytics — helps us measure how the site is used.
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="fd-checkbox mt-0.5"
                data-testid="cookie-consent-advertising-toggle"
                checked={advertisingOn}
                onChange={(event) => setAdvertisingOn(event.target.checked)}
              />
              Advertising — allows ad platforms to measure and personalize.
            </label>
          </div>
          <button
            type="button"
            data-testid="cookie-consent-save"
            disabled={submitting}
            onClick={() => void decide({ analytics: analyticsOn, advertising: advertisingOn })}
            className="fd-btn fd-btn-secondary fd-btn-sm shrink-0 self-start sm:self-center"
          >
            Save choices
          </button>
        </div>
      ) : null}
    </div>
  );
}
