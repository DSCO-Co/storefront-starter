import { describe, expect, it } from "vitest";
import { cookieConsentEnforced, regionRequiresConsent, resolveRequestGeo } from "@/lib/region";

describe("region resolution (LOO-3050)", () => {
  it("reads Vercel geo headers, uppercasing country + subdivision", () => {
    const h = new Headers({ "x-vercel-ip-country": "de", "x-vercel-ip-country-region": "by" });
    expect(resolveRequestGeo(h)).toEqual({ country: "DE", region: "BY" });
  });

  it("falls back to Cloudflare's cf-ipcountry for the country", () => {
    const h = new Headers({ "cf-ipcountry": "GB" });
    expect(resolveRequestGeo(h)).toEqual({ country: "GB", region: null });
  });

  it("returns null country when no geo signal is present (never guessed)", () => {
    expect(resolveRequestGeo(new Headers())).toEqual({ country: null, region: null });
  });
});

describe("regionRequiresConsent", () => {
  it("'all' gates everyone", () => {
    expect(regionRequiresConsent("all", { country: "US", region: "TX" })).toBe(true);
    expect(regionRequiresConsent("all", { country: null, region: null })).toBe(true);
  });

  it("'eu-uk' gates EU/EEA + UK, not the US", () => {
    expect(regionRequiresConsent("eu-uk", { country: "DE", region: null })).toBe(true);
    expect(regionRequiresConsent("eu-uk", { country: "GB", region: null })).toBe(true);
    expect(regionRequiresConsent("eu-uk", { country: "US", region: "NY" })).toBe(false);
  });

  it("'us-ca' gates only California", () => {
    expect(regionRequiresConsent("us-ca", { country: "US", region: "CA" })).toBe(true);
    expect(regionRequiresConsent("us-ca", { country: "US", region: "NY" })).toBe(false);
    expect(regionRequiresConsent("us-ca", { country: "DE", region: null })).toBe(false);
  });

  it("fails CLOSED on unknown geo for any targeted region", () => {
    expect(regionRequiresConsent("eu-uk", { country: null, region: null })).toBe(true);
    expect(regionRequiresConsent("us-ca", { country: null, region: null })).toBe(true);
  });
});

describe("cookieConsentEnforced", () => {
  it("is false when the store disabled the gate, regardless of region", () => {
    expect(
      cookieConsentEnforced({ enabled: false, regions: "all" }, { country: "DE", region: null }),
    ).toBe(false);
  });

  it("enforces only for targeted regions when enabled", () => {
    const cfg = { enabled: true, regions: "eu-uk" as const };
    expect(cookieConsentEnforced(cfg, { country: "DE", region: null })).toBe(true);
    expect(cookieConsentEnforced(cfg, { country: "US", region: "NY" })).toBe(false);
  });

  // Consumer-compliance remediation 2026-09-09 (F8): CIPA does not respect
  // the store's region-targeting choice — California is ALWAYS enforced.
  it("ALWAYS enforces for a California visitor, whatever regions the store targeted", () => {
    const geo = { country: "US", region: "CA" };
    expect(cookieConsentEnforced({ enabled: true, regions: "eu-uk" }, geo)).toBe(true);
    expect(cookieConsentEnforced({ enabled: true, regions: "us-ca" }, geo)).toBe(true);
    expect(cookieConsentEnforced({ enabled: true, regions: "all" }, geo)).toBe(true);
  });

  it("still fails CLOSED on unknown geo for a targeted store (unknown could be California)", () => {
    expect(
      cookieConsentEnforced({ enabled: true, regions: "eu-uk" }, { country: null, region: null }),
    ).toBe(true);
  });

  // ── kill-switch tightening (2026-09-09 wave 2) ──────────────────────────
  it("IGNORES enabled:false when the store has browser tracking — a tracking store cannot opt out of the banner", () => {
    const cfg = { enabled: false, regions: "all" as const };
    expect(cookieConsentEnforced(cfg, { country: "DE", region: null }, true)).toBe(true);
    expect(cookieConsentEnforced(cfg, { country: "US", region: "CA" }, true)).toBe(true);
    // Without tracking, the disable flag still works as before.
    expect(cookieConsentEnforced(cfg, { country: "DE", region: null }, false)).toBe(false);
  });

  it("with tracking + enabled:false, region targeting (incl. always-CA) still decides", () => {
    const cfg = { enabled: false, regions: "eu-uk" as const };
    expect(cookieConsentEnforced(cfg, { country: "US", region: "NY" }, true)).toBe(false);
    expect(cookieConsentEnforced(cfg, { country: "US", region: "CA" }, true)).toBe(true);
    expect(cookieConsentEnforced(cfg, { country: "DE", region: null }, true)).toBe(true);
  });
});
