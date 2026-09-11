import { describe, expect, it } from "vitest";
import { sanitizeCustomCss } from "@/lib/custom-css";
import {
  cssEscapeAttrValue,
  renderScopedCustomCss,
  STORE_SCOPE_ATTR,
  scopedCustomCss,
  storeScopeSelector,
} from "@/lib/custom-css-scope";
import { themeToRootCss } from "@/lib/theme";

describe("storeScopeSelector / cssEscapeAttrValue", () => {
  it("builds the attribute selector for a slug-shaped store key", () => {
    expect(storeScopeSelector("store-0-bio-archetype")).toBe(
      '[data-store-root="store-0-bio-archetype"]',
    );
  });

  it("escapes quotes and backslashes so a hostile key cannot break out of the selector", () => {
    expect(cssEscapeAttrValue('a"b')).toBe('a\\"b');
    expect(cssEscapeAttrValue("a\\b")).toBe("a\\\\b");
    const selector = storeScopeSelector('x"]{}*{color:red}');
    expect(selector.startsWith(`[${STORE_SCOPE_ATTR}="`)).toBe(true);
    // The raw quote must not survive unescaped — every " inside is preceded by \.
    expect(selector.slice(20, -2)).not.toMatch(/[^\\]"/);
  });

  it("hex-escapes control characters", () => {
    expect(cssEscapeAttrValue("a\nb")).toBe("a\\a b");
  });
});

describe("scopedCustomCss — per-tenant containment", () => {
  it("nests the sheet under the store's root selector (native CSS nesting)", () => {
    const out = scopedCustomCss("bio", ".hero { color: red; }");
    expect(out).toBe('[data-store-root="bio"] {\n.hero { color: red; }\n}');
  });

  it("two stores with CONFLICTING rules emit disjoint, fully-contained blocks", () => {
    const bioSheet = ".hero-title { color: rgb(255, 0, 0); }";
    const leoSheet = ".hero-title { color: rgb(0, 0, 255); }";

    // Both sheets pass the sanitizer (the layout's precondition for emission).
    expect(sanitizeCustomCss(bioSheet).ok).toBe(true);
    expect(sanitizeCustomCss(leoSheet).ok).toBe(true);

    const bio = scopedCustomCss("store-0-bio-archetype", bioSheet);
    const leo = scopedCustomCss("store-leo-research", leoSheet);

    // Each block opens with ITS OWN store selector and contains only its rules.
    expect(bio.startsWith('[data-store-root="store-0-bio-archetype"] {')).toBe(true);
    expect(leo.startsWith('[data-store-root="store-leo-research"] {')).toBe(true);
    expect(bio).not.toContain("store-leo-research");
    expect(leo).not.toContain("store-0-bio-archetype");
    expect(bio).not.toContain("rgb(0, 0, 255)");
    expect(leo).not.toContain("rgb(255, 0, 0)");

    // Containment: every rule sits INSIDE the scope block — nothing before the
    // scoped selector, nothing after its closing brace.
    for (const block of [bio, leo]) {
      expect(block.indexOf("[data-store-root=")).toBe(0);
      expect(block.trimEnd().endsWith("}")).toBe(true);
      const opens = (block.match(/\{/g) ?? []).length;
      const closes = (block.match(/\}/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });
});

describe("renderScopedCustomCss — the layout's one-call seam", () => {
  it("a manifest with no customCss contributes ZERO bytes (null, no style block)", () => {
    expect(renderScopedCustomCss("bio", undefined)).toBeNull();
    expect(renderScopedCustomCss("bio", "")).toBeNull();
  });

  it("a passing sheet is sanitized-verbatim and scoped under the store root", () => {
    expect(renderScopedCustomCss("bio", ".hero { color: red; }")).toBe(
      '[data-store-root="bio"] {\n.hero { color: red; }\n}',
    );
  });

  it("a sheet that fails sanitization renders NOTHING (defense in depth, never partial output)", () => {
    expect(renderScopedCustomCss("bio", '@import "https://evil.example/steal.css";')).toBeNull();
  });
});

describe("custom tokens merge into the CSS-variable emission (LOO-3167)", () => {
  it("emits arbitrary store-minted token groups as vars alongside the core roles", () => {
    const css = themeToRootCss({
      color: {
        primary: { $value: "#0f4c81" },
        background: { $value: "#ffffff" },
        text: { $value: "#111111" },
      },
      // A store's own vocabulary — nothing in the platform declares these.
      myBrand: {
        glow: { $value: "0 0 24px rgba(15, 76, 129, 0.4)" },
        "hero-angle": { $value: "12deg" },
      },
    });
    expect(css).toContain("--color-primary: #0f4c81;");
    expect(css).toContain("--my-brand-glow: 0 0 24px rgba(15, 76, 129, 0.4);");
    expect(css).toContain("--my-brand-hero-angle: 12deg;");
  });
});
