/**
 * DTCG design-token JSON → CSS custom properties.
 *
 * A DTCG document is a tree of groups; a leaf is any object carrying `$value`.
 * `{ color: { primary: { $value: "#0f4c81" } } }` flattens to
 * `--color-primary: #0f4c81`. Keys are kebab-cased and joined with `-`.
 *
 * Components consume ONLY these variables (no hardcoded brand colors) — the
 * store layout injects the flattened block per request, which is the entire
 * theming mechanism of the multi-tenant renderer.
 */

type TokenLeaf = { $value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenLeaf(value: unknown): value is TokenLeaf {
  return isRecord(value) && "$value" in value;
}

function kebabCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * A safe flattened custom-property NAME segment. Token VALUES were already
 * stripped of `;{}<>` by `sanitizeCssValue` — but KEYS were not, and a key is
 * emitted verbatim into the server-rendered `<style>` block. A merchant with
 * `write:own_store` could set a token key like `x</style><script>…` that closes
 * the style block and runs script on every visitor, including the payment page
 * (stored XSS — docs/audits/security-audit-2026-09-01.md #2). Restrict the
 * segment to `[a-z0-9-]` with the same rigor as values: drop every other
 * character, collapse repeats, trim edge dashes. A segment that sanitizes to
 * empty (a purely hostile/garbage key) yields no variable at all — honest
 * absence, never a malformed or breakout-capable name.
 */
function cssIdentSegment(key: string): string {
  return kebabCase(key)
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Defense-in-depth: manifests come from fixtures today but from a service
 * (ultimately operator input) tomorrow. Strip anything that could close the
 * declaration or the style block and smuggle CSS/markup in.
 */
function sanitizeCssValue(value: string): string {
  return value.replace(/[;{}<>]/g, "").trim();
}

function serializeValue(value: unknown): string | null {
  if (typeof value === "string") return sanitizeCssValue(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Flatten a DTCG token tree into an ordered map of `--var-name` → value. */
export function flattenTokens(tokens: Record<string, unknown>): Map<string, string> {
  const flattened = new Map<string, string>();

  const walk = (node: Record<string, unknown>, path: string[]): void => {
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue; // DTCG metadata ($type, $description, …)
      const segment = cssIdentSegment(key);
      if (segment.length === 0) continue; // hostile/garbage key → contributes nothing
      const childPath = [...path, segment];
      if (isTokenLeaf(child)) {
        const serialized = serializeValue(child.$value);
        if (serialized !== null && serialized.length > 0) {
          flattened.set(`--${childPath.join("-")}`, serialized);
        }
      } else if (isRecord(child)) {
        walk(child, childPath);
      }
    }
  };

  walk(tokens, []);
  return flattened;
}

/** Render the flattened tokens as the body of a CSS declaration block. */
export function tokensToCssDeclarations(tokens: Record<string, unknown>): string {
  return [...flattenTokens(tokens)].map(([name, value]) => `${name}: ${value};`).join("\n");
}

/** Full `:root { … }` rule for injection in the store layout's <style>. */
export function tokensToRootCss(tokens: Record<string, unknown>): string {
  return `:root {\n${tokensToCssDeclarations(tokens)}\n}`;
}
