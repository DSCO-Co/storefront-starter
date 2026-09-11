import { describe, expect, it } from "vitest";
import leoResearch from "@/fixtures/manifests/store-leo-research.json";
import { type StoreManifest, storeManifestSchema } from "@/lib/manifest";
import { readProductSlugAliases, resolveProductSlugAlias } from "@/lib/product-aliases";

function manifestWithAliases(aliases: unknown): StoreManifest {
  return storeManifestSchema.parse({
    ...leoResearch,
    catalog: { ...(leoResearch as { catalog: object }).catalog, slugAliases: aliases },
  });
}

describe("readProductSlugAliases", () => {
  it("reads the manifest-driven old→current map", () => {
    const manifest = manifestWithAliases({ "bpc-157-old": "bpc-157", "kpv-legacy": "kpv" });
    expect(readProductSlugAliases(manifest)).toEqual({
      "bpc-157-old": "bpc-157",
      "kpv-legacy": "kpv",
    });
  });

  it("drops self-aliases (a redirect loop) and empty targets", () => {
    const manifest = manifestWithAliases({ same: "same", empty: "", ok: "current" });
    expect(readProductSlugAliases(manifest)).toEqual({ ok: "current" });
  });

  it("degrades to {} for a malformed map — never throws", () => {
    expect(readProductSlugAliases(manifestWithAliases({ bad: 42 }))).toEqual({});
    expect(readProductSlugAliases(storeManifestSchema.parse(leoResearch))).toEqual({});
  });
});

describe("resolveProductSlugAlias", () => {
  const manifest = manifestWithAliases({ "bpc-157-old": "bpc-157" });

  it("returns the current slug for a known alias", () => {
    expect(resolveProductSlugAlias(manifest, "bpc-157-old")).toBe("bpc-157");
  });

  it("returns null for a slug that is not an alias (a live product falls through)", () => {
    expect(resolveProductSlugAlias(manifest, "bpc-157")).toBeNull();
  });
});
