/**
 * coa-block empty-state honesty (LOO-3179): the demo walkthrough showed a
 * hero claiming "100% lots published" over a COA section flatly stating "No
 * certificates published yet" — because sdk-mode catalogs carry no coaDocs
 * (yet) and the section asserted absence for every empty. The section now
 * distinguishes three truths: the store's own coming-soon posture
 * (behavior.catalog.coaDisplay — the PDP chip pattern), an empty/unreadable
 * catalog (no absence claim), and a real catalog with genuinely no docs.
 */

import type { SectionContext } from "@dscodotco/storefront-sections";
import { renderSection } from "@dscodotco/storefront-sections";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import bioArchetype from "@/fixtures/manifests/store-0-bio-archetype.json";
import type { Product } from "@/lib/catalog-source";
import { resolveBehavior, storeManifestSchema } from "@/lib/manifest";

afterEach(cleanup);

const productNoDocs: Product = {
  slug: "alpha",
  name: "Alpha",
  priceCents: 5000,
  variants: [],
  coaDocs: [],
};

function ctxWith(products: Product[], behavior?: Record<string, unknown>): SectionContext {
  const manifest = storeManifestSchema.parse({
    ...bioArchetype,
    behavior: behavior ?? undefined,
  });
  return {
    storeKey: "store-test",
    brandName: "Test Brand",
    products,
    ...(behavior !== undefined ? { behavior: resolveBehavior(manifest) } : {}),
  };
}

function renderCoaBlock(ctx: SectionContext) {
  return render(<div>{renderSection({ type: "coa-block", props: {} }, ctx)}</div>);
}

describe("coa-block empty states (LOO-3179)", () => {
  it("uses the store's coming-soon copy when coaDisplay is enabled — no contradiction with hero copy", () => {
    const { getByTestId, queryByText } = renderCoaBlock(
      ctxWith([productNoDocs], {
        catalog: { coaDisplay: { enabled: true, comingSoonCopy: "COAs publish with lot 2" } },
      }),
    );
    expect(getByTestId("coa-coming-soon").textContent).toBe("COAs publish with lot 2");
    expect(queryByText("No certificates published yet.")).toBeNull();
  });

  it("falls back to the default coming-soon copy when the store declares none", () => {
    const { getByTestId } = renderCoaBlock(
      ctxWith([productNoDocs], { catalog: { coaDisplay: { enabled: true } } }),
    );
    expect(getByTestId("coa-coming-soon").textContent).toBe("COA coming soon");
  });

  it("never asserts absence over an EMPTY product list (could be a failed read)", () => {
    const { queryByText, getByText } = renderCoaBlock(ctxWith([], {}));
    expect(queryByText("No certificates published yet.")).toBeNull();
    expect(getByText(/appear here as lots are published/)).toBeTruthy();
  });

  it("states the plain truth for a real catalog with no docs and no coming-soon posture", () => {
    const { getByText } = renderCoaBlock(ctxWith([productNoDocs], {}));
    expect(getByText("No certificates published yet.")).toBeTruthy();
  });

  it("lists products with docs unchanged", () => {
    const withDoc: Product = {
      ...productNoDocs,
      slug: "beta",
      name: "Beta",
      coaDocs: [{ label: "Purity", url: "/coa/b.pdf" }],
    };
    const { getByText } = renderCoaBlock(ctxWith([withDoc], {}));
    expect(getByText("Beta")).toBeTruthy();
  });
});
