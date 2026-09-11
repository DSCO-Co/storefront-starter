/**
 * The two 404 surfaces (audit P0-4): a resolvable host's bad slug gets a
 * THEMED in-store "Page not found" with a way back home; only a genuinely
 * unknown host gets the bare hardcoded-dark shell (there is no store to
 * theme with and no home to link to). Regression pin for the bug where a
 * light store's bad slug rendered the dark "This store could not be found"
 * dead end.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import designLight from "@/fixtures/manifests/design-light.json";
import { storeManifestSchema } from "@/lib/manifest";
import type { ManifestResolution } from "@/lib/manifest-source";
import NotFound from "./not-found";

const mocks = vi.hoisted(() => ({
  getRequestManifest: vi.fn<() => Promise<ManifestResolution | null>>(),
}));
vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: mocks.getRequestManifest,
}));
const { getRequestManifest } = mocks;

afterEach(cleanup);
beforeEach(() => getRequestManifest.mockReset());

function resolution(): ManifestResolution {
  const manifest = storeManifestSchema.parse(designLight);
  return {
    storeId: manifest.store.id,
    tenantRef: "design-light",
    status: manifest.store.status,
    manifest,
  };
}

describe("NotFound", () => {
  it("renders a themed in-store 404 with a home link when the host resolves", async () => {
    getRequestManifest.mockResolvedValue(resolution());
    const { container } = render(await NotFound());
    expect(container.querySelector('[data-testid="store-not-found"]')).not.toBeNull();
    expect(container.textContent).toContain("Page not found");
    const home = container.querySelector("a.fd-btn");
    expect(home?.getAttribute("href")).toBe("/");
    expect(home?.textContent).toContain(resolution().manifest.brand.name);
    // Token-painted, never the unknown-host hardcoded dark shell.
    expect(container.innerHTML).not.toContain("#0b0d12");
    expect(container.textContent).not.toContain("This store could not be found");
  });

  it("keeps the bare dark document shell ONLY when the host itself doesn't resolve", async () => {
    getRequestManifest.mockResolvedValue(null);
    const { container } = render(await NotFound());
    expect(container.textContent).toContain("This store could not be found");
    expect(container.textContent).not.toContain("Page not found");
    expect(container.querySelector('[data-testid="store-not-found"]')).toBeNull();
  });
});
