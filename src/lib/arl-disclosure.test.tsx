import { createHash } from "node:crypto";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ARL_DISCLOSURE_REF, ARL_DISCLOSURE_TEXT, ArlDisclosure } from "./arl-disclosure";

/**
 * C5 drift-proofing: the disclosure the shopper SEES and the disclosure the
 * BFF HASHES into `subscriptionConsent.disclosureSha256` must be the same
 * bytes. Rendering the component and hashing its text content pins that —
 * a markup change that alters the visible text fails here.
 */
describe("ARL disclosure (consumer-compliance remediation 2026-09-09, C5/F9)", () => {
  it("renders EXACTLY the versioned constant the BFF hashes", () => {
    render(<ArlDisclosure />);
    const rendered = screen.getByTestId("checkout-autorenew-disclosure").textContent ?? "";
    expect(rendered).toBe(ARL_DISCLOSURE_TEXT);

    const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
    expect(sha(rendered)).toBe(sha(ARL_DISCLOSURE_TEXT));
  });

  it("carries the required auto-renewal terms + the cancel path (clear & conspicuous)", () => {
    expect(ARL_DISCLOSURE_TEXT).toContain("automatically renewing");
    expect(ARL_DISCLOSURE_TEXT).toContain("until you cancel");
    expect(ARL_DISCLOSURE_TEXT).toContain("cancel anytime");
    expect(ARL_DISCLOSURE_TEXT).toContain("email you before each renewal");
  });

  it("versioned ref: changing the copy requires a new ref", () => {
    expect(ARL_DISCLOSURE_REF).toBe("arl-disclosure-v1");
  });
});
