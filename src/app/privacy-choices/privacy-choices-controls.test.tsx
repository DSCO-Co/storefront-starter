import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivacyChoicesControls } from "./privacy-choices-controls";

/**
 * E3 (consumer-compliance remediation 2026-09-09): the privacy-choices page's
 * working controls — one-click opt-out of sale/sharing (advertising denied)
 * and one-click withdrawal of ALL non-essential consent, both recorded via
 * /api/consent with source "privacy-choices". Withdrawal is exactly as easy
 * as granting.
 */
describe("PrivacyChoicesControls (E3)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ outcome: "ok" })));
    vi.stubGlobal("fetch", fetchMock);
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = "fd_consent=; max-age=0; path=/";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("opt-out of sale/sharing denies ADVERTISING while preserving a prior analytics grant", async () => {
    // Prior split grant: analytics yes, advertising yes.
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("granted|storefront-banner|2026-09-01|11")}; path=/`;
    render(<PrivacyChoicesControls />);
    fireEvent.click(screen.getByTestId("privacy-choices-opt-out"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    );
    expect(body).toEqual({
      decision: "denied",
      categories: { analytics: true, advertising: false },
      source: "privacy-choices",
    });
    expect((await screen.findByTestId("privacy-choices-status")).textContent).toContain(
      "opted out",
    );
  });

  it("withdraw-all denies BOTH categories in one click", async () => {
    render(<PrivacyChoicesControls />);
    fireEvent.click(screen.getByTestId("privacy-choices-withdraw"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    );
    expect(body).toEqual({
      decision: "denied",
      categories: { analytics: false, advertising: false },
      source: "privacy-choices",
    });
  });

  it("a failed write is reported honestly — never claimed as saved", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    render(<PrivacyChoicesControls />);
    fireEvent.click(screen.getByTestId("privacy-choices-withdraw"));
    await waitFor(() =>
      expect(screen.getByTestId("privacy-choices-status").textContent).toContain("NOT saved"),
    );
  });
});
