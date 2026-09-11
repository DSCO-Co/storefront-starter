import { AssetImage } from "@dscodotco/storefront-sections/components/media/asset-image";
import {
  VialStage,
  VialVisual,
} from "@dscodotco/storefront-sections/components/product/vial-visual";
import { type Product, primaryImage, productNeedsReconstitution } from "@/lib/catalog-source";
import { formatCents } from "@/lib/format";

/**
 * PDP rich-content sections (ported from the parent repo's
 * `apps/storefront` PDP — overview/mechanism prose, spec table,
 * paired-with cross-sell — restyled against THIS surface's token
 * vocabulary). Every component here follows the honest-absence rule:
 * an unauthored field renders NOTHING — no placeholder copy, no invented
 * claims. The same `Product` shape arrives from both the fixture and the
 * live commerce catalog source, so there is no mode branching anywhere.
 */

const sectionHeadingStyle: React.CSSProperties = {
  letterSpacing: "0.08em",
  color: "var(--color-ink-4, var(--color-muted))",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase" style={sectionHeadingStyle}>
      {children}
    </h2>
  );
}

/** Split authored prose into paragraphs on blank lines (the legacy PDP's rule). */
function paragraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => (
      <p
        key={paragraph}
        className="mt-3 max-w-3xl text-sm leading-relaxed"
        style={{ color: "var(--color-ink-2, var(--color-text))" }}
      >
        {paragraph.trim()}
      </p>
    ));
}

/**
 * Overview + mechanism prose. Renders only the sub-sections that are
 * actually authored; both absent → the whole block is absent.
 */
export function PdpProse({ overview, mechanism }: Pick<Product, "overview" | "mechanism">) {
  if (!overview && !mechanism) return null;
  return (
    <section className="mt-10 max-w-3xl" aria-label="About this product" data-testid="pdp-prose">
      {overview ? (
        <div data-testid="pdp-overview">
          <SectionHeading>Overview</SectionHeading>
          {paragraphs(overview)}
        </div>
      ) : null}
      {mechanism ? (
        <div className={overview ? "mt-8" : undefined} data-testid="pdp-mechanism">
          <SectionHeading>Characterized mechanism (in vitro)</SectionHeading>
          {paragraphs(mechanism)}
        </div>
      ) : null}
    </section>
  );
}

