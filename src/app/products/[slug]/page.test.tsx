/**
 * PDP rich-content render parity: the page renders the rich editorial
 * fields (tagline, images, COA docs) from whatever CatalogSource feeds it —
 * fixture and live sources produce the SAME `Product` shape (see
 * catalog-source.test.ts's mapping coverage), so this pins the render leg:
 * WITH rich fields they appear; WITHOUT them the page renders honestly
 * (no tagline, no COA section, the vial-visual text fallback) — never
 * invented copy.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import bioArchetypeManifest from "@/fixtures/manifests/store-0-bio-archetype.json";
import type { Product } from "@/lib/catalog-source";
import { storeManifestSchema } from "@/lib/manifest";
import type { ManifestResolution } from "@/lib/manifest-source";
import ProductDetailPage from "./page";

const manifest = storeManifestSchema.parse(bioArchetypeManifest);
const resolution: ManifestResolution = {
  storeId: manifest.store.id,
  tenantRef: manifest.catalog.storeKey,
  status: manifest.store.status,
  manifest,
};

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => Promise.resolve(resolution),
}));
vi.mock("@/lib/account-session", () => ({
  isShopperSignedIn: () => Promise.resolve(false),
}));

const getProductMock = vi.fn<(tenant: string, slug: string) => Promise<Product | null>>();
const listProductsMock = vi.fn<(tenant: string) => Promise<Product[]>>();
vi.mock("@/lib/catalog-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog-source")>();
  return {
    ...actual,
    getCatalogSource: () => ({
      getProduct: getProductMock,
      listProducts: listProductsMock,
    }),
  };
});

const PAIRED_SIBLING: Product = {
  slug: "ghk-cu",
  name: "GHK-Cu",
  tagline: "Copper tripeptide",
  priceCents: 4995,
  variants: [{ label: "50mg", sku: "DEMO-GHK-50", priceCents: 4995 }],
  coaDocs: [],
};

const RICH_PRODUCT: Product = {
  slug: "bpc-157",
  name: "BPC-157",
  tagline: "Pentadecapeptide",
  description: "Synthetic pentadecapeptide.",
  category: "injectable",
  requiresReconstitution: true,
  overview: "Lot-released reference peptide.",
  mechanism: "Characterized in cell-culture models.",
  specs: [{ label: "Format", value: "Lyophilized powder" }],
  pairedWith: [
    { slug: "ghk-cu", name: "GHK-Cu" },
    { slug: "retired", name: "Retired" },
  ],
  priceCents: 5995,
  variants: [{ label: "5mg", sku: "DEMO-BPC-5", priceCents: 5995 }],
  images: [{ assetRef: `asset:store-0-bio-archetype/${"a".repeat(64)}.png`, alt: "BPC-157 vial" }],
  coaDocs: [
    {
      label: "Purity (HPLC + MS)",
      url: "/coa/bpc-157-purity.pdf",
      docType: "purity",
      lotNumber: "DEMO-LOT-001",
      testDate: "2026-05-12",
    },
  ],
};

const THIN_PRODUCT: Product = {
  slug: "bpc-157",
  name: "BPC-157",
  priceCents: 5995,
  variants: [{ label: "5mg", sku: "DEMO-BPC-5", priceCents: 5995 }],
  coaDocs: [],
};

async function renderPdp() {
  const page = await ProductDetailPage({
    params: Promise.resolve({ slug: "bpc-157" }),
    searchParams: Promise.resolve({}),
  });
  return render(page);
}

afterEach(() => {
  cleanup();
  getProductMock.mockReset();
  listProductsMock.mockReset();
});

describe("PDP rich-content rendering", () => {
  it("renders tagline, description, product image, and COA docs when the product carries them", async () => {
    getProductMock.mockResolvedValue(RICH_PRODUCT);
    listProductsMock.mockResolvedValue([RICH_PRODUCT, PAIRED_SIBLING]);
    const { getByText, getByAltText, queryByText } = await renderPdp();

    expect(getByText("BPC-157")).toBeInTheDocument();
    expect(getByText("Pentadecapeptide")).toBeInTheDocument();
    expect(getByText("Synthetic pentadecapeptide.")).toBeInTheDocument();
    expect(getByAltText("BPC-157 vial")).toBeInTheDocument();
    expect(getByText("Certificates of analysis")).toBeInTheDocument();
    expect(getByText(/Purity \(HPLC \+ MS\)/)).toBeInTheDocument();
    expect(getByText(/Lot DEMO-LOT-001/)).toBeInTheDocument();
    // The vial-text fallback must NOT render when a real image exists.
    expect(queryByText("BPC-157", { selector: "text" })).toBeNull();
  });

  it("renders overview, mechanism, specs, attributes, and paired-with cards when authored", async () => {
    getProductMock.mockResolvedValue(RICH_PRODUCT);
    listProductsMock.mockResolvedValue([RICH_PRODUCT, PAIRED_SIBLING]);
    const { getByText, getByTestId, getAllByTestId } = await renderPdp();

    expect(getByText("Overview")).toBeInTheDocument();
    expect(getByText("Lot-released reference peptide.")).toBeInTheDocument();
    expect(getByText("Characterized mechanism (in vitro)")).toBeInTheDocument();
    expect(getByText("Characterized in cell-culture models.")).toBeInTheDocument();
    expect(getByTestId("spec-table")).toBeInTheDocument();
    expect(getByText("Lyophilized powder")).toBeInTheDocument();
    expect(getByTestId("pdp-category-pill").textContent).toBe("Injectable");
    expect(getByTestId("pdp-reconstitution-pill")).toBeInTheDocument();
    expect(getByTestId("reconstitution-note")).toBeInTheDocument();
    // Paired-with: only the ref that resolves against the catalog gets a card,
    // and the card links to the sibling PDP with tagline + price.
    const cards = getAllByTestId("paired-with-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("href", "/products/ghk-cu");
    expect(getByText("Copper tripeptide")).toBeInTheDocument();
    expect(getByText("$49.95")).toBeInTheDocument();
  });

  it("renders honestly WITHOUT rich fields: no tagline, no COA section, vial-visual fallback", async () => {
    getProductMock.mockResolvedValue(THIN_PRODUCT);
    const { queryByText, container } = await renderPdp();

    expect(queryByText("Pentadecapeptide")).toBeNull();
    expect(queryByText("Certificates of analysis")).toBeNull();
    // No <img>: the SVG vial fallback stands in for missing imagery.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    // None of the rich sections invent themselves for an unauthored product —
    // and the catalog list read is never made when there are no pairings.
    expect(queryByText("Overview")).toBeNull();
    expect(queryByText("Characterized mechanism (in vitro)")).toBeNull();
    expect(container.querySelector('[data-testid="spec-table"]')).toBeNull();
    expect(container.querySelector('[data-testid="pdp-attributes"]')).toBeNull();
    expect(container.querySelector('[data-testid="paired-with"]')).toBeNull();
    expect(listProductsMock).not.toHaveBeenCalled();
  });
});
