import { describe, expect, it } from "vitest";
import { coaDocLinkUrl } from "./coa-doc-link";

describe("coaDocLinkUrl", () => {
  it("passes absolute http(s) URLs through", () => {
    expect(coaDocLinkUrl("https://docs.example.com/coa.pdf")).toBe(
      "https://docs.example.com/coa.pdf",
    );
    expect(coaDocLinkUrl("http://docs.example.com/coa.pdf")).toBe(
      "http://docs.example.com/coa.pdf",
    );
  });

  it("resolves asset: refs through the media pipeline", () => {
    const sha = "b".repeat(64);
    expect(coaDocLinkUrl(`asset:store-x/${sha}.pdf`)).toBe(`/stores/store-x/assets/${sha}.pdf`);
  });

  it("refuses a malformed asset ref", () => {
    expect(coaDocLinkUrl("asset:not-a-real-ref")).toBeNull();
  });

  it("refuses bare same-origin paths nothing serves (the /coa/*.pdf fixtures)", () => {
    expect(coaDocLinkUrl("/coa/design-dark-bpc-157-2411a.pdf")).toBeNull();
    expect(coaDocLinkUrl("coa.pdf")).toBeNull();
  });
});
