import { describe, expect, it } from "vitest";
import bioArchetype from "@/fixtures/manifests/store-0-bio-archetype.json";
import {
  isNoindex,
  resolveBehavior,
  storeHasBrowserTracking,
  storeManifestSchema,
} from "@/lib/manifest";

describe("manifest v0 schema", () => {
  it("accepts the bundled fixtures", () => {
    expect(() => storeManifestSchema.parse(bioArchetype)).not.toThrow();
  });

  it("is lenient about unknown fields (newer manifest, older renderer)", () => {
    const parsed = storeManifestSchema.parse({
      ...bioArchetype,
      futureField: { anything: true },
      brand: { ...bioArchetype.brand, futureBrandField: "x" },
    });
    expect(parsed.brand.name).toBe("Helix Bio Labs (Demo)");
  });

  it("rejects a manifest with the wrong version", () => {
    expect(() => storeManifestSchema.parse({ ...bioArchetype, version: 1 })).toThrow();
  });

  it("noindexes preview stores", () => {
    const manifest = storeManifestSchema.parse(bioArchetype);
    expect(isNoindex(manifest)).toBe(true);
  });

  it("noindexes Store #0 EVEN IF preview were flipped off", () => {
    const manifest = storeManifestSchema.parse({ ...bioArchetype, preview: false });
    expect(isNoindex(manifest)).toBe(true);
  });
});

describe("resolveBehavior — search (LOO-3134)", () => {
  it("defaults ON with typeahead (backward compat): search renders fleet-wide today", () => {
    const manifest = storeManifestSchema.parse(bioArchetype);
    expect(resolveBehavior(manifest).search).toEqual({ enabled: true, typeahead: true });
  });

  it("resolves explicit opt-outs, including typeahead-only", () => {
    const off = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { search: { enabled: false } },
    });
    expect(resolveBehavior(off).search.enabled).toBe(false);

    const plainForm = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { search: { typeahead: false } },
    });
    expect(resolveBehavior(plainForm).search).toEqual({ enabled: true, typeahead: false });
  });

  it("a malformed value degrades to the DEFAULT (on), never fails the manifest", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { search: { enabled: "nope" } },
    });
    expect(resolveBehavior(manifest).search.enabled).toBe(true);
  });
});

describe("resolveBehavior — subscriptions (LOO-3154)", () => {
  it("defaults OFF with no cadences: Subscribe & Save is opt-in per store", () => {
    const manifest = storeManifestSchema.parse(bioArchetype);
    expect(resolveBehavior(manifest).subscriptions).toEqual({
      autoEnrollBundles: false,
      enabled: false,
      discounts: {},
    });
  });

  it("resolves the enabled switch and the interval→pct discount map", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { subscriptions: { enabled: true, discounts: { "30": 10, "60": 15 } } },
    });
    const resolved = resolveBehavior(manifest).subscriptions;
    expect(resolved.enabled).toBe(true);
    expect(resolved.discounts).toEqual({ "30": 10, "60": 15 });
  });

  it("a malformed discounts value degrades to {} (off), never fails the manifest", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { subscriptions: { enabled: true, discounts: "10-percent" } },
    });
    expect(resolveBehavior(manifest).subscriptions.discounts).toEqual({});
  });
});

describe("resolveBehavior — accounts (LOO-3133)", () => {
  it("defaults ON (backward compat): a store with no opinion keeps accounts", () => {
    const manifest = storeManifestSchema.parse(bioArchetype);
    expect(resolveBehavior(manifest).accounts).toEqual({
      enabled: true,
      // passkeys defaults FALSE: no passkey surface exists yet, so an
      // unopinionated store must not claim one.
      passkeys: false,
      orderHistory: true,
      subscriptionSelfServe: true,
      addressBook: false,
    });
  });

  it("resolves explicit opt-outs per sub-flag", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: {
        accounts: { enabled: true, passkeys: false, orderHistory: false },
      },
    });
    const accounts = resolveBehavior(manifest).accounts;
    expect(accounts.enabled).toBe(true);
    expect(accounts.passkeys).toBe(false);
    expect(accounts.orderHistory).toBe(false);
    // Untouched sub-flags keep their defaults.
    expect(accounts.subscriptionSelfServe).toBe(true);
  });

  it("enabled:false turns the whole surface off", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { accounts: { enabled: false } },
    });
    expect(resolveBehavior(manifest).accounts.enabled).toBe(false);
  });

  it("a malformed value degrades to the DEFAULT (on), never fails the manifest", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { accounts: { enabled: "nope" } },
    });
    expect(resolveBehavior(manifest).accounts.enabled).toBe(true);
  });

  // ── self-serve guard (consumer-compliance remediation 2026-09-09 wave 2) ─
  it("IGNORES subscriptionSelfServe:false when the store sells subscriptions (ARL: cannot hide the cancel surface)", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: {
        accounts: { subscriptionSelfServe: false },
        subscriptions: { enabled: true, discounts: { "30": 10 } },
      },
    });
    expect(resolveBehavior(manifest).accounts.subscriptionSelfServe).toBe(true);
  });

  it("honors subscriptionSelfServe:false on a store that does NOT sell subscriptions", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { accounts: { subscriptionSelfServe: false } },
    });
    expect(resolveBehavior(manifest).accounts.subscriptionSelfServe).toBe(false);
  });
});

