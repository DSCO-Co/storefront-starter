/**
 * Variant-label composition (LOO-3183) — the ADD-time fix for the raw-slug
 * cart-label defect.
 *
 * #2440's `normalizeCartLabels` repairs STORED carts at hydrate, but it can
 * only substitute the catalog's own label — and on SDK catalogs whose price
 * rows carry no human `label`, the catalog label IS the code
 * ("cjc-1295-ipamorelin-vial"), so newly-added lines kept rendering the slug.
 * This module fixes the composition side: every renderer variant label goes
 * through `composeVariantLabel`, which
 *
 *   1. prefers the catalog's HUMAN label untouched ("10mg", "60 capsules");
 *   2. when the only label is a slug-shaped code that embeds the product's
 *      own slug/name, derives the human remainder ("cjc-1295-ipamorelin-vial"
 *      → "Vial", "bpc-157-10mg" → "10mg");
 *   3. when the code is EXACTLY the product slug (it conveys nothing beyond
 *      the product itself), falls back to a strength token from the product
 *      name, else empty — renderers hide an empty label rather than print a
 *      slug;
 *   4. leaves opaque SKUs ("LEO-CJCIPA-10") alone — they present in the code
 *      register (variantLabelIsCode), clearly a code, never dressed as copy.
 */

/** Slug/SKU-shaped token: lowercase-alnum words joined by - or _ (no spaces). */
const CODE_LABEL_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;

/** Measurement-looking token kept verbatim ("10mg", "2.5ml", "500iu"). */
const UNIT_TOKEN_RE = /^\d+(?:\.\d+)?(?:mg|mcg|ug|ml|iu|g|ct|x)$/i;

/** First strength-like token in free text ("BPC-157 10mg vial" → "10mg"). */
const NAME_STRENGTH_RE =
  /(\d+(?:\.\d+)?\s?(?:mg|mcg|ug|ml|iu)\b(?:\s?\/\s?\d+(?:\.\d+)?\s?(?:mg|mcg|ug|ml|iu)\b)?)/i;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True when a label reads as a machine code rather than human copy. */
export function labelLooksLikeCode(label: string, productSlug: string): boolean {
  if (label.length === 0) return true;
  if (label === productSlug) return true;
  return CODE_LABEL_RE.test(label);
}

function humanizeToken(token: string): string {
  if (UNIT_TOKEN_RE.test(token) || /^\d+(?:\.\d+)?$/.test(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * Human remainder of a slug-shaped code once the product's own identity is
 * stripped ("cjc-1295-ipamorelin-vial" − "cjc-1295-ipamorelin" → "Vial").
 * Empty string when nothing human remains.
 */
function deriveFromCode(code: string, prefixes: string[]): string {
  let rest = code;
  for (const prefix of prefixes) {
    if (prefix.length > 0 && rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  const tokens = rest.split(/[-_]+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return "";
  // A pure numeric remainder ("-10") is a pack/size code, not human copy.
  if (tokens.every((token) => /^\d+$/.test(token))) return "";
  return tokens.map(humanizeToken).join(" ");
}

export type VariantLabelInput = {
  /** The catalog/service label as stored — null/absent when the row has none. */
  label: string | null | undefined;
  /** Commerce variant_ref / SKU. */
  variantRef: string;
  productSlug: string;
  productName: string;
};

/**
 * Compose the label a variant RENDERS (pills, cart lines, order rows).
 * Returns "" when nothing human can be said — callers hide the label rather
 * than print a slug.
 */
export function composeVariantLabel(input: VariantLabelInput): string {
  const { variantRef, productSlug, productName } = input;
  const stored = input.label?.trim() ?? "";
  // 1. A human label wins untouched.
  if (stored.length > 0 && !labelLooksLikeCode(stored, productSlug)) return stored;

  const prefixes = [productSlug, slugify(productName)].filter((p) => p.length > 0);
  const candidates = [stored, variantRef].filter(
    (candidate) => candidate.length > 0 && CODE_LABEL_RE.test(candidate),
  );
  // 2. Slug-shaped code embedding the product identity → human remainder.
  for (const candidate of candidates) {
    if (candidate === productSlug) continue;
    const derived = deriveFromCode(candidate, prefixes);
    if (derived.length > 0) return derived;
  }
  // 3. Code equals the product slug (or nothing derivable from a slug-shaped
  //    code): a strength read from the product name, else nothing.
  if (candidates.length > 0) {
    const strength = productName.match(NAME_STRENGTH_RE);
    if (strength?.[1]) return strength[1].replace(/\s+/g, "");
    return "";
  }
  // 4. Opaque SKU / non-slug-shaped label: keep as-is (code register).
  return stored.length > 0 ? stored : variantRef;
}
