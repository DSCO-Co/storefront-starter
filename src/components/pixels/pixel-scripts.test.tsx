/**
 * PixelScripts consent gating (gap brief docs/briefs/browser-pixel-dispatch-
 * gap-2026-09-06.md hard rule: NO third-party script before consent). The
 * component is only ever mounted by the layout for an opted-in live store —
 * these tests pin that even then, nothing renders until the exact
 * `clientConsentAllows()` predicate passes, and that the grant event flips it
 * without a reload.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PixelScripts } from "./pixel-scripts";

// next/script inserts real <script> tags asynchronously; rendering it as a
// plain passthrough keeps the assertion synchronous and network-free.
vi.mock("next/script", () => ({
  default: ({ children, src, id }: { children?: string; src?: string; id: string }) => (
    <script data-testid={id} data-src={src}>
      {children}
    </script>
  ),
}));

function setConsentRequired(required: boolean) {
  document.body.dataset.consentRequired = required ? "1" : "0";
}

describe("PixelScripts", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = "fd_consent=; max-age=0; path=/";
  });
  afterEach(() => cleanup());

  it("renders NOTHING on a consent-enforced store without a grant (no third-party bytes)", () => {
    setConsentRequired(true);
    const { container } = render(<PixelScripts pixels={{ meta: "123456789", ga4: "G-ABC123" }} />);
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });

  it("renders the vendor bootstraps on a non-enforcing (open-ecommerce) store", () => {
    setConsentRequired(false);
    const { container } = render(<PixelScripts pixels={{ meta: "123456789", ga4: "G-ABC123" }} />);
    const scripts = [...container.querySelectorAll("script")];
    expect(scripts.length).toBeGreaterThan(0);
    expect(container.innerHTML).toContain("fbevents.js");
    expect(container.innerHTML).toContain("googletagmanager.com/gtag/js?id=G-ABC123");
  });

  it("loads AFTER the banner grant lands (fd:consent-granted), without a reload", async () => {
    setConsentRequired(true);
    const { container } = render(<PixelScripts pixels={{ meta: "123456789" }} />);
    expect(container.querySelectorAll("script")).toHaveLength(0);

    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("granted|banner|2026-09-06")}; path=/`;
    window.dispatchEvent(new CustomEvent("fd:consent-granted"));

    await waitFor(() => expect(container.querySelectorAll("script").length).toBeGreaterThan(0));
  });

  it("stays inert if the grant event fires but the cookie says denied (event is a nudge, not authority)", () => {
    setConsentRequired(true);
    const { container } = render(<PixelScripts pixels={{ meta: "123456789" }} />);
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("denied|banner|2026-09-06")}; path=/`;
    window.dispatchEvent(new CustomEvent("fd:consent-granted"));
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });

  it("renders NOTHING when the browser asserts GPC — even on a non-enforcing store (F1/D1)", () => {
    setConsentRequired(false);
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    try {
      const { container } = render(
        <PixelScripts pixels={{ meta: "123456789", ga4: "G-ABC123" }} />,
      );
      expect(container.querySelectorAll("script")).toHaveLength(0);
    } finally {
      Object.defineProperty(window.navigator, "globalPrivacyControl", {
        value: undefined,
        configurable: true,
      });
    }
  });

  it("renders nothing for unsupported or malformed pixel ids", () => {
    setConsentRequired(false);
    const { container } = render(
      <PixelScripts pixels={{ tiktok: "abc", meta: "<script>bad</script>" }} />,
    );
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });
});
