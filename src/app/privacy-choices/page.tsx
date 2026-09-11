import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRequestManifest } from "@/lib/request-manifest";
import { PrivacyChoicesControls } from "./privacy-choices-controls";

export const metadata: Metadata = {
  title: "Your Privacy Choices",
  description: "Exercise your CCPA/CPRA privacy choices, including opt-out of sale/sharing.",
};

/**
 * Always-present CCPA/CPRA "Your Privacy Choices" page — the destination the
 * compliance footer link points at. Explains the opt-out, that we honor Global
 * Privacy Control, and how to exercise data-subject rights. (A full self-serve
 * rights portal is a follow-up; GPC is honored server-side today.)
 */
export default async function PrivacyChoicesPage() {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const brand = resolution.manifest.brand.name;
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-12" style={{ color: "var(--color-text)" }}>
      <h1 className="text-3xl font-semibold">Your Privacy Choices</h1>
      <div
        className="mt-6 flex flex-col gap-4 text-sm leading-relaxed"
        style={{ color: "var(--color-muted)" }}
      >
        <p>
          Depending on where you live (for example, California under the CCPA/CPRA), you have the
          right to opt out of the "sale" or "sharing" of your personal information and to access,
          correct, or delete it. {brand} does not sell your personal information for money.
        </p>
        <p>
          <strong>Opt out of cross-context behavioral advertising “sharing”:</strong>
        </p>
        {/* E3: working one-click controls — opting out / withdrawing is
            exactly as easy as granting was in the banner. */}
        <PrivacyChoicesControls />
        <ul className="ml-5 flex list-disc flex-col gap-2">
          <li>
            <strong>Global Privacy Control (GPC):</strong> we honor the GPC browser signal. If your
            browser or extension sends GPC, we treat it as a valid opt-out automatically — no action
            needed.
          </li>
          <li>
            <strong>Cookie controls:</strong> decline non-essential cookies in the consent banner
            (clear your cookies for this site to bring it back), which disables
            analytics/advertising tracking.
          </li>
          <li>
            <strong>Request it directly:</strong> contact us (support chat on any page, or email) to
            exercise any privacy right. We verify requests as required by law, and you may use an
            authorized agent.
          </li>
        </ul>
        <p>We will not discriminate against you for exercising any of these rights.</p>
      </div>
    </main>
  );
}
