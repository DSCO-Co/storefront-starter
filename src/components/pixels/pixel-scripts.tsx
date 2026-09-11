"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { supportedPixelIds } from "@/lib/pixels";
import { clientConsentAllowsCategory } from "@/lib/track";

/**
 * Browser pixel bootstrap (gap brief docs/briefs/browser-pixel-dispatch-
 * gap-2026-09-06.md, seam step 2). Mounted by the layout ONLY when the store
 * opted in (`behavior.analytics.browserPixelEnabled`, default false — the
 * documented "never a client-side pixel" posture is the unchanged default),
 * `refs.pixels` names at least one supported destination, AND the store is
 * live. A store with no pixels configured therefore ships ZERO extra bytes —
 * this component is never even in the tree.
 *
 * NO THIRD-PARTY SCRIPT BEFORE CONSENT: nothing renders until
 * `clientConsentAllows()` — the EXACT predicate `track()` and the
 * cart-activity client use (`data-consent-required` body stamp × the
 * `fd_consent` grant). On an enforced store the component mounts inert and
 * loads the vendor scripts only after the banner's grant (it re-checks on
 * the `fd:consent-granted` event the banner dispatches). A later fire from
 * `track()` then finds `window.fbq`/`window.gtag` and dual-fires with the
 * shared event id; fires from before the grant never happened on either leg.
 *
 * Supported `refs.pixels` keys: `meta` (Meta pixel id), `ga4` (GA4
 * measurement id). Unknown keys are server-side-CAPI-only and ignored here.
 */
export function PixelScripts({ pixels }: { pixels: Record<string, string> }) {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    // E5 granularity: pixels are the ADVERTISING leg — an analytics-only
    // grant loads no vendor script.
    if (clientConsentAllowsCategory("advertising")) {
      setConsented(true);
      return;
    }
    const onGrant = () => {
      if (clientConsentAllowsCategory("advertising")) setConsented(true);
    };
    window.addEventListener("fd:consent-granted", onGrant);
    return () => window.removeEventListener("fd:consent-granted", onGrant);
  }, []);

  if (!consented) return null;

  const { meta, ga4 } = supportedPixelIds(pixels);
  if (meta === null && ga4 === null) return null;
  // Ids are interpolated into script text — allow only vendor-id-shaped
  // values (defense in depth; the manifest is operator-controlled, not
  // shopper input, but an id is never a place for markup).
  const safeMeta = meta !== null && /^[0-9]{5,20}$/.test(meta) ? meta : null;
  const safeGa4 = ga4 !== null && /^[A-Za-z0-9-]{4,32}$/.test(ga4) ? ga4 : null;

  return (
    <>
      {safeMeta !== null ? (
        <Script id="fd-pixel-meta" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${safeMeta}');
fbq('track', 'PageView');`}
        </Script>
      ) : null}
      {safeGa4 !== null ? (
        <>
          <Script
            id="fd-pixel-ga4-src"
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(safeGa4)}`}
            strategy="afterInteractive"
          />
          <Script id="fd-pixel-ga4" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('js', new Date());
gtag('config', '${safeGa4}');`}
          </Script>
        </>
      ) : null}
    </>
  );
}
