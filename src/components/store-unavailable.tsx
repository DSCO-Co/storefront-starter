/**
 * The kill-switch honor (ADR 0003) for routes outside `app/page.tsx`: a
 * draft/suspended store must never fall through to catalog/cart/checkout
 * content just because a shop route was hit directly. Every new shop page
 * (`/products`, `/products/[slug]`, `/cart`, `/checkout`) checks
 * `manifest.store.status` itself and renders this instead — mirrors the
 * home page's own inline copy so the message is identical everywhere.
 */
export function StoreUnavailable({ brandName }: { brandName: string }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6 text-center">
      <p style={{ color: "var(--color-muted, #666)" }}>{brandName} is not currently available.</p>
    </main>
  );
}
