"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { clientConsentAllows } from "@/lib/track";

/**
 * Customer-support (CX) chat widget — the storefront's connection to the
 * open-source CX platform (Chatwoot-compatible). Env-gated and inert until
 * configured, exactly like the analytics/beacon surfaces:
 *   NEXT_PUBLIC_SUPPORT_BASE_URL   — the CX instance origin (e.g. https://support.ruo.pro)
 *   NEXT_PUBLIC_SUPPORT_WEBSITE_TOKEN — the website-inbox token from the CX admin
 *
 * Unset → renders nothing, so a store without support configured is unaffected.
 *
 * CONSENT-GATED (consumer-compliance remediation 2026-09-09, F8/D2): this is
 * a third-party script, so it mounts behind the SAME non-essential consent
 * predicate as the pixels — `clientConsentAllows()`, which honors the
 * layout's `data-consent-required` stamp, the `fd_consent` grant, AND the
 * Global Privacy Control signal. On an enforced store the component mounts
 * inert and injects the SDK only after the banner's grant (it re-checks on
 * the `fd:consent-granted` event, exactly like PixelScripts). No SDK bytes
 * ever load before consent.
 *
 * The Chatwoot SDK contract (`window.chatwootSettings` + `chatwootSDK.run`) is
 * the de-facto open standard here; the same env swaps to any script-embed CX
 * tool. No PII is passed automatically — an authenticated surface can call
 * `window.$chatwoot?.setUser(...)` separately once shopper auth lands.
 */
export function SupportWidget() {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    if (clientConsentAllows()) {
      setConsented(true);
      return;
    }
    const onGrant = () => {
      if (clientConsentAllows()) setConsented(true);
    };
    window.addEventListener("fd:consent-granted", onGrant);
    return () => window.removeEventListener("fd:consent-granted", onGrant);
  }, []);

  const baseUrl = process.env.NEXT_PUBLIC_SUPPORT_BASE_URL;
  const token = process.env.NEXT_PUBLIC_SUPPORT_WEBSITE_TOKEN;
  if (!baseUrl || !token || !consented) return null;

  return (
    <Script
      id="cx-support-widget"
      strategy="afterInteractive"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static loader; values come from build-time env, never user input
      dangerouslySetInnerHTML={{
        __html: `
          (function(d,t){
            window.chatwootSettings = { position: "right", type: "expanded_bubble", launcherTitle: "Support" };
            var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
            g.src=${JSON.stringify(baseUrl)}+"/packs/js/sdk.js"; g.async=true; g.defer=true;
            s.parentNode.insertBefore(g,s);
            g.onload=function(){ window.chatwootSDK.run({ websiteToken: ${JSON.stringify(token)}, baseUrl: ${JSON.stringify(baseUrl)} }); };
          })(document,"script");
        `,
      }}
    />
  );
}
