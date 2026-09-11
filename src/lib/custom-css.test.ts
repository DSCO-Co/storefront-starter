import { describe, expect, it } from "vitest";
import { CUSTOM_CSS_MAX_BYTES, sanitizeCustomCss } from "@/lib/custom-css";

/**
 * The heart of LOO-3167: the sanitizer is validate-verbatim-or-reject — a
 * passing sheet is returned byte-for-byte, a failing sheet returns EVERY
 * human-readable reason (the portal shows them verbatim), and nothing is ever
 * silently stripped or truncated.
 */

/** The joined rejection reasons ("" when the sheet passed) — assert directly. */
function reasonsFor(css: string): string {
  const result = sanitizeCustomCss(css);
  return result.ok ? "" : result.reasons.join("\n");
}

/**
 * The css returned VERBATIM when the sheet passed, or "REJECTED: <reasons>" —
 * so `expect(passedVerbatim(css)).toBe(css)` both proves acceptance and prints
 * the reasons on failure.
 */
function passedVerbatim(css: string): string {
  const result = sanitizeCustomCss(css);
  return result.ok ? result.css : `REJECTED: ${result.reasons.join("\n")}`;
}

describe("sanitizeCustomCss — allowed CSS passes verbatim", () => {
  it("passes ordinary rules unchanged", () => {
    const css = ".hero-title { letter-spacing: 0.08em; color: var(--color-accent); }";
    expect(passedVerbatim(css)).toBe(css);
  });

  it("passes media/supports/container queries", () => {
    for (const css of [
      "@media (min-width: 900px) { .grid { gap: 2rem; } }",
      "@supports (display: grid) { .x { display: grid; } }",
      "@container (min-width: 400px) { .card { padding: 2rem; } }",
    ]) {
      expect(passedVerbatim(css)).toBe(css);
    }
  });

  it("passes relative and same-origin url() targets", () => {
    for (const css of [
      '.hero { background-image: url("/media/hero.webp"); }',
      ".hero { background-image: url(./texture.png); }",
      ".hero { background-image: url(../up/one.png); }",
      '.icon { mask: url("#clip-path"); }',
      ".plain { background: url(images/dots.svg); }",
    ]) {
      expect(passedVerbatim(css)).toBe(css);
    }
  });

  it("passes an empty url() and empty input", () => {
    expect(passedVerbatim(".x { background: url(); }")).toBe(".x { background: url(); }");
    expect(passedVerbatim("")).toBe("");
  });

  it("passes comments that merely CONTAIN suspicious words (comments are stripped for scanning)", () => {
    const css = "/* do not @import here, and no javascript: either */ .x { color: red; }";
    expect(passedVerbatim(css)).toBe(css);
  });

  it("does NOT false-positive on `@im/**/port` (a comment is a token boundary, not glue)", () => {
    const css = "@im/**/port { color: red; }";
    expect(passedVerbatim(css)).toBe(css);
  });

  it("passes a sheet exactly at the size cap", () => {
    const filler = ".a{color:red}\n";
    const sheet = filler.repeat(Math.floor(CUSTOM_CSS_MAX_BYTES / filler.length));
    expect(new TextEncoder().encode(sheet).length).toBeLessThanOrEqual(CUSTOM_CSS_MAX_BYTES);
    expect(passedVerbatim(sheet)).toBe(sheet);
  });
});

describe("sanitizeCustomCss — size cap (reject, never truncate)", () => {
  it("rejects a sheet over the cap with the exact sizes in the reason", () => {
    const reasons = reasonsFor("x".repeat(CUSTOM_CSS_MAX_BYTES + 1));
    expect(reasons).toContain("50,001");
    expect(reasons).toContain("50,000");
    expect(reasons).toContain("Nothing was truncated");
  });

  it("counts BYTES, not characters (multi-byte glyphs)", () => {
    // Each 💧 is 4 UTF-8 bytes: 13,000 of them exceed 50,000 bytes at 13,000 chars.
    expect(reasonsFor("💧".repeat(13_000))).toContain("bytes");
  });
});

