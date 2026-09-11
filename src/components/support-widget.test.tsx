/**
 * SupportWidget consent gating (consumer-compliance remediation 2026-09-09,
 * F8/D2): Chatwoot is a third-party script and mounts behind the SAME
 * non-essential consent predicate as the pixels — no SDK injection before a
 * grant, late-mount on `fd:consent-granted`, GPC honored.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupportWidget } from "./support-widget";

// next/script inserts real <script> tags asynchronously; rendering it as a
// plain passthrough keeps the assertion synchronous and network-free.
vi.mock("next/script", () => ({
  default: ({
    id,
    dangerouslySetInnerHTML,
  }: {
    id: string;
    dangerouslySetInnerHTML?: { __html: string };
  }) => (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: test passthrough stub for next/script
    <script data-testid={id} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />
  ),
}));

function setConsentRequired(required: boolean) {
  document.body.dataset.consentRequired = required ? "1" : "0";
}

describe("SupportWidget", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_BASE_URL", "https://support.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_WEBSITE_TOKEN", "tok_test");
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = "fd_consent=; max-age=0; path=/";
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    cleanup();
  });

  it("renders NOTHING on a consent-enforced store without a grant (no SDK bytes)", () => {
    setConsentRequired(true);
    const { container } = render(<SupportWidget />);
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });

  it("renders the SDK loader on a non-enforcing (open-ecommerce) store", () => {
    setConsentRequired(false);
    const { container } = render(<SupportWidget />);
    expect(container.innerHTML).toContain("chatwootSDK");
  });

  it("mounts AFTER the banner grant lands (fd:consent-granted), without a reload", async () => {
    setConsentRequired(true);
    const { container } = render(<SupportWidget />);
    expect(container.querySelectorAll("script")).toHaveLength(0);

    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("granted|banner|2026-09-09")}; path=/`;
    window.dispatchEvent(new CustomEvent("fd:consent-granted"));

    await waitFor(() => expect(container.querySelectorAll("script").length).toBeGreaterThan(0));
  });

  it("stays inert if the grant event fires but the cookie says denied", () => {
    setConsentRequired(true);
    const { container } = render(<SupportWidget />);
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("denied|banner|2026-09-09")}; path=/`;
    window.dispatchEvent(new CustomEvent("fd:consent-granted"));
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });

  it("renders NOTHING when the browser asserts GPC — even on a non-enforcing store", () => {
    setConsentRequired(false);
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    try {
      const { container } = render(<SupportWidget />);
      expect(container.querySelectorAll("script")).toHaveLength(0);
    } finally {
      Object.defineProperty(window.navigator, "globalPrivacyControl", {
        value: undefined,
        configurable: true,
      });
    }
  });

  it("renders nothing when the support env is unset (store without support)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_BASE_URL", "");
    setConsentRequired(false);
    const { container } = render(<SupportWidget />);
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });
});
