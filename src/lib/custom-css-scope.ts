/**
 * Per-store custom-CSS scoping — storefront-only companion to the sanitizer
 * (`lib/custom-css.ts`). Ported from the Loop platform's
 * `apps/storefront/src/lib/custom-css-scope.ts` (LOO-3167).
 *
 * The root layout stamps `data-store-root="{storeKey}"` on `<body>`, and the
 * sanitized sheet is emitted server-side (zero FOUC — same mechanism as the
 * theme-token <style> block) nested under that attribute selector via native
 * CSS nesting:
 *
 *   [data-store-root="bio"] {
 *     .hero-title { letter-spacing: 0.1em; }
 *     @media (min-width: 900px) { … }
 *   }
 *
 * Every rule in the sheet therefore only matches inside THIS store's subtree —
 * two tenants' sheets can carry conflicting selectors without colliding, and a
 * sheet can never restyle anything outside its store root. Top-level
 * `@keyframes` / `@font-face` are not valid inside a nested rule and are
 * dropped by the browser (fail-safe); token-level changes belong in
 * `theme.tokens` (which also accepts arbitrary custom tokens), not here.
 */

import { sanitizeCustomCss } from "@/lib/custom-css";
import { createLogger } from "@/lib/logger";

/** The attribute the store layout stamps on its wrapper element. */
export const STORE_SCOPE_ATTR = "data-store-root";

/**
 * Escape a value for use inside a double-quoted CSS attribute selector
 * string: backslashes and quotes are CSS-escaped, control characters are
 * hex-escaped. (Store keys are slug-shaped today; this keeps the emitter
 * safe if that ever loosens.)
 */
export function cssEscapeAttrValue(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what must be hex-escaped for the selector.
  return value.replace(/[\u0000-\u001f"\\]/g, (ch) => {
    if (ch === '"' || ch === "\\") return `\\${ch}`;
    return `\\${ch.codePointAt(0)?.toString(16) ?? "0"} `;
  });
}

/** The store's root selector — the scope every custom rule nests under. */
export function storeScopeSelector(storeKey: string): string {
  return `[${STORE_SCOPE_ATTR}="${cssEscapeAttrValue(storeKey)}"]`;
}

/**
 * Nest an ALREADY-SANITIZED sheet under the store's root selector. The caller
 * must have run `sanitizeCustomCss` first — this function scopes, it does not
 * sanitize.
 */
export function scopedCustomCss(storeKey: string, sanitizedCss: string): string {
  return `${storeScopeSelector(storeKey)} {\n${sanitizedCss}\n}`;
}

const logger = createLogger("custom-css");

/**
 * The layout's one-call seam: sanitize a manifest's `theme.customCss` and
 * scope it under the store's root selector. Returns `null` — zero bytes
 * contributed — when the manifest carries no custom CSS, and ALSO null (with
 * a warn log listing every reason) when the sheet fails sanitization: the
 * write gate should have refused such a sheet, so serving nothing here is
 * defense in depth, never the primary rejection surface.
 */
export function renderScopedCustomCss(
  storeKey: string,
  customCss: string | undefined,
): string | null {
  if (customCss === undefined || customCss.length === 0) return null;
  const sanitized = sanitizeCustomCss(customCss);
  if (!sanitized.ok) {
    logger.warn("refusing to render custom CSS that failed sanitization", {
      storeKey,
      reasons: sanitized.reasons,
    });
    return null;
  }
  return scopedCustomCss(storeKey, sanitized.css);
}
