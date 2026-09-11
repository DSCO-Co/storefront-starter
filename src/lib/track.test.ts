/**
 * The browser tracking helper's pixel leg (gap brief
 * docs/briefs/browser-pixel-dispatch-gap-2026-09-06.md):
 *  - the SAME minted event id reaches BOTH `/api/track` (server → beacon →
 *    CAPI) and the vendor pixel call — the dedup contract;
 *  - consent short-circuits BOTH legs (no round-trip, no pixel fire);
 *  - a raw lead email NEVER reaches a pixel;
 *  - no vendor stub loaded (store without pixels) = silent no-op, no throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "./track";

type FbqCall = readonly unknown[];

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
  }
}

const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

function setConsentRequired(required: boolean) {
  document.body.dataset.consentRequired = required ? "1" : "0";
}

describe("track() — pixel leg + shared event id", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    setConsentRequired(false);
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = "fd_consent=; max-age=0; path=/";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockClear();
    window.fbq = undefined;
    window.gtag = undefined;
  });

  it("fires server and pixel legs with the IDENTICAL minted event id (Meta eventID / GA4 event_id)", () => {
    const fbqCalls: FbqCall[] = [];
    const gtagCalls: FbqCall[] = [];
    window.fbq = (...args: unknown[]) => void fbqCalls.push(args);
    window.gtag = (...args: unknown[]) => void gtagCalls.push(args);

    track({ eventType: "VIEW_CONTENT", productId: "prod-1", priceCents: 4500 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body)) as { eventId?: string };
    expect(body.eventId).toMatch(/^vc_/);

    expect(fbqCalls).toHaveLength(1);
    const [, metaName, metaData, metaOptions] = fbqCalls[0] ?? [];
    expect(metaName).toBe("ViewContent");
    expect(metaData).toMatchObject({ value: 45, content_ids: ["prod-1"] });
    expect(metaOptions).toEqual({ eventID: body.eventId });

    expect(gtagCalls).toHaveLength(1);
    const [, ga4Name, ga4Params] = gtagCalls[0] ?? [];
    expect(ga4Name).toBe("view_item");
    expect(ga4Params).toMatchObject({ event_id: body.eventId });
  });

  it("fires NEITHER leg when consent is enforced and not granted", () => {
    setConsentRequired(true);
    const fbqCalls: FbqCall[] = [];
    window.fbq = (...args: unknown[]) => void fbqCalls.push(args);

    track({ eventType: "ADD_TO_CART", variantId: "var-1", unitPriceCents: 4500, quantity: 2 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fbqCalls).toHaveLength(0);
  });

  it("fires BOTH legs once consent is granted on an enforced store", () => {
    setConsentRequired(true);
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("granted|banner|2026-09-06")}; path=/`;
    const fbqCalls: FbqCall[] = [];
    window.fbq = (...args: unknown[]) => void fbqCalls.push(args);

    track({ eventType: "SEARCH", query: "bpc" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fbqCalls).toHaveLength(1);
  });

  it("NEVER forwards the raw lead email to a pixel (hashing is beacon's server-side job)", () => {
    const fbqCalls: FbqCall[] = [];
    window.fbq = (...args: unknown[]) => void fbqCalls.push(args);

    track({ eventType: "LEAD_CAPTURED", email: "shopper@example.com" });

    expect(fbqCalls).toHaveLength(1);
    expect(JSON.stringify(fbqCalls[0])).not.toContain("shopper@example.com");
    // The server leg DOES carry it (beacon hashes on egress) — unchanged.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(String(init?.body)).toContain("shopper@example.com");
  });

  // ── E5 consent granularity (2026-09-09 wave 2) ──────────────────────────

  it("analytics-only consent: server leg fires, pixel leg does NOT", () => {
    setConsentRequired(true);
    // 4th cookie field "10" = analytics granted, advertising denied.
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("denied|banner|2026-09-09|10")}; path=/`;
    const fbqCalls: FbqCall[] = [];
    window.fbq = (...args: unknown[]) => void fbqCalls.push(args);

    track({ eventType: "SEARCH", query: "bpc" });

    expect(fetchMock).toHaveBeenCalledTimes(1); // /api/track splits per category server-side
    expect(fbqCalls).toHaveLength(0); // pixels are the advertising leg
  });

  it("advertising-only consent: BOTH legs fire (pixels + server)", () => {
    setConsentRequired(true);
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("granted|banner|2026-09-09|01")}; path=/`;
    const fbqCalls: FbqCall[] = [];
    window.fbq = (...args: unknown[]) => void fbqCalls.push(args);

    track({ eventType: "SEARCH", query: "bpc" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fbqCalls).toHaveLength(1);
  });

  // ── Global Privacy Control (compliance remediation 2026-09-09, F1/D1) ───

  it("fires NEITHER leg when the browser asserts GPC — even on a non-enforcing store", () => {
    setConsentRequired(false);
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    const fbqCalls: FbqCall[] = [];
    window.fbq = (...args: unknown[]) => void fbqCalls.push(args);
    try {
      track({ eventType: "SEARCH", query: "bpc" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fbqCalls).toHaveLength(0);
    } finally {
      Object.defineProperty(window.navigator, "globalPrivacyControl", {
        value: undefined,
        configurable: true,
      });
    }
  });

  it("GPC wins over a GRANTED consent cookie (stateless, per-request)", () => {
    setConsentRequired(true);
    // biome-ignore lint/suspicious/noDocumentCookie: test arranges the consent cookie directly; the Cookie Store API is unavailable in jsdom.
    document.cookie = `fd_consent=${encodeURIComponent("granted|banner|2026-09-06")}; path=/`;
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    try {
      track({ eventType: "SEARCH", query: "bpc" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "globalPrivacyControl", {
        value: undefined,
        configurable: true,
      });
    }
  });

  it("is a silent no-op pixel-side when no vendor stub is loaded (store without pixels)", () => {
    expect(() =>
      track({ eventType: "VIEW_CONTENT", productId: "prod-1", priceCents: 100 }),
    ).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