/** Key/value spec table. No specs → no section. */
export function PdpSpecs({ specs }: Pick<Product, "specs">) {
  if (!specs || specs.length === 0) return null;
  return (
    <section className="mt-10 max-w-3xl" aria-label="Specifications">
      <SectionHeading>Specifications</SectionHeading>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse" data-testid="spec-table">
          <tbody>
            {specs.map((row) => (
              <tr key={row.label}>
                <td
                  className="border-b py-2.5 pr-4 text-[13px]"
                  style={{
                    borderColor: "var(--color-line-soft, var(--color-border))",
                    color: "var(--color-ink-3, var(--color-muted))",
                  }}
                >
                  {row.label}
                </td>
                <td
                  className="border-b py-2.5 text-right text-[12.5px]"
                  style={{
                    fontFamily: "var(--font-data)",
                    letterSpacing: "0.02em",
                    borderColor: "var(--color-line-soft, var(--color-border))",
                    color: "var(--color-ink-1, var(--color-text))",
                  }}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Join a product's `pairedWith` refs ({slug, name}) to the full sibling
 * products in the loaded catalog, preserving ref order. A ref whose slug is
 * no longer in the catalog (stale authoring) is dropped — a paired card is
 * never rendered for a product the shopper can't reach.
 */
export function resolvePairedProducts(
  pairedWith: NonNullable<Product["pairedWith"]> | undefined,
  products: Product[],
): Product[] {
  if (!pairedWith || pairedWith.length === 0) return [];
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  return pairedWith
    .map((pair) => bySlug.get(pair.slug))
    .filter((product): product is Product => product !== undefined);
}

/** A paired product's "from" price — cheapest variant, else the product price. */
function fromPriceCents(product: Product): number {
  return product.variants.length > 0
    ? Math.min(...product.variants.map((variant) => variant.priceCents))
    : product.priceCents;
}

/**
 * "Pairs well with" cross-sell cards (name / tagline / price / image),
 * each linking to the sibling PDP. Empty → no section.
 */
export function PdpPairedWith({ items }: { items: Product[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-10" aria-label="Pairs well with" data-testid="paired-with">
      <SectionHeading>Pairs well with</SectionHeading>
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((product) => {
          const image = primaryImage(product);
          const from = fromPriceCents(product);
          return (
            <li key={product.slug}>
              <a
                href={`/products/${product.slug}`}
                className="flex h-full items-center gap-4 p-4"
                data-testid="paired-with-card"
                style={{
                  border: "1px solid var(--color-line-soft, var(--color-border))",
                  borderRadius: "var(--radius-lg, 16px)",
                  backgroundColor:
                    "color-mix(in srgb, var(--color-surface-1, var(--color-surface)) 94%, transparent)",
                }}
              >
                <span className="block h-20 w-20 shrink-0 overflow-hidden">
                  {image ? (
                    <AssetImage
                      assetRef={image.assetRef}
                      alt={image.alt}
                      width={160}
                      height={160}
                      sizes="80px"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <VialStage size="thumb" className="h-full">
                      <VialVisual name={product.name.toUpperCase()} size="thumb" />
                    </VialStage>
                  )}
                </span>
                <span className="block min-w-0">
                  <span
                    className="block text-sm font-semibold"
                    style={{ color: "var(--color-ink-1, var(--color-text))" }}
                  >
                    {product.name}
                  </span>
                  {product.tagline ? (
                    <span
                      className="mt-0.5 block truncate text-xs"
                      style={{ color: "var(--color-ink-3, var(--color-muted))" }}
                    >
                      {product.tagline}
                    </span>
                  ) : null}
                  <span
                    className="mt-1.5 block text-xs"
                    style={{
                      fontFamily: "var(--font-data)",
                      letterSpacing: "0.04em",
                      color: "var(--color-ink-2, var(--color-text))",
                    }}
                  >
                    {product.variants.length > 1 ? "From " : ""}
                    {formatCents(from)}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Human label per catalog category enum value. */
const CATEGORY_LABELS: Record<string, string> = {
  injectable: "Injectable",
  oral: "Oral",
};

function AttributePill({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <span
      className="px-2.5 py-1 text-[10px] font-semibold uppercase"
      data-testid={testId}
      style={{
        fontFamily: "var(--font-data)",
        letterSpacing: "0.12em",
        border: "1px solid var(--color-line, var(--color-border))",
        borderRadius: "var(--radius-pill, 9999px)",
        color: "var(--color-ink-3, var(--color-muted))",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Small attribute pills near the purchase panel: the catalog category and,
 * when the product ships lyophilized, a reconstitution marker. Neither
 * attribute present → no row.
 */
export function PdpAttributeRow({
  product,
}: {
  product: Pick<Product, "category" | "requiresReconstitution">;
}) {
  const reconstitution = productNeedsReconstitution(product);
  if (!product.category && !reconstitution) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="pdp-attributes">
      {product.category ? (
        <AttributePill testId="pdp-category-pill">
          {CATEGORY_LABELS[product.category] ?? product.category}
        </AttributePill>
      ) : null}
      {reconstitution ? (
        <AttributePill testId="pdp-reconstitution-pill">Requires reconstitution</AttributePill>
      ) : null}
    </div>
  );
}

/**
 * The reconstitution fine print under the purchase panel (legacy PDP's
 * note, trimmed of its "sold separately" upsell — this catalog doesn't
 * necessarily carry a solution product).
 */
export function ReconstitutionNote({
  product,
}: {
  product: Pick<Product, "category" | "requiresReconstitution">;
}) {
  if (!productNeedsReconstitution(product)) return null;
  return (
    <p
      className="mt-4 max-w-xl text-xs leading-relaxed"
      data-testid="reconstitution-note"
      style={{ color: "var(--color-ink-4, var(--color-muted))" }}
    >
      Supplied as lyophilized powder. Reconstitution is required to bring this material into
      solution for laboratory work.
    </p>
  );
}