describe("storeHasBrowserTracking (kill-switch tightening, 2026-09-09 wave 2)", () => {
  it("true when browserPixelEnabled, or when any pixel id is configured", () => {
    const withFlag = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { analytics: { browserPixelEnabled: true } },
    });
    expect(storeHasBrowserTracking(withFlag, resolveBehavior(withFlag))).toBe(true);

    const withPixel = storeManifestSchema.parse({
      ...bioArchetype,
      refs: { ...bioArchetype.refs, pixels: { meta: "123456789" } },
    });
    expect(storeHasBrowserTracking(withPixel, resolveBehavior(withPixel))).toBe(true);
  });

  it("false for a store with no pixel flag and no configured pixel ids", () => {
    const bare = storeManifestSchema.parse({
      ...bioArchetype,
      refs: { ...bioArchetype.refs, pixels: { meta: "  " } },
    });
    expect(storeHasBrowserTracking(bare, resolveBehavior(bare))).toBe(false);
  });
});

describe("resolveBehavior — shipping interval labels (E1, 2026-09-09 wave 2)", () => {
  it("defaults to null (renderer falls back to the conservative platform labels)", () => {
    const manifest = storeManifestSchema.parse(bioArchetype);
    const shipping = resolveBehavior(manifest).shipping;
    expect(shipping.standardTransitLabel).toBeNull();
    expect(shipping.expeditedTransitLabel).toBeNull();
  });

  it("carries store-configured labels through", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: {
        shipping: {
          standardTransitLabel: "Ground (4–8 business days)",
          expeditedTransitLabel: "Express (1–2 business days)",
        },
      },
    });
    const shipping = resolveBehavior(manifest).shipping;
    expect(shipping.standardTransitLabel).toBe("Ground (4–8 business days)");
    expect(shipping.expeditedTransitLabel).toBe("Express (1–2 business days)");
  });
});

describe("resolveBehavior — comms.emailCapture (LOO-3132)", () => {
  it("defaults to disabled with footer placement: a store with no opinion has no capture surface", () => {
    const manifest = storeManifestSchema.parse(bioArchetype);
    expect(resolveBehavior(manifest).comms.emailCapture).toEqual({
      enabled: false,
      sequenceRef: null,
      placement: "footer",
    });
  });

  it("resolves the full block when the manifest opts in", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: {
        comms: {
          emailCapture: { enabled: true, sequenceRef: "welcome-drip", placement: "section" },
        },
      },
    });
    expect(resolveBehavior(manifest).comms.emailCapture).toEqual({
      enabled: true,
      sequenceRef: "welcome-drip",
      placement: "section",
    });
  });

  it("a malformed block degrades to absent (disabled), never fails the manifest", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { comms: { emailCapture: { enabled: "yes", placement: 42 } } },
    });
    expect(resolveBehavior(manifest).comms.emailCapture.enabled).toBe(false);
  });
});

describe("resolveBehavior — checkout.testOrder (LOO-3049)", () => {
  it("defaults to false: a store with no opinion has no test-order lane", () => {
    const manifest = storeManifestSchema.parse(bioArchetype);
    expect(resolveBehavior(manifest).checkout.testOrder).toBe(false);
  });

  it("resolves true only when the manifest sets it explicitly", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { checkout: { testOrder: true } },
    });
    expect(resolveBehavior(manifest).checkout.testOrder).toBe(true);
  });

  it("a malformed value degrades to absent (false), never fails the manifest", () => {
    const manifest = storeManifestSchema.parse({
      ...bioArchetype,
      behavior: { checkout: { testOrder: "yes" } },
    });
    expect(resolveBehavior(manifest).checkout.testOrder).toBe(false);
  });
});

describe("theme.customCss lenient read (LOO-3167)", () => {
  it("keeps a string sheet", () => {
    const parsed = storeManifestSchema.parse({
      ...bioArchetype,
      theme: { ...bioArchetype.theme, customCss: ".hero { color: red; }" },
    });
    expect(parsed.theme.customCss).toBe(".hero { color: red; }");
  });

  it("degrades a malformed value to absent — the store renders, just without its custom CSS", () => {
    const parsed = storeManifestSchema.parse({
      ...bioArchetype,
      theme: { ...bioArchetype.theme, customCss: 42 },
    });
    expect(parsed.theme.customCss).toBeUndefined();
    expect(parsed.theme.tokens).toBeTruthy();
  });
});
