/**
 * /policies/[slug] — the manifest-driven legal-page route the compliance
 * footer links, the sitemap entries, and the middleware's conventional
 * aliases (/terms, /privacy, …) all land on. Pins: a live store renders the
 * matched policy document; an unknown slug is an honest 404 (never an empty
 * page and never an invented default document).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import bioManifestRaw from "@/fixtures/manifests/store-0-bio-archetype.json";
import { storeManifestSchema } from "@/lib/manifest";

const getRequestManifestMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));

const manifest = storeManifestSchema.parse(bioManifestRaw);

function resolution() {
  return { tenantRef: "store-0", storeId: "store-0", status: "live" as const, manifest };
}

async function importPage() {
  return import("./page");
}

/** Flatten a rendered server-component tree to its text content. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props: { children?: unknown } }).props;
    return textOf(props.children);
  }
  return "";
}

describe("/policies/[slug]", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the store's policy document for a known slug", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    const { default: PolicyPage } = await importPage();
    const tree = await PolicyPage({ params: Promise.resolve({ slug: "privacy" }) });
    const text = textOf(tree);
    expect(text).toContain("Privacy");
  });

  it("404s an unknown slug — an honest absence, never an invented default", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    const { default: PolicyPage } = await importPage();
    await expect(PolicyPage({ params: Promise.resolve({ slug: "warranty" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("404s when the host resolves to no store", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { default: PolicyPage } = await importPage();
    await expect(PolicyPage({ params: Promise.resolve({ slug: "privacy" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("generateMetadata resolves canonical /policies/{slug} metadata for a known page", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    const { generateMetadata } = await importPage();
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "privacy" }) });
    expect(meta.title).toBeTruthy();
  });

  it("generateMetadata returns {} for an unknown slug", async () => {
    getRequestManifestMock.mockResolvedValue(resolution());
    const { generateMetadata } = await importPage();
    expect(await generateMetadata({ params: Promise.resolve({ slug: "warranty" }) })).toEqual({});
  });
});
