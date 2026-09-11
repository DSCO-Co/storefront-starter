import { z } from "zod";

/**
 * Store manifest v0 — THE contract between the storefront renderer and
 * `services/stores` (built in a parallel lane). Do not change shapes here
 * without coordinating with that lane; additive optional fields only.
 *
 * Lenient-read on purpose (`passthrough`): a newer manifest with extra fields
 * must still render on an older renderer.
 */

export const storeStatusSchema = z.enum(["draft", "live", "suspended"]);
export type StoreStatus = z.infer<typeof storeStatusSchema>;

// `manifestSectionSchema`/`ManifestSection` and the `ResolvedBehavior` shape
// moved to `@dscodotco/storefront-sections` (section-relevant types). Re-exported
// so `@/lib/manifest` callers are unchanged; server-side resolution
// (`storeManifestSchema`, `resolveBehavior`, seo mode) stays here.
import {
  type ManifestSection,
  manifestSectionSchema,
  type ResolvedBehavior,
} from "@dscodotco/storefront-sections/model/manifest";

export type { ManifestSection, ResolvedBehavior };
export { manifestSectionSchema };

export const storeManifestSchema = z
  .object({
    version: z.literal(0),
    store: z
      .object({
        id: z.string(),
        slug: z.string(),
        status: storeStatusSchema,
      })
      .passthrough(),
    brand: z
      .object({
        name: z.string(),
        legalEntityRef: z.string(),
        /** Media-lane contract (verbatim wave-13 shape): media-pipeline refs. */
        assets: z
          .object({
            logoRef: z.string().optional(),
            faviconRef: z.string().optional(),
            ogImageRef: z.string().optional(),
          })
          .optional(),
      })
      .passthrough(),
    domains: z
      .object({
        primary: z.string(),
        aliases: z.array(z.string()).default([]),
      })
      .passthrough(),
    theme: z
      .object({
        /** DTCG design-token JSON (nested groups, leaves carry `$value`).
         *  ARBITRARY extra token groups are welcome (LOO-3167) — the
         *  flattener emits every leaf as a CSS var, so a store can mint its
         *  own `--my-brand-*` vocabulary without any renderer change. */
        tokens: z.record(z.unknown()),
        /** Per-store custom stylesheet (LOO-3167) — the LAST rung of the
         *  extension ladder. Sanitized (lib/custom-css.ts) and served scoped
         *  under the store's root selector (lib/custom-css-scope.ts) by the
         *  store layout. Lenient: a malformed value degrades to absent — the
         *  store renders without its custom CSS, never breaks. The stores
         *  module's lenient-read manifest passes the key through untouched. */
        customCss: z.string().optional().catch(undefined),
      })
      .passthrough(),
    template: z
      .object({
        id: z.literal("base-v1"),
        sections: z.array(manifestSectionSchema),
      })
      .passthrough(),
    catalog: z
      .object({
        storeKey: z.string(),
      })
      .passthrough(),
    comms: z
      .object({
        senderDomain: z.string(),
      })
      .passthrough(),
    refs: z
      .object({
        secretsRef: z.string(),
        pixels: z.record(z.string()).optional(),
      })
      .passthrough(),
    /**
     * SEO/compliance posture (inventory #121/#127 — the scanner-facing
     * surface). `locked` emits a one-URL sitemap + `Disallow: /` robots (the
     * RUO lockdown a merchant scanner sees); `open` emits the full catalog
     * sitemap + permissive robots. ABSENT ⇒ `locked` — the safe default for
     * RUO stores (`resolveSeoMode`). Store #0 / any preview store is FORCED
     * locked regardless of this flag.
     */
    seo: z
      .object({
        mode: z.enum(["open", "locked"]),
      })
      .passthrough()
      .optional(),
    /**
     * A preview store is force-noindexed. Now writable through the stores
     * service (wave 13); `behavior.access.noindex` is the successor knob —
     * either forces noindex. Both bundled fixtures set it.
     */
    preview: z.boolean().optional(),
    /**
     * Per-store support contact (LOO-3050 item 7). Read leniently; comms
     * templates fall back to nothing brand-foreign when absent.
     */
    support: z
      .object({
        supportEmail: z.string().catch(""),
        replyTo: z.string().optional().catch(undefined),
      })
      .passthrough()
      .optional()
      .catch(undefined),
    /**
     * Per-store behavior/gating config (store-behavior-config-spec §2).
     * LENIENT-READ with per-key `.catch()` — a malformed key degrades to
     * "absent" (the resolver's default) instead of failing the manifest.
     * NEVER read raw: `resolveBehavior()` below is the only consumer surface.
     */
    behavior: z
      .object({
        vertical: z.enum(["ruo", "open-ecommerce"]).optional().catch(undefined),
        gating: z
          .object({
            funnelGuard: z
              .object({
                enabled: z.boolean().catch(false),
                // P8: explicit mode supersedes the bare boolean ("challenge"
                // = the verification wall; enabled:true alone maps to it).
                mode: z.enum(["off", "challenge"]).optional().catch(undefined),
                challengeThreshold: z.number().int().optional().catch(undefined),
                requireAgeConfirmation: z.boolean().optional().catch(undefined),
                turnstileSiteKey: z.string().optional().catch(undefined),
                cookieTtlSeconds: z.number().int().optional().catch(undefined),
                absoluteCeilingHours: z.number().int().optional().catch(undefined),
                outageGraceSeconds: z.number().int().optional().catch(undefined),
                exemptPaths: z.array(z.string()).optional().catch(undefined),
                admitCookieDays: z.number().int().optional().catch(undefined),
                browseTokenMinutes: z.number().int().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
            adLanding: z
              .object({
                enabled: z.boolean().catch(false),
                safePageSlug: z.string().optional().catch(undefined),
                gateSlug: z.string().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
            coldVisitorMode: z.enum(["open", "members-mask"]).optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        access: z
          .object({ noindex: z.boolean().optional().catch(undefined) })
          .optional()
          .catch(undefined),
        /** Shopper accounts gate (LOO-3133). Sibling schemas in
         *  services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same keys. */
        accounts: z
          .object({
            enabled: z.boolean().optional().catch(undefined),
            passkeys: z.boolean().optional().catch(undefined),
            orderHistory: z.boolean().optional().catch(undefined),
            subscriptionSelfServe: z.boolean().optional().catch(undefined),
            addressBook: z.boolean().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        checkout: z
          .object({
            requireAccount: z.boolean().optional().catch(undefined),
            /** LOO-3041 Layer 2 — per-store opt-in to the cross-store wallet
             *  (RUO Pay). FOLD-WIRE (fd-w15-wallet): added
             *  ADDITIVELY next to requireAccount; the sibling schemas live in
             *  services/stores/src/lib/manifest.ts and
             *  packages/provisioning/src/behavior.ts and carry the same key. */
            wallet: z.boolean().optional().catch(undefined),
            /** TEST-ORDER lane (LOO-3049): RESERVED — no storefront
             *  test-order UI or BFF route exists yet, so this flag currently
             *  gates nothing. Orders are flagged is_test via the commerce
             *  operator route (POST /v1/tenants/:t/orders/:id/test-flag,
             *  migration 0018), which excludes them from money reports and
             *  labels them TEST in the portal. */
            testOrder: z.boolean().optional().catch(undefined),
            sessionTtlMinutes: z.number().int().optional().catch(undefined),
            requiredProfileFields: z
              .array(z.enum(["email", "name", "phone"]))
              .optional()
              .catch(undefined),
            addressVerification: z
              .object({ provider: z.enum(["none", "smarty"]).catch("none") })
              .optional()
              .catch(undefined),
            deferredCollection: z
              .object({
                enabled: z.boolean().catch(false),
                payLinkTtlDays: z.number().int().optional().catch(undefined),
                reminderSequenceRef: z.string().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        compliance: z
          .object({
            acknowledgmentGate: z
              .object({
                enabled: z.boolean().catch(false),
                disclosureRef: z.string().optional().catch(undefined),
                persistConsentRow: z.boolean().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
            cookieConsent: z
              .object({
                enabled: z.boolean().catch(false),
                regions: z.enum(["all", "eu-uk", "us-ca"]).optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
            ageGate: z
              .object({
                enabled: z.boolean().catch(false),
                minAge: z.number().int().optional().catch(undefined),
                mode: z.enum(["interstitial", "checkbox"]).optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        /** Wishlist gate (LOO-3138). Default DISABLED. Sibling schemas in
         *  services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same key. */
        wishlist: z
          .object({
            enabled: z.boolean().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        /** Cash-backed store credit as checkout tender (LOO-3156). Default
         *  DISABLED — a new money surface ships dark. Sibling schemas in
         *  services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same key. */
        storeCredit: z
          .object({
            enabled: z.boolean().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        /** Purchasable/redeemable gift cards as checkout tender (FD Epic 19
         *  / LOO-3156) — distinct from cash-backed store credit. Default
         *  DISABLED — a new money surface ships dark. Sibling schemas in
         *  services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same key. */
        giftCards: z
          .object({
            enabled: z.boolean().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        /** Promotions gate + never-discount SKU list (LOO-3156). enabled
         *  ABSENT = true (coupons are a pre-existing live surface — a
         *  manifest with no opinion keeps them working). Sibling schemas in
         *  services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same keys. */
        promotions: z
          .object({
            enabled: z.boolean().optional().catch(undefined),
            neverDiscountSkus: z.array(z.string()).optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        /** Store search gate (LOO-3134). Sibling schemas in
         *  services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same keys. */
        search: z
          .object({
            enabled: z.boolean().optional().catch(undefined),
            typeahead: z.boolean().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        seo: z
          .object({ profile: z.enum(["open", "lockdown"]).optional().catch(undefined) })
          .optional()
          .catch(undefined),
        shipping: z
          .object({
            mode: z.literal("flat").optional().catch(undefined),
            /** E1 (FTC Mail Order Rule): the shipping-interval labels shown
             *  at checkout ("Standard (5–10 business days)"). Optional —
             *  absent falls back to the conservative platform defaults in
             *  resolveBehavior. */
            standardTransitLabel: z.string().optional().catch(undefined),
            expeditedTransitLabel: z.string().optional().catch(undefined),
            flatRateCents: z.number().int().optional().catch(undefined),
            expeditedRateCents: z.number().int().optional().catch(undefined),
            maxCents: z.number().int().optional().catch(undefined),
            freeShippingThresholdCents: z.number().int().nullable().optional().catch(undefined),
            /** Commerce-only label rate-selection policy (LOO-3052) — mirrored
             *  here for the three-way schema convention; the renderer never
             *  buys labels. Sibling schemas in
             *  services/stores/src/lib/manifest.ts and
             *  packages/provisioning/src/behavior.ts carry the same keys. */
            labelPolicy: z
              .object({
                mode: z
                  .enum(["cheapest", "cheapest-within-transit", "fixed-service"])
                  .optional()
                  .catch(undefined),
                maxTransitDays: z.number().int().optional().catch(undefined),
                preferredCarriers: z.array(z.string()).optional().catch(undefined),
                service: z.string().optional().catch(undefined),
                carrier: z.string().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        tax: z
          .object({
            provider: z.enum(["null", "flat_rate", "stripe_tax"]).optional().catch(undefined),
            rateBps: z.number().int().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        /** Commerce-only ShipStation push gate (fulfillment-queue brief) —
         *  mirrored here for the three-way schema convention; the renderer
         *  never pushes orders. Sibling schemas in
         *  services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same keys. */
        fulfillment: z
          .object({
            shipstationPush: z.boolean().optional().catch(undefined),
            shipstationStoreId: z.number().int().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        payments: z
          .object({
            blockedCardBrands: z
              .array(z.enum(["visa", "mastercard", "amex", "discover"]))
              .optional()
              .catch(undefined),
            avsCvvPolicy: z
              .object({
                avs: z.enum(["off", "warn", "enforce"]).optional().catch(undefined),
                cvv: z.enum(["off", "warn", "enforce"]).optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
            processorRedaction: z
              .object({
                prohibitedTerms: z.array(z.string()).optional().catch(undefined),
                scrubFreeform: z.boolean().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        /** Fraud & abuse floor gate (FD Epic 10). AVS/CVV decisioning +
         *  sliding-window velocity; the checkout BFF forwards the RESOLVED
         *  policy into `@dscodotco/checkout`, which enforces it before capture
         *  (bans are operator-managed in `@dscodotco/fraud`, always enforced, not
         *  declared here). Defaults are strict-ish (see resolveBehavior):
         *  cvv enforce, avs warn, a 10-per-10-minute velocity cap. Sibling
         *  schemas in services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same keys. */
        fraud: z
          .object({
            avsPolicy: z.enum(["off", "warn", "enforce"]).optional().catch(undefined),
            cvvPolicy: z.enum(["off", "warn", "enforce"]).optional().catch(undefined),
            velocity: z
              .object({
                maxPerWindow: z.number().int().optional().catch(undefined),
                windowMinutes: z.number().int().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        pricing: z
          .object({
            stackingPolicy: z.enum(["stack", "winner-takes-all"]).optional().catch(undefined),
            bulkDiscount: z
              .object({
                enabled: z.boolean().catch(false),
                vialThreshold: z.number().int().optional().catch(undefined),
                bundleThreshold: z.number().int().optional().catch(undefined),
                percent: z.number().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
            tierPricing: z
              .object({
                enabled: z.boolean().catch(false),
                tiers: z
                  .array(z.object({ ref: z.string(), percent: z.number() }))
                  .optional()
                  .catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        subscriptions: z
          .object({
            autoEnrollBundles: z.boolean().optional().catch(undefined),
            enabled: z.boolean().optional().catch(undefined),
            discounts: z.record(z.string(), z.number()).optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        billing: z
          .object({
            dunning: z
              .object({
                ladder: z.enum(["platform-standard"]).optional().catch(undefined),
                hardDeclineInstantCancel: z.boolean().optional().catch(undefined),
                /** Dunning COMMS gate (subs-compliance audit item 4): false
                 *  = the shopper gets no payment-failed/canceled emails.
                 *  Controls comms ONLY — the retry ladder is platform-fixed
                 *  (see modules/subscriptions/src/domain/store-config.ts,
                 *  the backend reader of this key). Additive optional. */
                notifyShopper: z.boolean().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
            leadDays: z.number().int().optional().catch(undefined),
            renewalReminderDaysBeforeBilling: z.number().int().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
        catalog: z
          .object({
            coaDisplay: z
              .object({
                enabled: z.boolean().catch(false),
                comingSoonCopy: z.string().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        cart: z
          .object({
            companionRules: z
              .array(
                z.object({
                  triggerCategory: z.string(),
                  companionProductId: z.string(),
                  autoAdd: z.boolean().optional().catch(undefined),
                }),
              )
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        /** Upsell surfaces gate (LOO-3136): PDP frequently-bought-together,
         *  cart/checkout "You may also like", post-purchase cross-sell.
         *  Default DISABLED — no surface renders unless a store opts in.
         *  `rules` are per-product companions (product id/slug → companion
         *  product ids); resolution ALSO consumes `cart.companionRules`
         *  (category-triggered). Sibling schemas in
         *  services/stores/src/lib/manifest.ts and
         *  packages/provisioning/src/behavior.ts carry the same keys. */
        upsells: z
          .object({
            enabled: z.boolean().optional().catch(undefined),
            rules: z
              .array(
                z.object({
                  productId: z.string(),
                  companionProductIds: z.array(z.string()),
                }),
              )
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        comms: z
          .object({
            abandonedCart: z
              .object({
                enabled: z.boolean().catch(false),
                inactivityMinutes: z.number().int().optional().catch(undefined),
                frequencyCapDays: z.number().int().optional().catch(undefined),
                sequenceRef: z.string().optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
            /** Email-capture surface (LOO-3132). Sibling schemas in
             *  services/stores/src/lib/manifest.ts and
             *  packages/provisioning/src/behavior.ts carry the same key. */
            emailCapture: z
              .object({
                enabled: z.boolean().catch(false),
                sequenceRef: z.string().optional().catch(undefined),
                placement: z.enum(["footer", "section"]).optional().catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
        referrals: z
          .object({ enabled: z.boolean().catch(false) })
          .optional()
          .catch(undefined),
        analytics: z
          .object({ browserPixelEnabled: z.boolean().optional().catch(undefined) })
          .optional()
          .catch(undefined),
      })
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough();

export type StoreManifest = z.infer<typeof storeManifestSchema>;

export type SeoMode = "open" | "locked";

/**
 * Stores that are ALWAYS noindex regardless of manifest flags. The archetype
 * demo store must never be indexable while a real client storefront serves
 * the same brand — a duplicate-content and brand-confusion hazard.
 */
export const ALWAYS_NOINDEX_STORE_KEYS: readonly string[] = ["store-0-bio-archetype"];

export function isNoindex(manifest: StoreManifest): boolean {
  return (
    manifest.behavior?.access?.noindex === true ||
    manifest.preview === true ||
    ALWAYS_NOINDEX_STORE_KEYS.includes(manifest.catalog.storeKey)
  );
}

/**
 * The effective SEO posture for sitemap/robots generation.
 *
 * A noindexed store (Store #0, `preview`, or `behavior.access.noindex`) is
 * ALWAYS `locked` — the sitemap/robots lockdown is the other half of the
 * noindex meta the layout already emits, and must never be undone by a
 * manifest flag. Otherwise `behavior.seo.profile` decides (successor knob),
 * falling back to the legacy `seo.mode`, defaulting to `open` — the
 * behavior-config-spec default inversion (§4 risk 1): the open default is
 * safe because RUO-tier stores cannot go live without an explicit gating set
 * (provisioning preflight exit-2 gate).
 */
export function resolveSeoMode(manifest: StoreManifest): SeoMode {
  if (isNoindex(manifest)) return "locked";
  const profile = manifest.behavior?.seo?.profile;
  if (profile) return profile === "lockdown" ? "locked" : "open";
  return manifest.seo?.mode ?? "open";
}

/**
 * Does this store track visitors in the browser (kill-switch tightening,
 * consumer-compliance remediation 2026-09-09 wave 2)? True when the manifest
 * opted into browser pixels OR configured at least one pixel id. Feeds
 * `cookieConsentEnforced`'s `storeHasTracking` — a store that tracks cannot
 * disable consent enforcement in enforced regions.
 */
export function storeHasBrowserTracking(
  manifest: StoreManifest,
  behavior: ResolvedBehavior,
): boolean {
  if (behavior.analytics.browserPixelEnabled) return true;
  return Object.values(manifest.refs?.pixels ?? {}).some(
    (id) => typeof id === "string" && id.trim().length > 0,
  );
}

// ── resolveBehavior — THE single behavior resolver ──────────────────────────

/**
 * Fully-resolved per-store behavior config. `resolveBehavior()` is the ONLY
 * place defaults live (modeled on `resolveSeoMode`) — components and route
 * handlers consume this, never `manifest.behavior` raw. Every default is
 * OPEN ECOMMERCE (store-behavior-config-spec §2): public, guest checkout, no
 * acknowledgment wall, open SEO. RUO-tier stores flip their set ON in the
 * manifest; provisioning preflight refuses RUO go-live with implicit gates.
 */

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function resolveBehavior(manifest: StoreManifest): ResolvedBehavior {
  const b = manifest.behavior ?? {};
  const fg = b.gating?.funnelGuard;
  const ad = b.gating?.adLanding;
  const ack = b.compliance?.acknowledgmentGate;
  const cookie = b.compliance?.cookieConsent;
  const age = b.compliance?.ageGate;
  const defc = b.checkout?.deferredCollection;
  const bulk = b.pricing?.bulkDiscount;
  const tier = b.pricing?.tierPricing;
  const coa = b.catalog?.coaDisplay;
  const abandon = b.comms?.abandonedCart;
  const capture = b.comms?.emailCapture;
  const seoProfile =
    b.seo?.profile ??
    (manifest.seo?.mode === "open"
      ? "open"
      : manifest.seo?.mode === "locked"
        ? "lockdown"
        : "open");
  return {
    // Absent vertical resolves "open-ecommerce" HERE (renderer semantics);
    // provisioning preflight treats absence as RUO fail-safe — deliberately
    // stricter than the renderer (spec §4 risk 1).
    vertical: b.vertical ?? "open-ecommerce",
    gating: {
      funnelGuard: {
        enabled: fg?.enabled ?? false,
        // The effective mode (P8): explicit mode wins; the legacy bare
        // boolean maps enabled:true -> "challenge". "off" is the default —
        // the gate ships dark until the merchant configures it AND the
        // funnel_gate add-on is installed (enforced server-side; the
        // manifest flag alone is deliberately not trusted).
        mode: fg?.mode ?? (fg?.enabled === true ? "challenge" : "off"),
        challengeThreshold: clampInt(fg?.challengeThreshold, 1, 99, 55),
        requireAgeConfirmation: fg?.requireAgeConfirmation ?? false,
        turnstileSiteKey: fg?.turnstileSiteKey ?? null,
        cookieTtlSeconds: fg?.cookieTtlSeconds ?? 900,
        absoluteCeilingHours: fg?.absoluteCeilingHours ?? 24,
        outageGraceSeconds: fg?.outageGraceSeconds ?? 300,
        exemptPaths: fg?.exemptPaths ?? [],
        admitCookieDays: fg?.admitCookieDays ?? 30,
        browseTokenMinutes: fg?.browseTokenMinutes ?? 60,
      },
      adLanding: {
        enabled: ad?.enabled ?? false,
        safePageSlug: ad?.safePageSlug ?? null,
        gateSlug: ad?.gateSlug ?? null,
      },
      coldVisitorMode: b.gating?.coldVisitorMode ?? "open",
    },
    access: { noindex: isNoindex(manifest) },
    accounts: {
      // Default TRUE (backward compat): accounts exist unless a store opts out.
      enabled: b.accounts?.enabled ?? true,
      // Default FALSE — no passkey surface exists yet (WebAuthn is "later"
      // per docs/briefs/ruo-launch-blockers-2026-08-31.md), so a store with
      // no opinion must not claim it. Flip per-store when the surface ships.
      passkeys: b.accounts?.passkeys ?? false,
      orderHistory: b.accounts?.orderHistory ?? true,
      // ARL / FTC Click-to-Cancel guard (2026-09-09 wave 2): a store that
      // SELLS subscriptions (its subscriptions gate is on, i.e. its catalog
      // carries subscription products at checkout) cannot hide the
      // self-serve cancel surface — the flag is IGNORED (treated as true)
      // whenever `subscriptions.enabled` is set. Only a store with no
      // subscription offering may turn the page off.
      subscriptionSelfServe:
        b.subscriptions?.enabled === true ? true : (b.accounts?.subscriptionSelfServe ?? true),
      // Default FALSE — an explicit per-store opt-in; gates the checkout
      // saved-address picker (LOO-3137).
      addressBook: b.accounts?.addressBook ?? false,
    },
    checkout: {
      requireAccount: b.checkout?.requireAccount ?? false,
      // Default FALSE: a store with no opinion has no wallet, and every
      // /api/wallet/* route answers as though it does not exist.
      wallet: b.checkout?.wallet ?? false,
      // Default FALSE: the test-order lane is an explicit per-store opt-in;
      // without it the test-order route answers 404 and no button renders.
      testOrder: b.checkout?.testOrder ?? false,
      sessionTtlMinutes: b.checkout?.sessionTtlMinutes ?? 60,
      requiredProfileFields: b.checkout?.requiredProfileFields ?? ["email"],
      addressVerification: { provider: b.checkout?.addressVerification?.provider ?? "none" },
      deferredCollection: {
        enabled: defc?.enabled ?? false,
        payLinkTtlDays: defc?.payLinkTtlDays ?? 14,
        reminderSequenceRef: defc?.reminderSequenceRef ?? null,
      },
    },
    compliance: {
      acknowledgmentGate: {
        enabled: ack?.enabled ?? false,
        disclosureRef: ack?.disclosureRef ?? null,
        // Non-optional mechanism when the gate is on (ARL) — default true.
        persistConsentRow: ack?.persistConsentRow ?? true,
      },
      cookieConsent: { enabled: cookie?.enabled ?? false, regions: cookie?.regions ?? "all" },
      ageGate: {
        enabled: age?.enabled ?? false,
        minAge: age?.minAge ?? 21,
        mode: age?.mode ?? "interstitial",
      },
    },
    // Default FALSE (LOO-3138): the wishlist is a new surface — it ships
    // dark and a store opts in explicitly.
    wishlist: { enabled: b.wishlist?.enabled ?? false },
    // Default FALSE (LOO-3156): store credit is a NEW money surface — it
    // ships dark until the merchant flips the /addons toggle.
    storeCredit: { enabled: b.storeCredit?.enabled ?? false },
    giftCards: { enabled: b.giftCards?.enabled ?? false },
    // Default TRUE (LOO-3156): coupons/promos are a pre-existing live
    // surface — a manifest with no opinion keeps them working (the
    // accounts/search posture, not the ship-dark one).
    promotions: {
      enabled: b.promotions?.enabled ?? true,
      neverDiscountSkus: b.promotions?.neverDiscountSkus ?? [],
    },
    // Default TRUE (backward compat): search exists unless a store opts out.
    search: {
      enabled: b.search?.enabled ?? true,
      typeahead: b.search?.typeahead ?? true,
    },
    seo: { profile: seoProfile },
    shipping: {
      mode: "flat",
      // E1: shipping-interval labels — store config when present, else the
      // conservative platform defaults (never a promise the store didn't make).
      standardTransitLabel: b.shipping?.standardTransitLabel ?? null,
      expeditedTransitLabel: b.shipping?.expeditedTransitLabel ?? null,
      flatRateCents: b.shipping?.flatRateCents ?? 895,
      expeditedRateCents: b.shipping?.expeditedRateCents ?? 1495,
      maxCents: b.shipping?.maxCents ?? 10000,
      freeShippingThresholdCents: b.shipping?.freeShippingThresholdCents ?? null,
      // A lenient-read labelPolicy that lost its mode is meaningless — null,
      // which commerce resolves to its module default.
      labelPolicy: b.shipping?.labelPolicy?.mode
        ? {
            mode: b.shipping.labelPolicy.mode,
            ...(b.shipping.labelPolicy.maxTransitDays !== undefined
              ? { maxTransitDays: b.shipping.labelPolicy.maxTransitDays }
              : {}),
            ...(b.shipping.labelPolicy.preferredCarriers !== undefined
              ? { preferredCarriers: b.shipping.labelPolicy.preferredCarriers }
              : {}),
            ...(b.shipping.labelPolicy.service !== undefined
              ? { service: b.shipping.labelPolicy.service }
              : {}),
            ...(b.shipping.labelPolicy.carrier !== undefined
              ? { carrier: b.shipping.labelPolicy.carrier }
              : {}),
          }
        : null,
    },
    tax: { provider: b.tax?.provider ?? "null", rateBps: b.tax?.rateBps ?? 0 },
    // Default FALSE (fulfillment-queue brief): ShipStation push is a new
    // external egress — it ships dark until a store opts in.
    fulfillment: {
      shipstationPush: b.fulfillment?.shipstationPush ?? false,
      shipstationStoreId: b.fulfillment?.shipstationStoreId ?? null,
    },
    payments: {
      blockedCardBrands: b.payments?.blockedCardBrands ?? [],
      avsCvvPolicy: {
        avs: b.payments?.avsCvvPolicy?.avs ?? "off",
        cvv: b.payments?.avsCvvPolicy?.cvv ?? "off",
      },
      processorRedaction: {
        prohibitedTerms: b.payments?.processorRedaction?.prohibitedTerms ?? [],
        // Scrub mechanism is an always-on platform invariant (#81).
        scrubFreeform: b.payments?.processorRedaction?.scrubFreeform ?? true,
      },
    },
    // Strict-ish default fraud floor (FD Epic 10): a CVV mismatch declines,
    // an AVS mismatch only flags (partial AVS matches are common and
    // over-declining them loses real orders), and a 10-attempt / 10-minute
    // velocity cap. A store tunes any of these down (or off) in its manifest.
    fraud: {
      avsPolicy: b.fraud?.avsPolicy ?? "warn",
      cvvPolicy: b.fraud?.cvvPolicy ?? "enforce",
      velocity: {
        maxPerWindow: b.fraud?.velocity?.maxPerWindow ?? 10,
        windowMinutes: b.fraud?.velocity?.windowMinutes ?? 10,
      },
    },
    pricing: {
      stackingPolicy: b.pricing?.stackingPolicy ?? "stack",
      bulkDiscount: {
        enabled: bulk?.enabled ?? false,
        vialThreshold: bulk?.vialThreshold ?? 4,
        bundleThreshold: bulk?.bundleThreshold ?? 2,
        percent: bulk?.percent ?? 10,
      },
      tierPricing: { enabled: tier?.enabled ?? false, tiers: tier?.tiers ?? [] },
    },
    subscriptions: {
      // FALSE by default — implicit auto-enroll caused the 8/14 dupe-sub incident (#58).
      autoEnrollBundles: b.subscriptions?.autoEnrollBundles ?? false,
      // Subscribe & Save is opt-in per store (LOO-3154); the discounts map is
      // the interval catalog — empty means no cadence is offered even when
      // enabled, and the PDP should render no selector.
      enabled: b.subscriptions?.enabled ?? false,
      discounts: b.subscriptions?.discounts ?? {},
    },
    billing: {
      dunning: {
        ladder: b.billing?.dunning?.ladder ?? "platform-standard",
        hardDeclineInstantCancel: b.billing?.dunning?.hardDeclineInstantCancel ?? true,
        // Default TRUE: a store with no opinion keeps its shoppers informed
        // when a renewal charge fails (the ARL-safe posture).
        notifyShopper: b.billing?.dunning?.notifyShopper ?? true,
      },
      leadDays: b.billing?.leadDays ?? 0,
      renewalReminderDaysBeforeBilling: b.billing?.renewalReminderDaysBeforeBilling ?? 7,
    },
    catalog: {
      coaDisplay: { enabled: coa?.enabled ?? false, comingSoonCopy: coa?.comingSoonCopy ?? null },
    },
    cart: {
      companionRules: (b.cart?.companionRules ?? []).map((rule) => ({
        triggerCategory: rule.triggerCategory,
        companionProductId: rule.companionProductId,
        autoAdd: rule.autoAdd ?? true,
      })),
    },
    // Default FALSE: upsell surfaces are an explicit per-store opt-in; a
    // store with no opinion renders none of them (LOO-3136).
    upsells: {
      enabled: b.upsells?.enabled ?? false,
      rules: (b.upsells?.rules ?? []).map((rule) => ({
        productId: rule.productId,
        companionProductIds: [...rule.companionProductIds],
      })),
    },
    comms: {
      abandonedCart: {
        enabled: abandon?.enabled ?? false,
        inactivityMinutes: abandon?.inactivityMinutes ?? 60,
        frequencyCapDays: abandon?.frequencyCapDays ?? 7,
        sequenceRef: abandon?.sequenceRef ?? null,
      },
      // Default FALSE: email capture is an explicit per-store opt-in; without
      // it no surface renders and /api/leads answers 404.
      emailCapture: {
        enabled: capture?.enabled ?? false,
        sequenceRef: capture?.sequenceRef ?? null,
        placement: capture?.placement ?? "footer",
      },
    },
    referrals: { enabled: b.referrals?.enabled ?? false },
    analytics: { browserPixelEnabled: b.analytics?.browserPixelEnabled ?? false },
  };
}
