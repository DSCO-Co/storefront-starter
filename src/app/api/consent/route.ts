import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ANON_ID_COOKIE, ANON_ID_MAX_AGE_SECONDS, readCookie } from "@/lib/compliance-cookies";
import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  type ConsentSignal,
  consentCategories,
  serializeConsent,
} from "@/lib/consent";
import { getConsentGateway } from "@/lib/consent-store";
import { createLogger } from "@/lib/logger";
import { resolveBehavior } from "@/lib/manifest";
import { resolveRequestGeo } from "@/lib/region";
import { getRequestManifest } from "@/lib/request-manifest";

const logger = createLogger("api-consent");

/**
 * Cookie-consent decision BFF (LOO-3050). The banner POSTs the shopper's
 * decision here; this route:
 *  1. resolves the tenant from Host (fail-closed, same as every other route);
 *  2. persists an APPEND-ONLY consent row via the persons module — when the
 *     store sets `acknowledgmentGate.persistConsentRow`, OR on any explicit
 *     grant (a granted decision is always worth a durable record);
 *  3. sets the first-party `fd_consent` cookie the checkout/beacon gate and
 *     the banner both read.
 *
 * The persisted row is the compliance artifact; the cookie is the runtime
 * signal. A persistence FAILURE does not silently succeed — the cookie is
 * still set (the shopper's runtime choice is honored) but the response
 * reports `persisted:false` so the caller/logs can see the row didn't land.
 */
export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "error", message: "unknown store" }, { status: 404 });
  }
  const behavior = resolveBehavior(resolution.manifest);
  const ackGate = behavior.compliance.acknowledgmentGate;

  const body = (await request.json().catch(() => null)) as {
    decision?: unknown;
    categories?: unknown;
    source?: unknown;
  } | null;
  const decision = body?.decision;
  if (decision !== "granted" && decision !== "denied") {
    return NextResponse.json(
      { outcome: "error", message: "decision must be 'granted' or 'denied'" },
      { status: 400 },
    );
  }

  // E5 granularity: an optional per-category choice set. Absent (legacy
  // caller) ⇒ both categories follow the all-or-nothing decision. A
  // malformed value is a 400, never silently coerced into a grant.
  let categories: { analytics: boolean; advertising: boolean };
  if (body?.categories === undefined) {
    categories = { analytics: decision === "granted", advertising: decision === "granted" };
  } else if (
    body.categories !== null &&
    typeof body.categories === "object" &&
    typeof (body.categories as Record<string, unknown>).analytics === "boolean" &&
    typeof (body.categories as Record<string, unknown>).advertising === "boolean"
  ) {
    const c = body.categories as { analytics: boolean; advertising: boolean };
    categories = { analytics: c.analytics, advertising: c.advertising };
  } else {
    return NextResponse.json(
      { outcome: "error", message: "categories must carry boolean analytics and advertising" },
      { status: 400 },
    );
  }
  const anyGranted = categories.analytics || categories.advertising;

  // The recording surface (E3): the banner by default; the privacy-choices
  // page's opt-out/withdrawal controls name themselves. Enumerated — never a
  // caller-supplied free string in a compliance record.
  const source = body?.source === "privacy-choices" ? "privacy-choices" : "storefront-banner";

  const capturedAt = new Date().toISOString();
  const signal: ConsentSignal = {
    // `adTracking` stays the ADVERTISING verdict (beacon's ad-tracking key);
    // the categories field carries the granular split.
    adTracking: categories.advertising ? "granted" : "denied",
    source,
    capturedAt,
    categories,
  };

  // Stable first-party anon subject id — mint one if the visitor has none.
  const existingAnon = readCookie(request.headers, ANON_ID_COOKIE);
  const anonId = existingAnon ?? `anon_${randomUUID()}`;

  const geo = resolveRequestGeo(request.headers);

  // Persist when the store asks for a durable row, whenever any category is
  // granted (an affirmative grant is always worth recording), and ALWAYS for
  // a privacy-choices withdrawal/opt-out (E3 — the exercised right IS the
  // compliance artifact).
  let persisted = false;
  if (ackGate.persistConsentRow || anyGranted || source === "privacy-choices") {
    const recorded = await getConsentGateway().record({
      tenantRef: resolution.tenantRef,
      subject: { type: "anon", ref: anonId },
      categories: consentCategories(signal),
      region: geo.country ?? "unknown",
      disclosureRef: ackGate.disclosureRef,
      source,
      capturedAt,
    });
    if (recorded.outcome === "recorded") {
      persisted = true;
    } else {
      // A failed write is not laundered into success — log it and report it.
      logger.error("consent row not persisted", {
        tenantRef: resolution.tenantRef,
        message: recorded.message,
      });
    }
  }

  // Report the EFFECTIVE decision (any category granted) — a categories set
  // that grants nothing is a denial whatever the caller's `decision` said.
  const res = NextResponse.json({
    outcome: "ok",
    decision: anyGranted ? "granted" : "denied",
    categories,
    persisted,
  });
  const secure = new URL(request.url).protocol === "https:";
  res.cookies.set(CONSENT_COOKIE, serializeConsent(signal), {
    path: "/",
    maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure,
  });
  if (!existingAnon) {
    res.cookies.set(ANON_ID_COOKIE, anonId, {
      path: "/",
      maxAge: ANON_ID_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure,
    });
  }
  return res;
}
