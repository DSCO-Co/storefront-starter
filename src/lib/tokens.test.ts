import { describe, expect, it } from "vitest";
import { flattenTokens, tokensToCssDeclarations, tokensToRootCss } from "@/lib/tokens";

describe("flattenTokens", () => {
  it("flattens nested DTCG groups into --kebab-case custom properties", () => {
    const flat = flattenTokens({
      color: {
        primary: { $type: "color", $value: "#0f4c81" },
        onPrimary: { $value: "#ffffff" },
      },
      radius: { card: { $value: "12px" } },
    });
    expect(flat.get("--color-primary")).toBe("#0f4c81");
    expect(flat.get("--color-on-primary")).toBe("#ffffff");
    expect(flat.get("--radius-card")).toBe("12px");
    expect(flat.size).toBe(3);
  });

  it("skips DTCG $-metadata keys and non-serializable values", () => {
    const flat = flattenTokens({
      $description: "top-level metadata",
      color: {
        $type: "color",
        weird: { $value: { nested: true } },
        fine: { $value: "#123456" },
      },
    });
    expect(flat.size).toBe(1);
    expect(flat.get("--color-fine")).toBe("#123456");
  });

  it("serializes numeric token values", () => {
    const flat = flattenTokens({ opacity: { muted: { $value: 0.6 } } });
    expect(flat.get("--opacity-muted")).toBe("0.6");
  });

  it("strips CSS-injection characters from values", () => {
    const flat = flattenTokens({
      color: { evil: { $value: "red;} body{background:url(x)" } },
    });
    expect(flat.get("--color-evil")).not.toContain(";");
    expect(flat.get("--color-evil")).not.toContain("{");
    expect(flat.get("--color-evil")).not.toContain("}");
  });

  it("strips CSS/markup-injection characters from KEYS (stored-XSS regression)", () => {
    // security-audit-2026-09-01 #2: a token KEY that breaks out of the <style>
    // block must never reach the rendered name. The whole rendered CSS must
    // contain no `<`, `>`, `{`/`}` or `;` from the key.
    const flat = flattenTokens({
      "x</style><script>alert(1)</script>": { $value: "1" },
      color: { primary: { $value: "#000" } },
    });
    for (const name of flat.keys()) {
      expect(name).toMatch(/^--[a-z0-9-]+$/);
      expect(name).not.toContain("<");
      expect(name).not.toContain(">");
      expect(name).not.toContain("/");
    }
    // the legitimate token still resolves
    expect(flat.get("--color-primary")).toBe("#000");
    // the whole rendered block cannot contain a style-breakout
    const css = tokensToCssDeclarations({
      "a</style><script>": { $value: "1" },
      color: { primary: { $value: "#000" } },
    });
    expect(css).not.toContain("</style>");
    expect(css).not.toContain("<script>");
  });

  it("drops a token whose key sanitizes to empty (pure garbage/hostile key)", () => {
    const flat = flattenTokens({ "<>{}": { $value: "1" }, ok: { $value: "2" } });
    expect(flat.has("--ok")).toBe(true);
    expect(flat.size).toBe(1);
  });

  it("renders declarations and a :root block", () => {
    const tokens = { color: { primary: { $value: "#000" } } };
    expect(tokensToCssDeclarations(tokens)).toBe("--color-primary: #000;");
    expect(tokensToRootCss(tokens)).toBe(":root {\n--color-primary: #000;\n}");
  });
});
