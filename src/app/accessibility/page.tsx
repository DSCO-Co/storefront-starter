import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRequestManifest } from "@/lib/request-manifest";

export const metadata: Metadata = {
  title: "Accessibility Statement",
  description: "Our commitment to an accessible store and how to report an issue.",
};

/**
 * Always-present Accessibility Statement (ADA / CA Unruh good-faith). Rendered
 * regardless of the store's template so the compliance footer link always
 * resolves — the destination the `ComplianceLinks` "Accessibility Statement"
 * link points at.
 */
export default async function AccessibilityPage() {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const brand = resolution.manifest.brand.name;
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-12" style={{ color: "var(--color-text)" }}>
      <h1 className="text-3xl font-semibold">Accessibility Statement</h1>
      <div
        className="mt-6 flex flex-col gap-4 text-sm leading-relaxed"
        style={{ color: "var(--color-muted)" }}
      >
        <p>
          {brand} is committed to making this store usable by everyone, including people who rely on
          assistive technology. We aim to conform to the Web Content Accessibility Guidelines (WCAG)
          2.1 Level AA and continually improve toward that standard.
        </p>
        <p>
          Ongoing measures include: semantic HTML and ARIA where needed, keyboard-operable controls
          with visible focus, a skip-to-content link, live-region announcements for dynamic changes
          such as cart updates and checkout messages, text alternatives for meaningful images, and
          forms with associated labels.
        </p>
        <p>
          How we enforce this: our build pipeline runs static accessibility lint rules at error
          level and automated accessibility (axe) checks against key store components — navigation,
          product purchase controls, checkout, and consent and legal surfaces — so regressions in
          those areas fail the build. Automated tooling cannot cover every WCAG criterion, so we
          also commit to reviewing new and changed pages manually, including keyboard-only and
          screen-reader passes.
        </p>
        <p>
          No automated process catches everything. If you encounter a barrier — a page you can't
          navigate, content a screen reader can't read, or anything that makes the store hard to use
          — please tell us and we will work to fix it and provide the information or service you
          need through an alternate channel in the meantime.
        </p>
        <p>
          <strong>Report an accessibility issue:</strong> contact our support team (the chat widget
          on any page) or email support, and reference the page URL and what went wrong.
        </p>
      </div>
    </main>
  );
}
