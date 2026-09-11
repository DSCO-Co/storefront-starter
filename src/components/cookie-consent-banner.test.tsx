import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CookieConsentBanner } from "./cookie-consent-banner";

describe("CookieConsentBanner", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = "fd_consent=; max-age=0; path=/";
  });
  afterEach(cleanup);

  it("links the privacy policy ONLY when the store verifiably has one (D4)", async () => {
    const withPolicy = render(<CookieConsentBanner showPrivacyPolicy />);
    await screen.findByTestId("cookie-consent-banner");
    expect(withPolicy.container.querySelector('a[href="/privacy"]')).not.toBeNull();
    withPolicy.unmount();

    // A store without a legal pack gets NO link — a banner link that 404s is
    // worse than no link (mirrors ComplianceLinks' hasPrivacyPolicy gate).
    const withoutPolicy = render(<CookieConsentBanner showPrivacyPolicy={false} />);
    await screen.findByTestId("cookie-consent-banner");
    expect(withoutPolicy.container.querySelector('a[href="/privacy"]')).toBeNull();
  });

  it("does not render at all once a decision cookie exists", () => {
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("denied|banner|2026-09-09")}; path=/`;
    render(<CookieConsentBanner showPrivacyPolicy />);
    expect(screen.queryByTestId("cookie-consent-banner")).toBeNull();
  });

  // ── E5 consent granularity (2026-09-09 wave 2) ──────────────────────────

  it("accept-all and essential-only stay ONE click, posting both categories", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ outcome: "ok" })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<CookieConsentBanner />);
      fireEvent.click(await screen.findByTestId("cookie-consent-accept"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(
        String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      expect(body).toEqual({
        decision: "granted",
        categories: { analytics: true, advertising: true },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Manage choices exposes UNCHECKED per-category toggles and Save posts the split", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ outcome: "ok" })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<CookieConsentBanner />);
      fireEvent.click(await screen.findByTestId("cookie-consent-manage"));
      const analytics = screen.getByTestId<HTMLInputElement>("cookie-consent-analytics-toggle");
      const advertising = screen.getByTestId<HTMLInputElement>("cookie-consent-advertising-toggle");
      // Never pre-checked (consent is opt-in; FTC dark-pattern ban).
      expect(analytics.checked).toBe(false);
      expect(advertising.checked).toBe(false);

      fireEvent.click(analytics); // analytics yes, advertising stays no
      fireEvent.click(screen.getByTestId("cookie-consent-save"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(
        String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      expect(body).toEqual({
        decision: "granted",
        categories: { analytics: true, advertising: false },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stays up (no dismissal) when the server write fails — a choice is never pretended", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<CookieConsentBanner />);
      fireEvent.click(await screen.findByTestId("cookie-consent-decline"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("cookie-consent-banner")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