describe("sanitizeCustomCss — @import / external fetches", () => {
  it("rejects @import in every form", () => {
    expect(reasonsFor('@import "https://evil.example/steal.css";')).toContain("@import");
    expect(reasonsFor("@import url(https://evil.example/steal.css);")).toContain("@import");
    expect(reasonsFor('@IMPORT "x.css";')).toContain("@import");
    expect(reasonsFor('  @import\n  "x.css";')).toContain("@import");
  });

  it("rejects escape-obfuscated @import (\\69 → i)", () => {
    expect(reasonsFor('@\\69mport "https://evil.example/x.css";')).toContain("@import");
    expect(reasonsFor('@\\69 mport "https://evil.example/x.css";')).toContain("@import");
  });

  it("rejects absolute url() targets (exfiltration beacons)", () => {
    expect(reasonsFor(".x { background: url(https://evil.example/pixel.gif); }")).toContain(
      "off-origin",
    );
    expect(reasonsFor('.x { background: url("http://evil.example/p.gif"); }')).toContain(
      "off-origin",
    );
    expect(reasonsFor(".x { background: url('ftp://evil.example/p.gif'); }")).toContain(
      "off-origin",
    );
  });

  it("rejects protocol-relative url() targets", () => {
    expect(reasonsFor(".x { background: url(//evil.example/p.gif); }")).toContain("off-origin");
  });

  it("rejects data: URIs in url()", () => {
    expect(reasonsFor(".x { background: url(data:image/svg+xml,<svg/>); }")).toContain(
      "off-origin",
    );
  });

  it("rejects off-origin targets in src() and image-set()'s inner url()", () => {
    expect(reasonsFor(".x { background: src('https://evil.example/a.png'); }")).toContain(
      "off-origin",
    );
    expect(
      reasonsFor(".x { background: image-set(url(https://evil.example/a.png) 1x); }"),
    ).toContain("off-origin");
  });

  it("rejects escape-obfuscated url schemes", () => {
    expect(reasonsFor(".x { background: url(\\68ttps://evil.example/p.gif); }")).toContain(
      "off-origin",
    );
  });

  it("rejects @charset (decoding switcheroo)", () => {
    expect(reasonsFor('@charset "UTF-7";')).toContain("@charset");
  });
});

describe("sanitizeCustomCss — script-adjacent vectors", () => {
  it("rejects expression()", () => {
    expect(reasonsFor(".x { width: expression(alert(1)); }")).toContain("expression()");
    expect(reasonsFor(".x { width: expression (alert(1)); }")).toContain("expression()");
    expect(reasonsFor(".x { width: EXPRESSION(alert(1)); }")).toContain("expression()");
  });

  it("rejects the behavior: property", () => {
    expect(reasonsFor(".x { behavior: url(#default#userData); }")).toContain("behavior:");
    expect(reasonsFor(".x { BEHAVIOR : url(x.htc); }")).toContain("behavior:");
  });

  it("rejects -moz-binding", () => {
    expect(reasonsFor('.x { -moz-binding: url("x.xml#xss"); }')).toContain("-moz-binding");
  });

  it("rejects javascript: and vbscript: anywhere", () => {
    expect(reasonsFor(".x { background: url(javascript:alert(1)); }")).toContain("javascript:");
    expect(reasonsFor(".x { list-style: url(vbscript:msgbox(1)); }")).toContain("vbscript:");
    expect(reasonsFor('.x { content: "javascript:alert(1)"; }')).toContain("javascript:");
  });

  it("rejects escape-obfuscated javascript: (\\6a → j)", () => {
    expect(reasonsFor(".x { background: url(\\6a avascript:alert(1)); }")).toMatch(
      /javascript:|off-origin/,
    );
  });
});

describe("sanitizeCustomCss — style-element breakout", () => {
  it("rejects </style in any casing", () => {
    expect(reasonsFor(".x { color: red; } </style><script>alert(1)</script>")).toContain("</style");
    expect(reasonsFor('.x { content: "</STYLE>"; }')).toContain("</style");
  });

  it("rejects escape-obfuscated </style", () => {
    expect(reasonsFor('.x { content: "<\\2f style>"; }')).toContain("</style");
  });

  it("rejects <script and HTML comment markers", () => {
    expect(reasonsFor('.x { content: "<script>"; }')).toContain("<script");
    expect(reasonsFor("<!-- sneaky --> .x { color: red; }")).toContain("<!--");
  });

  it("rejects NUL bytes", () => {
    expect(reasonsFor(".x { color: red; }\u0000")).toContain("NUL");
  });
});

describe("sanitizeCustomCss — reject-with-ALL-reasons", () => {
  it("collects every distinct violation, not just the first", () => {
    const result = sanitizeCustomCss(
      '@import "https://evil.example/a.css";\n.x { width: expression(alert(1)); background: url(//evil.example/p.gif); }',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.reasons.join("\n");
      expect(joined).toContain("@import");
      expect(joined).toContain("expression()");
      expect(joined).toContain("off-origin");
      expect(result.reasons.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("dedupes identical reasons", () => {
    const result = sanitizeCustomCss('@import "a.css";\n@import "b.css";');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.filter((r) => r.includes("@import"))).toHaveLength(1);
    }
  });
});
