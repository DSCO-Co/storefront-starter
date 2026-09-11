/**
 * LOO-3050: legal pages must answer their conventional URLs. Fixture Store #0
 * ships split shipping/returns pages; a freshly provisioned store ships the
 * combined shipping-returns page — findPolicyPage bridges both via synonyms
 * (the proxy's /terms,/privacy,… aliases land here).
 */

import { describe, expect, it } from "vitest";
import bioManifestRaw from "@/fixtures/manifests/store-0-bio-archetype.json";
import { storeManifestSchema } from "@/lib/manifest";
import { findPolicyPage } from "@/sections/policy-page";

const bio = storeManifestSchema.parse(bioManifestRaw);

/** The provisioning legal-pack shape (combined shipping-returns page). */
const provisioned = storeManifestSchema.parse({
  ...bioManifestRaw,
  catalog: { storeKey: "store-fresh" },
  domains: { primary: "fresh.example", aliases: [] },
  template: {
    id: "base-v1",
    sections: [
      { type: "policy-page", props: { slug: "terms", title: "Terms of Service", body: "t" } },
      { type: "policy-page", props: { slug: "privacy", title: "Privacy Policy", body: "p" } },
      {
        type: "policy-page",
        props: { slug: "shipping-returns", title: "Shipping & Returns", body: "s" },
      },
      {
        type: "policy-page",
        props: { slug: "ruo-terms", title: "Research Use Only Terms", body: "r" },
      },
    ],
  },
});

describe("findPolicyPage synonyms", () => {
  it("a freshly provisioned store answers /terms and /privacy (the LOO-3050 'done' bar)", () => {
    expect(findPolicyPage(provisioned, "terms")?.title).toBe("Terms of Service");
    expect(findPolicyPage(provisioned, "privacy")?.title).toBe("Privacy Policy");
    expect(findPolicyPage(provisioned, "ruo-terms")?.title).toBe("Research Use Only Terms");
  });

  it("legacy split slugs resolve the combined pack page and vice versa", () => {
    // Pack store answering the split-convention URLs:
    expect(findPolicyPage(provisioned, "shipping")?.slug).toBe("shipping-returns");
    expect(findPolicyPage(provisioned, "returns")?.slug).toBe("shipping-returns");
    // Fixture store (split pages) answering the combined URL:
    expect(["shipping", "returns"]).toContain(findPolicyPage(bio, "shipping-returns")?.slug);
  });

  it("exact slugs always win over synonyms", () => {
    expect(findPolicyPage(bio, "shipping")?.slug).toBe("shipping");
    expect(findPolicyPage(bio, "terms")?.slug).toBe("terms");
  });

  it("unknown slugs still 404 (null)", () => {
    expect(findPolicyPage(provisioned, "warranty")).toBeNull();
  });
});
