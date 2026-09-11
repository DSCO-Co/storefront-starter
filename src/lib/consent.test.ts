import { describe, expect, it } from "vitest";
import {
  type ConsentSignal,
  categoryAllowed,
  consentCategories,
  gpcHeaderDenied,
  nonEssentialAllowed,
  parseConsentCookie,
  serializeConsent,
  signalCategories,
} from "@/lib/consent";
import { resolvePolicyAlias } from "@/lib/policy-aliases";

describe("consent signal (beacon consentSchema shape)", () => {
  it("round-trips through the cookie", () => {
    const signal: ConsentSignal = {
      adTracking: "granted",
      source: "storefront-banner",
      capturedAt: "2026-08-16T12:00:00.000Z",
    };
    expect(parseConsentCookie(serializeConsent(signal))).toEqual(signal);
  });

  it("rejects garbage values (a mangled cookie is no signal, not a grant)", () => {
    expect(parseConsentCookie("yes")).toBeNull();
    expect(parseConsentCookie("")).toBeNull();
    expect(parseConsentCookie(null)).toBeNull();
  });

  it("gates non-essential strictly when consent is enabled: only explicit granted passes", () => {
    expect(nonEssentialAllowed(true, null)).toBe(false);
    expect(nonEssentialAllowed(true, { adTracking: "unknown" })).toBe(false);
    expect(nonEssentialAllowed(true, { adTracking: "denied" })).toBe(false);
    expect(nonEssentialAllowed(true, { adTracking: "granted" })).toBe(true);
  });

  it("open-ecommerce default (banner off) leaves today's behavior untouched", () => {
    expect(nonEssentialAllowed(false, null)).toBe(true);
  });
});

describe("consent categories (E5 granularity, 2026-09-09 wave 2)", () => {
  const analyticsOnly: ConsentSignal = {
    adTracking: "denied",
    source: "storefront-banner",
    capturedAt: "2026-09-09T12:00:00.000Z",
    categories: { analytics: true, advertising: false },
  };

  it("round-trips the categories field through the cookie", () => {
    expect(parseConsentCookie(serializeConsent(analyticsOnly))).toEqual(analyticsOnly);
    expect(serializeConsent(analyticsOnly)).toContain("|10");
  });

  it("a LEGACY cookie (no 4th field) keeps all-or-nothing semantics", () => {
    const legacy = parseConsentCookie("granted|banner|2026-01-01");
    expect(legacy?.categories).toBeUndefined();
    expect(signalCategories(legacy)).toEqual({ analytics: true, advertising: true });
    expect(signalCategories(parseConsentCookie("denied|banner|2026-01-01"))).toEqual({
      analytics: false,
      advertising: false,
    });
  });

  it("a mangled categories field is ignored, never read as a grant", () => {
    const mangled = parseConsentCookie("denied|banner|2026-01-01|xx");
    expect(mangled?.categories).toBeUndefined();
    expect(signalCategories(mangled)).toEqual({ analytics: false, advertising: false });
  });

  it("categoryAllowed gates per category on an enforcing store", () => {
    expect(categoryAllowed(true, analyticsOnly, "analytics")).toBe(true);
    expect(categoryAllowed(true, analyticsOnly, "advertising")).toBe(false);
    expect(categoryAllowed(true, null, "analytics")).toBe(false);
    expect(categoryAllowed(false, null, "advertising")).toBe(true); // open default
  });

  it("nonEssentialAllowed (the advertising gate) denies an analytics-only grant", () => {
    expect(nonEssentialAllowed(true, analyticsOnly)).toBe(false);
  });

  it("maps advertising onto the persisted record's `marketing` key", () => {
    expect(consentCategories(analyticsOnly)).toEqual({ analytics: true, marketing: false });
  });
});

describe("Global Privacy Control header (compliance remediation 2026-09-09, F1)", () => {
  it("recognizes Sec-GPC: 1 (case-insensitive header, tolerant of whitespace)", () => {
    expect(gpcHeaderDenied(new Headers({ "Sec-GPC": "1" }))).toBe(true);
    expect(gpcHeaderDenied(new Headers({ "sec-gpc": " 1 " }))).toBe(true);
  });

  it("anything else is NOT an opt-out signal", () => {
    expect(gpcHeaderDenied(new Headers())).toBe(false);
    expect(gpcHeaderDenied(new Headers({ "sec-gpc": "0" }))).toBe(false);
    expect(gpcHeaderDenied(new Headers({ "sec-gpc": "true" }))).toBe(false);
  });
});

describe("policy path aliases (LOO-3050)", () => {
  it("maps the conventional legal paths onto /policies/*", () => {
    expect(resolvePolicyAlias("/terms")).toBe("/policies/terms");
    expect(resolvePolicyAlias("/privacy")).toBe("/policies/privacy");
    expect(resolvePolicyAlias("/shipping-returns")).toBe("/policies/shipping-returns");
    expect(resolvePolicyAlias("/ruo-terms")).toBe("/policies/ruo-terms");
  });

  it("passes every other path through unchanged", () => {
    expect(resolvePolicyAlias("/")).toBe("/");
    expect(resolvePolicyAlias("/products/lean")).toBe("/products/lean");
    expect(resolvePolicyAlias("/policies/terms")).toBe("/policies/terms");
  });
});
