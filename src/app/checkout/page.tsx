import { RUO_DISCLAIMER } from "@dscodotco/storefront-sections";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreUnavailable } from "@/components/store-unavailable";
import { type Address, getAccountClient } from "@/lib/account-client";
import { getShopperSession } from "@/lib/account-session";
import { resolveBehavior } from "@/lib/manifest";
import { resolvedPricingConfig, subscriptionCadences } from "@/lib/pricing";
import { getRequestManifest } from "@/lib/request-manifest";
import { checkoutPageMetadata } from "@/lib/seo";
import { hasPolicyPage } from "@/sections/policy-page";
import { CheckoutForm } from "./CheckoutForm";

export async function generateMetadata(): Promise<Metadata> {
  const resolution = await getRequestManifest();
  if (resolution?.manifest.store.status !== "live") return {};
  return checkoutPageMetadata(resolution.manifest);
}

/**
 * Checkout page. The card form itself POSTs to this surface's own
 * `/api/checkout` Route Handler (never straight to `@dscodotco/checkout`) — see
 * that file and `lib/checkout.ts` for the platform-served boundary (ADR
 * 0003) and the tenant-resolution note.
 *
 * SEAM 1 (LOO-3050): the store's manifest shipping + FAIL-CLOSED tax policy
 * is resolved here and handed to the form so the order summary can show the
 * computed shipping + tax + total BEFORE the shopper pays (reusing the same
 * resolver the server re-prices with — never re-derived).
 *
 * SEAM 2b (LOO-3137): when the store's `accounts.addressBook` gate is on AND
 * a shopper is signed in, their saved addresses are read (honest-absence: a
 * failed read passes `null`, never a fabricated empty list) and offered as a
 * ship-to picker.
 */
async function loadSavedAddresses(addressBookEnabled: boolean): Promise<Address[] | null> {
  if (!addressBookEnabled) return null;
  const session = await getShopperSession();
  if (session === null) return null;
  const result = await getAccountClient().listAddresses(session.secret);
  // Honest-absence: a failed read is NOT "no saved addresses" — hide the
  // picker rather than claim the shopper has none.
  return result.ok ? result.value : null;
}

export default async function CheckoutPage() {
  const resolution = await getRequestManifest();
  if (!resolution) notFound();
  const { manifest } = resolution;

  if (manifest.store.status !== "live") {
    return <StoreUnavailable brandName={manifest.brand.name} />;
  }
  const behavior = resolveBehavior(manifest);

  // Checkbox-mode age gate is affirmed AT checkout (LOO-3050); interstitial
  // mode has already blocked entry in the layout, so it needs nothing here.
  const ageGate = behavior.compliance.ageGate;
  const checkoutAgeGate =
    ageGate.enabled && ageGate.mode === "checkbox" ? { minAge: ageGate.minAge } : null;

  const savedAddresses = await loadSavedAddresses(behavior.accounts.addressBook);

  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-12">
      <a href="/cart" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
        ← Back to cart
      </a>
      <h1
        className="mt-6 text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Checkout
      </h1>
      <p
        className="mt-4 max-w-2xl text-xs leading-relaxed"
        data-testid="checkout-ruo-disclaimer"
        style={{ color: "var(--color-muted)" }}
      >
        {RUO_DISCLAIMER}
      </p>
      {/* Auto-renew disclosure: when a store offers subscribe-and-save,
            CheckoutForm renders the "automatically renew … cancel anytime"
            AutoRenewDisclosure block (ARL §17600 / ROSCA / FTC
            Click-to-Cancel) before the shopper opts in — see
            checkout-autorenew-disclosure in CheckoutForm.tsx. */}
      <div className="mt-8">
        <CheckoutForm
          storeKey={manifest.catalog.storeKey}
          ageGate={checkoutAgeGate}
          storeCreditEnabled={behavior.storeCredit.enabled}
          giftCardsEnabled={behavior.giftCards.enabled}
          pricing={resolvedPricingConfig(behavior, false)}
          addressBookEnabled={behavior.accounts.addressBook}
          savedAddresses={savedAddresses}
          subscriptionCadences={subscriptionCadences(behavior)}
          promotionsEnabled={behavior.promotions.enabled}
          neverDiscountSkus={behavior.promotions.neverDiscountSkus}
          // E1 (FTC Mail Order Rule): delivery-interval labels — store config
          // when present, else conservative platform defaults; plus a link to
          // the store's shipping policy when the manifest verifiably carries
          // one (same hasPolicyPage honesty rule as the footer links).
          shippingIntervals={{
            standard: behavior.shipping.standardTransitLabel ?? "Standard (5–10 business days)",
            expedited: behavior.shipping.expeditedTransitLabel ?? "Expedited (2–4 business days)",
          }}
          shippingPolicyHref={hasPolicyPage(manifest, "shipping") ? "/policies/shipping" : null}
        />
      </div>
    </main>
  );
}
