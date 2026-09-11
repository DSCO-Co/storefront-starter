/**
 * Per-store custom-CSS sanitizer — the LAST rung of the storefront extension
 * ladder (tokens first, sections second, scoped CSS last, per-tenant code
 * never). Ported faithfully from the Loop platform's
 * `apps/storefront/src/lib/custom-css.ts` (LOO-3167); this repo carries ONE
 * copy (no sibling mirrors yet — the parent's m2m-client fork lesson says a
 * second copy needs a byte-identity test the day it appears). This file has
 * ZERO imports on purpose, so a future write-gate copy can stay
 * byte-identical across module systems.
 *
 * Contract: VALIDATE, never rewrite. A sheet either passes through verbatim or
 * is rejected with every human-readable reason (the portal shows them
 * verbatim). No silent truncation, no silent stripping — a merchant must see
 * exactly why their CSS was refused, and a sheet that passed is served
 * byte-for-byte.
 *
 * Threat model (storefront CSP posture: no external fetches, no script):
 *   - `@import` / url()/src()/image-set() to any absolute or protocol-relative
 *     target — external fetches (exfiltration beacons, tracking, foreign
 *     stylesheets). Relative and fragment targets are allowed.
 *   - `expression()`, `behavior:`, `-moz-binding` — legacy CSS-to-script.
 *   - `</style` / `<script` / `<!--` — style-element breakout into markup.
 *   - `javascript:` / `vbscript:` / `data:` — script-adjacent URL schemes.
 *   - `@charset` — decoding switcheroo.
 *   - CSS escape sequences and comments are DECODED/STRIPPED before scanning,
 *     so `@\69mport` and `url(\6a avascript:…)` cannot sneak past.
 */

/** Hard size cap for a store's custom stylesheet (bytes of UTF-8). */
export const CUSTOM_CSS_MAX_BYTES = 50_000;

export type SanitizeCustomCssResult = { ok: true; css: string } | { ok: false; reasons: string[] };

/**
 * Build the scan text: comments stripped, CSS escapes decoded, lowercased.
 * NEVER used as output — only to make obfuscated tokens visible to the checks.
 */
function scanTextOf(css: string): string {
  let text = css;
  // Strip comments (including an unterminated trailing one). In CSS a comment
  // is a token boundary, so `@im/**/port` is NOT @import — removing comments
  // could FUSE such halves into a false positive; replace with a space to
  // preserve the boundary.
  text = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\*[\s\S]*$/, " ");
  // Decode hex escapes: \HHHHHH with an optional single trailing whitespace.
  text = text.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex: string) => {
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint === 0 || codePoint > 0x10ffff) return " ";
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return " ";
    }
  });
  // Decode identity escapes (\x → x).
  text = text.replace(/\\([\s\S])/g, "$1");
  return text.toLowerCase();
}

/** True when a url()/src() target is relative or same-origin (no scheme, not protocol-relative). */
function isAllowedUrlTarget(target: string): boolean {
  const trimmed = target.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("//")) return false; // protocol-relative → foreign origin
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false; // any scheme (https:, data:, javascript:, …)
  return true;
}

const URL_FUNCTION_RE = /\b(?:url|src)\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi;

/**
 * Validate a store's custom stylesheet. Returns the css VERBATIM on success,
 * or every reason it was refused. Pure — no I/O, no DOM.
 */
export function sanitizeCustomCss(css: string): SanitizeCustomCssResult {
  const reasons: string[] = [];

  const byteLength = new TextEncoder().encode(css).length;
  if (byteLength > CUSTOM_CSS_MAX_BYTES) {
    reasons.push(
      `Custom CSS is ${byteLength.toLocaleString("en-US")} bytes — the limit is ${CUSTOM_CSS_MAX_BYTES.toLocaleString("en-US")}. Nothing was truncated; trim the sheet and retry.`,
    );
  }

  const scan = scanTextOf(css);

  // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL is exactly the character being screened out.
  if (/\u0000/.test(css)) {
    reasons.push("Custom CSS must not contain NUL bytes.");
  }
  if (/@\s*import\b/.test(scan)) {
    reasons.push(
      "@import is not allowed — external stylesheets are blocked by the storefront CSP. Inline the rules instead.",
    );
  }
  if (/@\s*charset\b/.test(scan)) {
    reasons.push("@charset is not allowed — the stylesheet encoding is fixed to UTF-8.");
  }
  if (/expression\s*\(/.test(scan)) {
    reasons.push("expression() is not allowed — CSS may not execute script.");
  }
  if (/\bbehavior\s*:/.test(scan)) {
    reasons.push("The behavior: property is not allowed — CSS may not attach script behaviors.");
  }
  if (/-moz-binding/.test(scan)) {
    reasons.push("-moz-binding is not allowed — CSS may not attach script bindings.");
  }
  if (/<\/style/.test(scan)) {
    reasons.push("The sequence </style is not allowed — it would break out of the style element.");
  }
  if (/<\s*script/.test(scan)) {
    reasons.push("The sequence <script is not allowed inside custom CSS.");
  }
  if (/<!--/.test(scan)) {
    reasons.push("HTML comment markers (<!--) are not allowed inside custom CSS.");
  }
  if (/javascript\s*:/.test(scan)) {
    reasons.push("javascript: URLs are not allowed anywhere in custom CSS.");
  }
  if (/vbscript\s*:/.test(scan)) {
    reasons.push("vbscript: URLs are not allowed anywhere in custom CSS.");
  }

  for (const match of scan.matchAll(URL_FUNCTION_RE)) {
    const target = match[1] ?? match[2] ?? match[3] ?? "";
    if (!isAllowedUrlTarget(target)) {
      reasons.push(
        `url(${target.trim()}) points off-origin — only relative, same-origin URL targets are allowed (the storefront CSP blocks external fetches). Upload assets through the media pipeline instead.`,
      );
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons: [...new Set(reasons)] };
  }
  return { ok: true, css };
}
