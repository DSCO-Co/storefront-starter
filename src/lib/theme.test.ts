import { describe, expect, it } from "vitest";
import { flattenTokens } from "@/lib/tokens";

import {
  camelAliasVars,
  deriveTokenVars,
  isDarkColor,
  mixColors,
  parseCssColor,
  readThemeVariants,
  relativeLuminance,
  serializeColor,
  themeToRootCss,
  withAlpha,
} from "./theme";

/** The core-six-only token set today's simplest store could ship. */
const CORE_LIGHT = {
  color: {
    primary: { $value: "#162944" },
    accent: { $value: "#aa764b" },
    background: { $value: "#ffffff" },
    surface: { $value: "#ffffff" },
    text: { $value: "#162944" },
    muted: { $value: "#666666" },
  },
  font: {
    body: { $value: "var(--font-inter), sans-serif" },
    heading: { $value: "var(--font-fraunces), serif" },
  },
};

const CORE_DARK = {
  color: {
    primary: { $value: "#5262ff" },
    accent: { $value: "#5262ff" },
    background: { $value: "#05070d" },
    surface: { $value: "#0a0f1f" },
    text: { $value: "#f6f8ff" },
    muted: { $value: "#8b96c2" },
  },
};

describe("color math", () => {
  it("parses hex forms and rgb()/rgba()", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#05070d")).toEqual({ r: 5, g: 7, b: 13, a: 1 });
    expect(parseCssColor("#05070d80")?.a).toBeCloseTo(0.5, 1);
    expect(parseCssColor("rgb(82, 98, 255)")).toEqual({ r: 82, g: 98, b: 255, a: 1 });
    expect(parseCssColor("rgba(82, 98, 255, 0.28)")?.a).toBeCloseTo(0.28);
  });

  it("returns null (never a guess) for unparseable values", () => {
    expect(parseCssColor("var(--x)")).toBeNull();
    expect(parseCssColor("hsl(214 50% 17%)")).toBeNull();
    expect(parseCssColor("navy")).toBeNull();
  });

  it("mixes, alphas and serializes", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(serializeColor(mixColors(black, white, 0.5))).toBe("#808080");
    expect(serializeColor(withAlpha(white, 0.5))).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("classifies dark vs light grounds", () => {
    const dark = parseCssColor("#05070d");
    const light = parseCssColor("#ffffff");
    if (!dark || !light) throw new Error("parse failed");
    expect(isDarkColor(dark)).toBe(true);
    expect(isDarkColor(light)).toBe(false);
    expect(relativeLuminance(light)).toBeCloseTo(1);
  });
});

