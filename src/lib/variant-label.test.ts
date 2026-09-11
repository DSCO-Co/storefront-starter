/**
 * Variant-label composition (LOO-3183) — the add-time fix for cart lines that
 * rendered a raw slug ("cjc-1295-ipamorelin-vial") as their variant label.
 */

import { describe, expect, it } from "vitest";
import { composeVariantLabel, labelLooksLikeCode, slugify } from "@/lib/variant-label";

describe("composeVariantLabel", () => {
  it("prefers the catalog's human label untouched", () => {
    expect(
      composeVariantLabel({
        label: "10mg",
        variantRef: "DEMO-BPC-10",
        productSlug: "bpc-157",
        productName: "BPC-157",
      }),
    ).toBe("10mg");
    expect(
      composeVariantLabel({
        label: "5mg/5mg vial",
        variantRef: "LEO-CJCIPA-10",
        productSlug: "cjc-1295-ipamorelin",
        productName: "CJC-1295 / Ipamorelin",
      }),
    ).toBe("5mg/5mg vial");
  });

  it("derives the human remainder from a slug-shaped ref (the audit's exact case)", () => {
    // Live loopbio: no stored label; the variant_ref embeds the product slug.
    expect(
      composeVariantLabel({
        label: null,
        variantRef: "cjc-1295-ipamorelin-vial",
        productSlug: "cjc-1295-ipamorelin",
        productName: "CJC-1295 / Ipamorelin",
      }),
    ).toBe("Vial");
    expect(
      composeVariantLabel({
        label: null,
        variantRef: "bpc-157-10mg",
        productSlug: "bpc-157",
        productName: "BPC-157",
      }),
    ).toBe("10mg");
  });

  it("treats a code-shaped STORED label the same as a code-shaped ref", () => {
    expect(
      composeVariantLabel({
        label: "cjc-1295-ipamorelin-vial",
        variantRef: "cjc-1295-ipamorelin-vial",
        productSlug: "cjc-1295-ipamorelin",
        productName: "CJC-1295 / Ipamorelin",
      }),
    ).toBe("Vial");
  });

  it("never renders the bare product slug: falls back to a name strength, else empty", () => {
    expect(
      composeVariantLabel({
        label: null,
        variantRef: "bpc-157",
        productSlug: "bpc-157",
        productName: "BPC-157 10mg",
      }),
    ).toBe("10mg");
    expect(
      composeVariantLabel({
        label: null,
        variantRef: "cjc-1295-ipamorelin",
        productSlug: "cjc-1295-ipamorelin",
        productName: "CJC-1295 / Ipamorelin",
      }),
    ).toBe("");
  });

  it("keeps an opaque SKU as-is (presented in the code register, not dressed up)", () => {
    expect(
      composeVariantLabel({
        label: null,
        variantRef: "DEMO-BPC-10",
        productSlug: "bpc-157",
        productName: "BPC-157",
      }),
    ).toBe("DEMO-BPC-10");
  });

  it("humanizes non-strength remainders word by word", () => {
    expect(
      composeVariantLabel({
        label: null,
        variantRef: "alpha-gel-twin-pack",
        productSlug: "alpha-gel",
        productName: "Alpha Gel",
      }),
    ).toBe("Twin Pack");
  });

  it("a purely numeric remainder is a pack code, not human copy", () => {
    expect(
      composeVariantLabel({
        label: null,
        variantRef: "bpc-157-10",
        productSlug: "bpc-157",
        productName: "BPC-157",
      }),
    ).toBe("");
  });
});

describe("labelLooksLikeCode / slugify", () => {
  it("flags slug-shaped and product-slug labels; passes human copy", () => {
    expect(labelLooksLikeCode("cjc-1295-ipamorelin-vial", "cjc-1295-ipamorelin")).toBe(true);
    expect(labelLooksLikeCode("bpc-157", "bpc-157")).toBe(true);
    expect(labelLooksLikeCode("", "x")).toBe(true);
    expect(labelLooksLikeCode("5mg/5mg vial", "cjc-1295-ipamorelin")).toBe(false);
    expect(labelLooksLikeCode("60 capsules", "x")).toBe(false);
    expect(labelLooksLikeCode("10mg", "x")).toBe(false);
  });

  it("slugify mirrors product-name slugs", () => {
    expect(slugify("CJC-1295 / Ipamorelin")).toBe("cjc-1295-ipamorelin");
  });
});
