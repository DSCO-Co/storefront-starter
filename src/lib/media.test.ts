/**
 * Media-pipeline resolution tests (LOO-3043): assetRef parsing, CDN URL
 * resolution, sized-variant selection, and the next/image loader.
 */
import { describe, expect, it } from "vitest";

import { brandAssetMetadata, readBrandAssets } from "./brand-assets";
import assetImageLoader from "./image-loader";
import { assetUrl, isStoreAssetPath, parseAssetRef, readMediaEnv, sizedAssetUrl } from "./media";

const SHA = "c".repeat(64);
const REF = `asset:store-0-bio-archetype/${SHA}.png`;

describe("parseAssetRef", () => {
  it("parses the pinned asset:<storeKey>/<sha256>.<ext> format", () => {
    expect(parseAssetRef(REF)).toEqual({
      storeKey: "store-0-bio-archetype",
      sha256: SHA,
      ext: "png",
    });
  });

  it("rejects anything else (URLs, short hashes, path traversal)", () => {
    expect(parseAssetRef("https://cdn.example/x.png")).toBeNull();
    expect(parseAssetRef("asset:store/abc.png")).toBeNull();
    expect(parseAssetRef(`asset:../evil/${SHA}.png`)).toBeNull();
    expect(parseAssetRef(`asset:store/${SHA}`)).toBeNull();
    expect(parseAssetRef("")).toBeNull();
  });
});

describe("assetUrl", () => {
  it("resolves same-origin when no CDN base is configured (demo/public mode)", () => {
    const env = readMediaEnv({});
    expect(assetUrl(REF, env)).toBe(`/stores/store-0-bio-archetype/assets/${SHA}.png`);
  });

  it("prefixes the CDN base (trailing slash trimmed)", () => {
    const env = readMediaEnv({ NEXT_PUBLIC_ASSET_BASE_URL: "https://cdn.example.com/" });
    expect(assetUrl(REF, env)).toBe(
      `https://cdn.example.com/stores/store-0-bio-archetype/assets/${SHA}.png`,
    );
  });

  it("returns null for a malformed ref", () => {
    expect(assetUrl("not-a-ref", readMediaEnv({}))).toBeNull();
  });
});

describe("sizedAssetUrl", () => {
  const env = readMediaEnv({ NEXT_PUBLIC_ASSET_VARIANTS: "1" });
  const url = `/stores/store-0-bio-archetype/assets/${SHA}.png`;

  it("passes through untouched when variants are not enabled", () => {
    expect(sizedAssetUrl(url, 300, readMediaEnv({}))).toBe(url);
  });

  it("picks the smallest ladder step >= width, capping at the largest", () => {
    const base = `/stores/store-0-bio-archetype/assets/${SHA}`;
    expect(sizedAssetUrl(url, 300, env)).toBe(`${base}.w320.webp`);
    expect(sizedAssetUrl(url, 320, env)).toBe(`${base}.w320.webp`);
    expect(sizedAssetUrl(url, 641, env)).toBe(`${base}.w1280.webp`);
    expect(sizedAssetUrl(url, 4000, env)).toBe(`${base}.w1280.webp`);
  });

  it("never rewrites svg or non-asset URLs", () => {
    const svg = `/stores/store-0-bio-archetype/assets/${SHA}.svg`;
    expect(sizedAssetUrl(svg, 300, env)).toBe(svg);
    expect(sizedAssetUrl("/hero.png", 300, env)).toBe("/hero.png");
  });
});

describe("isStoreAssetPath (proxy passthrough, LOO-3150)", () => {
  it("matches same-origin asset paths, including sized variants", () => {
    expect(isStoreAssetPath(`/stores/design-dark/assets/${SHA}.png`)).toBe(true);
    expect(isStoreAssetPath(`/stores/store-0-bio-archetype/assets/${SHA}.w320.webp`)).toBe(true);
  });

  it("rejects store routes and traversal-shaped paths", () => {
    expect(isStoreAssetPath("/products/bpc-157")).toBe(false);
    expect(isStoreAssetPath("/stores/design-dark/assets/short.png")).toBe(false);
    expect(isStoreAssetPath(`/stores/../assets/${SHA}.png`)).toBe(false);
    expect(isStoreAssetPath(`/stores/design-dark/assets/${SHA}.png/extra`)).toBe(false);
  });
});

describe("readMediaEnv (client-inlining seam, LOO-3150)", () => {
  it("uses the injected env when one is passed (tests + explicit overrides)", () => {
    expect(readMediaEnv({ NEXT_PUBLIC_ASSET_BASE_URL: "https://cdn.example/" }).baseUrl).toBe(
      "https://cdn.example",
    );
  });

  it("falls back to process.env via STATIC member reads when no env is passed", () => {
    // The no-arg call must resolve from process.env (server runtime) — and the
    // implementation must keep the literal `process.env.NEXT_PUBLIC_*`
    // expressions so Next can inline them into client bundles (the dynamic
    // default-parameter version silently resolved "" in the browser).
    expect(readMediaEnv()).toEqual({
      baseUrl: (process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? "").replace(/\/+$/, ""),
      sizedVariants: process.env.NEXT_PUBLIC_ASSET_VARIANTS === "1",
    });
  });
});

describe("assetImageLoader (next/image custom loader)", () => {
  it("returns the src unchanged when variants are disabled (default env)", () => {
    const url = `/stores/store-0-bio-archetype/assets/${SHA}.png`;
    expect(assetImageLoader({ src: url, width: 640 })).toBe(url);
  });
});

describe("brand assets (manifest brand.assets seam)", () => {
  const manifest = {
    brand: {
      name: "Demo Brand",
      legalEntityRef: "legal-entity:demo",
      assets: { logoRef: REF, faviconRef: REF, ogImageRef: REF },
    },
  };

  it("reads brand.assets leniently from the passthrough brand object", () => {
    expect(readBrandAssets(manifest)).toMatchObject({ logoRef: REF });
    expect(readBrandAssets({ brand: { name: "X", legalEntityRef: "y" } })).toEqual({});
    // Malformed assets read as {} — never a render failure.
    expect(
      readBrandAssets({
        brand: { name: "X", legalEntityRef: "y", assets: 42 },
      } as unknown as Parameters<typeof readBrandAssets>[0]),
    ).toEqual({});
  });

  it("derives favicon + OG metadata from refs, contributing nothing when absent", () => {
    const meta = brandAssetMetadata(manifest);
    expect(meta.icons).toEqual({ icon: `/stores/store-0-bio-archetype/assets/${SHA}.png` });
    expect(meta.openGraph?.images).toEqual([
      { url: `/stores/store-0-bio-archetype/assets/${SHA}.png`, alt: "Demo Brand" },
    ]);

    const empty = brandAssetMetadata({ brand: { name: "X", legalEntityRef: "y" } });
    expect(empty).toEqual({});
    // A malformed ref resolves to nothing rather than a broken URL.
    const malformed = brandAssetMetadata({
      brand: { name: "X", legalEntityRef: "y", assets: { faviconRef: "https://evil/x.png" } },
    } as unknown as Parameters<typeof brandAssetMetadata>[0]);
    expect(malformed).toEqual({});
  });
});
