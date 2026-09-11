/**
 * PDP rich sections — authored-or-absent honesty. Each section renders
 * exactly when its field is authored and renders NOTHING when it is not:
 * no placeholder copy, no invented claims. Paired-with cards link to the
 * sibling PDP and drop refs that no longer resolve against the catalog.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PdpAttributeRow,
  PdpPairedWith,
  PdpProse,
  PdpSpecs,
  ReconstitutionNote,
  resolvePairedProducts,
} from "@/components/product/pdp-rich";
import type { Product } from "@/lib/catalog-source";

afterEach(cleanup);

const baseProduct: Product = {
  slug: "alpha",
  name: "Alpha",
  priceCents: 5000,
  variants: [],
  coaDocs: [],
};

describe("PdpProse", () => {
  it("renders overview and mechanism as separate headed prose blocks when both are authored", () => {
    const { getByText, getByTestId } = render(
      <PdpProse
        overview={"First paragraph.\n\nSecond paragraph."}
        mechanism="Characterized in cell culture."
      />,
    );
    expect(getByText("Overview")).toBeInTheDocument();
    expect(getByText("First paragraph.")).toBeInTheDocument();
    expect(getByText("Second paragraph.")).toBeInTheDocument();
    expect(getByText("Characterized mechanism (in vitro)")).toBeInTheDocument();
    expect(getByText("Characterized in cell culture.")).toBeInTheDocument();
    expect(getByTestId("pdp-overview")).toBeInTheDocument();
    expect(getByTestId("pdp-mechanism")).toBeInTheDocument();
  });

  it("renders only the authored sub-section", () => {
    const { getByText, queryByTestId } = render(<PdpProse overview="Only an overview." />);
    expect(getByText("Only an overview.")).toBeInTheDocument();
    expect(queryByTestId("pdp-mechanism")).toBeNull();
  });

  it("renders nothing when neither field is authored", () => {
    const { container } = render(<PdpProse />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PdpSpecs", () => {
  it("renders a key/value table when specs are present", () => {
    const { getByTestId, getByText } = render(
      <PdpSpecs
        specs={[
          { label: "Format", value: "Lyophilized powder" },
          { label: "Purity (HPLC)", value: "≥99%" },
        ]}
      />,
    );
    expect(getByTestId("spec-table")).toBeInTheDocument();
    expect(getByText("Format")).toBeInTheDocument();
    expect(getByText("Lyophilized powder")).toBeInTheDocument();
    expect(getByText("≥99%")).toBeInTheDocument();
  });

  it("renders nothing for absent or empty specs", () => {
    expect(render(<PdpSpecs />).container).toBeEmptyDOMElement();
    cleanup();
    expect(render(<PdpSpecs specs={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("resolvePairedProducts", () => {
  const catalog: Product[] = [
    { ...baseProduct, slug: "ghk-cu", name: "GHK-Cu" },
    { ...baseProduct, slug: "kpv", name: "KPV" },
  ];

  it("joins refs to full catalog products in ref order", () => {
    const resolved = resolvePairedProducts(
      [
        { slug: "kpv", name: "KPV" },
        { slug: "ghk-cu", name: "GHK-Cu" },
      ],
      catalog,
    );
    expect(resolved.map((product) => product.slug)).toEqual(["kpv", "ghk-cu"]);
  });

  it("drops refs whose slug is no longer in the catalog", () => {
    const resolved = resolvePairedProducts(
      [
        { slug: "retired", name: "Retired" },
        { slug: "kpv", name: "KPV" },
      ],
      catalog,
    );
    expect(resolved.map((product) => product.slug)).toEqual(["kpv"]);
  });

  it("returns [] for absent/empty refs", () => {
    expect(resolvePairedProducts(undefined, catalog)).toEqual([]);
    expect(resolvePairedProducts([], catalog)).toEqual([]);
  });
});

describe("PdpPairedWith", () => {
  it("renders one card per item with name, tagline, price, and a link to the sibling PDP", () => {
    const items: Product[] = [
      {
        ...baseProduct,
        slug: "ghk-cu",
        name: "GHK-Cu",
        tagline: "Copper tripeptide",
        priceCents: 4995,
      },
      {
        ...baseProduct,
        slug: "kpv",
        name: "KPV",
        variants: [
          { label: "5mg", sku: "KPV-5", priceCents: 3995 },
          { label: "10mg", sku: "KPV-10", priceCents: 6995 },
        ],
      },
    ];
    const { getAllByTestId, getByText } = render(<PdpPairedWith items={items} />);
    expect(getByText("Pairs well with")).toBeInTheDocument();
    const cards = getAllByTestId("paired-with-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("href", "/products/ghk-cu");
    expect(cards[1]).toHaveAttribute("href", "/products/kpv");
    expect(getByText("GHK-Cu")).toBeInTheDocument();
    expect(getByText("Copper tripeptide")).toBeInTheDocument();
    expect(getByText("$49.95")).toBeInTheDocument();
    // Multi-variant sibling shows its cheapest variant as a "from" price.
    expect(getByText("From $39.95")).toBeInTheDocument();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<PdpPairedWith items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PdpAttributeRow", () => {
  it("shows category and reconstitution pills for an injectable", () => {
    const { getByTestId } = render(
      <PdpAttributeRow product={{ category: "injectable", requiresReconstitution: true }} />,
    );
    expect(getByTestId("pdp-category-pill").textContent).toBe("Injectable");
    expect(getByTestId("pdp-reconstitution-pill")).toBeInTheDocument();
  });

  it("shows only the category pill for an oral product", () => {
    const { getByTestId, queryByTestId } = render(
      <PdpAttributeRow product={{ category: "oral" }} />,
    );
    expect(getByTestId("pdp-category-pill").textContent).toBe("Oral");
    expect(queryByTestId("pdp-reconstitution-pill")).toBeNull();
  });

  it("defaults reconstitution from category=injectable when the flag is unset (catalog rule)", () => {
    const { getByTestId } = render(<PdpAttributeRow product={{ category: "injectable" }} />);
    expect(getByTestId("pdp-reconstitution-pill")).toBeInTheDocument();
  });

  it("renders nothing when neither attribute is present", () => {
    const { container } = render(<PdpAttributeRow product={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ReconstitutionNote", () => {
  it("renders the fine print only for products needing reconstitution", () => {
    const { getByTestId } = render(
      <ReconstitutionNote product={{ requiresReconstitution: true }} />,
    );
    expect(getByTestId("reconstitution-note")).toBeInTheDocument();
  });

  it("renders nothing otherwise", () => {
    const { container } = render(<ReconstitutionNote product={{ category: "oral" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
