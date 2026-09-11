import { describe, expect, it } from "vitest";
import { readThemeVariants } from "@/lib/theme";
import {
  composeThemeTokens,
  FEATURED_THEMES,
  PALETTES,
  STRUCTURES,
  TYPE_SETS,
  themeMatrix,
} from "@/lib/theme-presets";

describe("theme presets + matrix", () => {
  it("composes a full token tree the derivation engine can read", () => {
    const tokens = composeThemeTokens({
      palette: "clinical",
      type: "grotesk",
      structure: "classic-shop",
    });
    // color + font groups present
    expect((tokens.color as Record<string, unknown>).primary).toBeDefined();
    expect((tokens.font as Record<string, unknown>).heading).toBeDefined();
    // structural variants round-trip through readThemeVariants
    const v = readThemeVariants(tokens);
    expect(v.navStyle).toBe("classic");
    expect(v.heroStyle).toBe("gradient");
    expect(v.footerStyle).toBe("columns");
  });

  it("hero 'off' declares no hero style → the hero toggle is off", () => {
    const tokens = composeThemeTokens({
      palette: "warm-sand",
      type: "editorial",
      structure: "editorial-quiet",
    });
    expect((tokens as { hero?: unknown }).hero).toBeUndefined();
    expect(readThemeVariants(tokens).heroStyle).toBeNull();
    expect(readThemeVariants(tokens).footerStyle).toBe("minimal");
  });

  it("the matrix is the full cartesian product, each with a unique id", () => {
    const matrix = themeMatrix();
    const expected =
      Object.keys(PALETTES).length * Object.keys(TYPE_SETS).length * Object.keys(STRUCTURES).length;
    expect(matrix.length).toBe(expected);
    expect(matrix.length).toBeGreaterThanOrEqual(100); // "hundreds of distinct sites"
    expect(new Set(matrix.map((m) => m.id)).size).toBe(matrix.length); // ids unique
  });

  it("every featured theme composes without error", () => {
    for (const choice of Object.values(FEATURED_THEMES)) {
      expect(() => composeThemeTokens(choice)).not.toThrow();
    }
  });

  it("an unknown structure preset is a loud error, never a silent bad theme", () => {
    expect(() =>
      composeThemeTokens({
        palette: "clinical",
        type: "grotesk",
        structure: "nope" as keyof typeof STRUCTURES,
      }),
    ).toThrow();
  });
});
