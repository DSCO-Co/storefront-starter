import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreUnavailable } from "@/components/store-unavailable";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";
import { cartPageMetadata } from "@/lib/seo";
import { CartPageClient } from "./CartPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const resolution = await getRequestManifest();
  if (resolution?.manifest.store.status !== "live") return {};
  return cartPageMetadata(resolution.manifest);
}

export default async function CartPage() {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const { manifest } = resolution;

  if (manifest.store.status !== "live") {
    return <StoreUnavailable brandName={manifest.brand.name} />;
  }

  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-12">
      <a href="/products" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
        ← {manifest.brand.name}
      </a>
      <h1
        className="mt-6 text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Your cart
      </h1>
      <div className="mt-8">
        <CartPageClient
          storeKey={manifest.catalog.storeKey}
          promotionsEnabled={resolveBehavior(manifest).promotions.enabled}
        />
      </div>
    </main>
  );
}
