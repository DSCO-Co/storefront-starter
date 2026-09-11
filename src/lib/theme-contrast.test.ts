import assert from "node:assert/strict";
import { composeThemeTokens, PALETTES, type PaletteId } from "@dscodotco/theme-presets";
import { describe, it } from "vitest";
import { contrastRatio, parseCssColor, themeContrastFindings } from "./theme";

/**
 * Audit F4 (consumer-compliance remediation 2026-09-09): tenant themes were
 * never contrast-checked. Every built-in palette must hold the floors the
 * advisory checker enforces — a preset we ship IS a recommendation, and a
 * recommended theme that fails WCAG AA body-text contrast would put every
 * store that picks it in ADA-claim territory with our name on the defect.
 */
describe("theme contrast floors", () => {
  for (const palette of Object.keys(PALETTES) as PaletteId[]) {
    it(`built-in palette "${palette}" passes every contrast floor`, () => {
      const tokens = composeThemeTokens({ palette, type: "grotesk", structure: "classic-shop" });
      const findings = themeContrastFindings(tokens as Record<string, unknown>);
      assert.deepEqual(
        findings,
        [],
        `palette ${palette} fails: ${JSON.stringify(findings, null, 2)}`,
      );
    });
  }

  it("a low-contrast tenant theme yields findings (the checker can fail)", () => {
    const findings = themeContrastFindings({
      color: {
        text: { $value: "#999999" },
        background: { $value: "#aaaaaa" },
      },
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.pair, "text-on-background");
    assert.ok(findings[0] !== undefined && findings[0].ratio < 4.5);
  });

  it("absent tokens are not findings — only a present pair can fail", () => {
    assert.deepEqual(themeContrastFindings({}), []);
  });

  it("contrastRatio matches the canonical black-on-white anchor", () => {
    const black = parseCssColor("#000000");
    const white = parseCssColor("#ffffff");
    assert.ok(black && white);
    assert.equal(Math.round(contrastRatio(black, white)), 21);
  });
});