describe("deriveTokenVars", () => {
  it("derives the full extended vocabulary from a core-six light store", () => {
    const derived = deriveTokenVars(flattenTokens(CORE_LIGHT));
    // Surface ladder + ink scale + lines all exist and parse as colors.
    for (const name of [
      "--color-surface-1",
      "--color-surface-2",
      "--color-surface-3",
      "--color-surface-muted",
      "--color-ink-1",
      "--color-ink-2",
      "--color-ink-4",
      "--color-line",
      "--color-line-soft",
      "--color-accent-2",
      "--color-glow",
      "--color-glow-soft",
      "--color-surface-inverse",
      "--color-inverse-text",
      "--color-inverse-muted",
    ]) {
      const value = derived.get(name);
      expect(value, name).toBeTruthy();
      expect(parseCssColor(value ?? ""), `${name} = ${value}`).not.toBeNull();
    }
    // ink-3 reuses the declared muted role.
    expect(derived.get("--color-ink-3")).toBe("#666666");
    // Light ground → inverse band is the brand primary, with readable ink.
    expect(derived.get("--color-surface-inverse")).toBe("#162944");
    const inverseText = parseCssColor(derived.get("--color-inverse-text") ?? "");
    if (!inverseText) throw new Error("inverse text unparseable");
    expect(isDarkColor(inverseText)).toBe(false);
    // Type + shape + motion defaults.
    expect(derived.get("--font-display")).toBe("var(--font-fraunces), serif");
    expect(derived.get("--font-data")).toContain("jetbrains-mono");
    expect(derived.get("--font-heading-weight")).toBe("500");
    expect(derived.get("--radius-button")).toBe("9999px");
    expect(derived.get("--motion-ease")).toContain("cubic-bezier");
  });

  it("derives dark-ground elevations LIGHTER than the background", () => {
    const flattened = flattenTokens(CORE_DARK);
    const derived = deriveTokenVars(flattened);
    const bg = parseCssColor("#05070d");
    const s2 = parseCssColor(derived.get("--color-surface-2") ?? "");
    const s3 = parseCssColor(derived.get("--color-surface-3") ?? "");
    if (!bg || !s2 || !s3) throw new Error("parse failed");
    expect(relativeLuminance(s2)).toBeGreaterThan(relativeLuminance(bg));
    expect(relativeLuminance(s3)).toBeGreaterThan(relativeLuminance(s2));
    // Dark ground → the "inverse" band is a lifted elevation, ink stays light.
    const inverse = parseCssColor(derived.get("--color-surface-inverse") ?? "");
    if (!inverse) throw new Error("parse failed");
    expect(isDarkColor(inverse)).toBe(true);
    expect(derived.get("--color-inverse-text")).toBe("#f6f8ff");
  });

  it("never overwrites an explicitly declared extended token", () => {
    // NOTE the spelling: digit-suffixed extended roles are declared with the
    // hyphen IN THE KEY ("surface-1", "accent-2") — the flattener's kebab-case
    // only splits camelCase, so "surface1" would flatten to --color-surface1,
    // a name nothing consumes.
    const explicit = {
      ...CORE_DARK,
      color: {
        ...CORE_DARK.color,
        "surface-1": { $value: "#111111" },
        "accent-2": { $value: "#8fa2ff" },
        glow: { $value: "rgba(82, 98, 255, 0.28)" },
      },
      font: { headingWeight: { $value: 300 } },
    };
    const flattened = flattenTokens(explicit);
    const derived = deriveTokenVars(flattened);
    expect(flattened.get("--color-surface-1")).toBe("#111111");
    expect(derived.has("--color-surface-1")).toBe(false);
    expect(derived.has("--color-accent-2")).toBe(false);
    expect(derived.has("--color-glow")).toBe(false);
    expect(derived.has("--font-heading-weight")).toBe(false);
  });

  it("skips color derivation (no guesses) when the ground is unparseable, keeping structural defaults", () => {
    const derived = deriveTokenVars(
      flattenTokens({ color: { background: { $value: "var(--external)" } } }),
    );
    expect(derived.has("--color-surface-2")).toBe(false);
    expect(derived.has("--color-ink-1")).toBe(false);
    // Structural defaults still land so components have a floor.
    expect(derived.get("--font-data")).toBeTruthy();
    expect(derived.get("--radius-card")).toBe("16px");
  });

  it("derives --ruo-pay-ink from background luminance (LOO-3147): light ink on dark, dark on light", () => {
    expect(deriveTokenVars(flattenTokens(CORE_DARK)).get("--ruo-pay-ink")).toBe("#ffffff");
    expect(deriveTokenVars(flattenTokens(CORE_LIGHT)).get("--ruo-pay-ink")).toBe("#0b1022");
  });

  it("never overwrites an explicitly declared --ruo-pay-ink", () => {
    const declared = flattenTokens({
      ...CORE_DARK,
      color: { ...CORE_DARK.color, "ruo-pay-ink": { $value: "#123456" } },
    });
    expect(declared.get("--color-ruo-pay-ink")).toBe("#123456");
    // The derived name is the bare token; a store pinning the bare var wins.
    const flattened = new Map(flattenTokens(CORE_DARK));
    flattened.set("--ruo-pay-ink", "#123456");
    expect(deriveTokenVars(flattened).has("--ruo-pay-ink")).toBe(false);
  });
});

describe("surfaceMuted reachability (audit gap T1)", () => {
  it("a declared surfaceMuted token feeds BOTH the kebab var and the legacy camel alias", () => {
    const tokens = { color: { surfaceMuted: { $value: "#f2ede3" } } };
    const flattened = flattenTokens(tokens);
    expect(flattened.get("--color-surface-muted")).toBe("#f2ede3");
    const all = new Map([...flattened, ...deriveTokenVars(flattened)]);
    const aliases = camelAliasVars(all);
    expect(aliases.get("--color-surfaceMuted")).toBe("var(--color-surface-muted)");
    const css = themeToRootCss(tokens);
    expect(css).toContain("--color-surface-muted: #f2ede3;");
    expect(css).toContain("--color-surfaceMuted: var(--color-surface-muted);");
  });

  it("derives a surface-muted for core-only stores so the var is always reachable", () => {
    const css = themeToRootCss(CORE_LIGHT);
    expect(css).toContain("--color-surface-muted:");
    expect(css).toContain("--color-surfaceMuted: var(--color-surface-muted);");
  });
});

describe("readThemeVariants", () => {
  it("defaults to the classic nav and no hero style", () => {
    expect(readThemeVariants({})).toEqual({
      navStyle: "classic",
      heroStyle: null,
      footerStyle: "columns",
    });
    expect(readThemeVariants(CORE_LIGHT).navStyle).toBe("classic");
  });

  it("reads nav.style and hero.style leaves; unknown values fall back safely", () => {
    expect(
      readThemeVariants({
        nav: { style: { $value: "glass-pill" } },
        hero: { style: { $value: "starfield" } },
      }),
    ).toEqual({ navStyle: "glass-pill", heroStyle: "starfield", footerStyle: "columns" });
    expect(readThemeVariants({ nav: { style: { $value: "hologram-3000" } } }).navStyle).toBe(
      "classic",
    );
  });
});
