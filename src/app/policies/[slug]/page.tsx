import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreUnavailable } from "@/components/store-unavailable";
import { getRequestManifest } from "@/lib/request-manifest";
import { policyPageMetadata } from "@/lib/seo";
import { findPolicyPage } from "@/sections/policy-page";

type PolicyParams = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PolicyParams): Promise<Metadata> {
  const [{ slug }, resolution] = await Promise.all([params, getRequestManifest()]);
  if (resolution?.manifest.store.status !== "live") return {};
  const page = findPolicyPage(resolution.manifest, decodeURIComponent(slug));
  if (!page) return {};
  return policyPageMetadata(resolution.manifest, page);
}

/**
 * Manifest-driven legal page route (`/policies/{slug}`). The content carrier
 * is the `policy-page` section (`@/sections/policy-page`): a store's manifest
 * lists one section per legal document (terms / privacy / shipping / returns /
 * ruo-terms), and this route renders the matching one. The proxy's
 * conventional aliases (`/terms`, `/privacy`, … — `lib/policy-aliases.ts`,
 * rewritten in `src/middleware.ts`) and the sitemap/footer links
 * (`lib/seo.ts`, `sections/legal-footer.tsx`) all land here.
 *
 * An unknown slug is an HONEST 404 — never an empty page pretending the
 * document exists, and never a default document pretending the store
 * published one. `findPolicyPage` already bridges the slug-synonym
 * conventions (shipping/returns vs the provisioning pack's combined
 * shipping-returns), so a miss here means the store genuinely carries no
 * such policy.
 *
 * Body is plain-text paragraphs (blank-line separated, schema-enforced —
 * never raw HTML), rendered as <p> blocks.
 */
export default async function PolicyPage({ params }: PolicyParams) {
  const [{ slug }, resolution] = await Promise.all([params, getRequestManifest()]);
  if (!resolution) notFound();
  const { manifest } = resolution;

  if (manifest.store.status !== "live") {
    return <StoreUnavailable brandName={manifest.brand.name} />;
  }

  const page = findPolicyPage(manifest, decodeURIComponent(slug));
  if (!page) notFound();

  const paragraphs = page.body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-12" style={{ color: "var(--color-text)" }}>
      <h1 className="text-3xl font-semibold">{page.title}</h1>
      <div
        className="mt-6 flex flex-col gap-4 text-sm leading-relaxed"
        style={{ color: "var(--color-muted)" }}
      >
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </main>
  );
}
