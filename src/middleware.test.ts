/**
 * Middleware routing decisions. The interesting invariant is the matcher/map
 * sync: Next statically analyzes `config.matcher`, so the legal-alias paths
 * are enumerated by hand there — this test fails the moment
 * `POLICY_PATH_ALIASES` gains (or loses) a path the matcher doesn't mirror,
 * which is exactly how an alias would silently stop resolving.
 */

import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POLICY_PATH_ALIASES } from "@/lib/policy-aliases";

const resolveManifestMock = vi.fn();
vi.mock("@/lib/manifest-source", () => ({
  resolveManifest: (host: string) => resolveManifestMock(host),
}));

async function importMiddleware() {
  return import("./middleware");
}

function req(
  path: string,
  cookies?: Record<string, string>,
  extraHeaders?: Record<string, string>,
): NextRequest {
  const url = new URL(`https://acme.example${path}`);
  const cookieHeader = Object.entries(cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return {
    nextUrl: {
      pathname: url.pathname,
      searchParams: url.searchParams,
      protocol: url.protocol,
      clone: () => new URL(url.toString()),
    },
    headers: new Headers({
      host: "acme.example",
      ...(cookieHeader.length > 0 ? { cookie: cookieHeader } : {}),
      ...(extraHeaders ?? {}),
    }),
  } as unknown as NextRequest;
}

/** A live store with referrals on; consent gating configurable per test. */
function referralManifest(overrides?: {
  referralsEnabled?: boolean;
  consentEnabled?: boolean;
  status?: string;
}) {
  return {
    manifest: {
      store: { status: overrides?.status ?? "live" },
      catalog: {},
      behavior: {
        referrals: { enabled: overrides?.referralsEnabled ?? true },
        compliance: {
          cookieConsent: { enabled: overrides?.consentEnabled ?? false, regions: "all" },
        },
      },
    },
  };
}

function refCookie(res: { headers: Headers }): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (setCookie === null) return null;
  const match = setCookie.match(/(?:^|, )fd_ref=([^;]*)/);
  return match?.[1] ?? null;
}

describe("middleware", () => {
  afterEach(() => vi.clearAllMocks());

  it("matcher enumerates every POLICY_PATH_ALIASES path (plus the product matcher)", async () => {
    const { config } = await importMiddleware();
    const aliasPaths = Object.keys(POLICY_PATH_ALIASES);
    for (const path of aliasPaths) {
      expect(config.matcher).toContain(path);
    }
    // Beyond the product-slug matcher, the referral `?ref=` capture entry, the
    // `?__preview=` handshake entry, and (P8) the broad page matcher that
    // stamps x-fd-pathname for the funnel-gate layout decision.
    expect(config.matcher).toHaveLength(aliasPaths.length + 4);
    expect(config.matcher).toContain("/products/:slug");
    // The P8 pathname-stamp entry: a broad page matcher (assets/api excluded).
    expect(config.matcher).toContain("/((?!api/|_next/|favicon.ico|.*\\.).*)");
    // The referral and preview entries MUST be query-conditioned — without
    // `has`, every page request would pay for this middleware.
    const conditioned = config.matcher.filter((m) => typeof m === "object");
    expect(conditioned).toHaveLength(2);
    expect(conditioned[0]).toMatchObject({ has: [{ type: "query", key: "ref" }] });
    expect(conditioned[1]).toMatchObject({ has: [{ type: "query", key: "__preview" }] });
  });

  it("rewrites a conventional legal path onto /policies/{slug} without a manifest read", async () => {
    const { middleware } = await importMiddleware();
    const res = await middleware(req("/terms"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/policies/terms");
    expect(resolveManifestMock).not.toHaveBeenCalled();
  });

  it("301s a product alias to the current slug", async () => {
    resolveManifestMock.mockResolvedValue({
      manifest: { catalog: { slugAliases: { "old-name": "new-name" } } },
    });
    const { middleware } = await importMiddleware();
    const res = await middleware(req("/products/old-name"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toContain("/products/new-name");
  });

  it("passes a non-alias product slug straight through", async () => {
    resolveManifestMock.mockResolvedValue({ manifest: { catalog: {} } });
    const { middleware } = await importMiddleware();
    const res = await middleware(req("/products/real-product"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.status).toBe(200);
  });

  describe("referral capture (?ref=)", () => {
    it("stashes a valid code in the httpOnly fd_ref cookie when referrals are enabled and consent is open", async () => {
      resolveManifestMock.mockResolvedValue(referralManifest());
      const { middleware } = await importMiddleware();
      const res = await middleware(req("/?ref=lori-h"));
      expect(refCookie(res)).toBe("lori-h");
      expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    });

    it("captures NOTHING when the store's referrals gate is off (the knob is wired)", async () => {
      resolveManifestMock.mockResolvedValue(referralManifest({ referralsEnabled: false }));
      const { middleware } = await importMiddleware();
      const res = await middleware(req("/?ref=lori-h"));
      expect(refCookie(res)).toBeNull();
    });

    it("captures NOTHING on a consent-enforced store without an explicit grant (same predicate as tracking)", async () => {
      resolveManifestMock.mockResolvedValue(referralManifest({ consentEnabled: true }));
      const { middleware } = await importMiddleware();
      const res = await middleware(req("/?ref=lori-h"));
      expect(refCookie(res)).toBeNull();
    });

    it("captures once consent IS granted on an enforced store", async () => {
      resolveManifestMock.mockResolvedValue(referralManifest({ consentEnabled: true }));
      const { middleware } = await importMiddleware();
      const res = await middleware(
        req("/?ref=lori-h", { fd_consent: encodeURIComponent("granted|banner|2026-09-06") }),
      );
      expect(refCookie(res)).toBe("lori-h");
    });

    it("captures NOTHING when the browser sends Sec-GPC: 1 — even with a granted cookie (F1)", async () => {
      resolveManifestMock.mockResolvedValue(referralManifest({ consentEnabled: true }));
      const { middleware } = await importMiddleware();
      const res = await middleware(
        req(
          "/?ref=lori-h",
          { fd_consent: encodeURIComponent("granted|banner|2026-09-06") },
          { "sec-gpc": "1" },
        ),
      );
      expect(refCookie(res)).toBeNull();
    });

    it("silently drops a malformed code (never an error, page renders normally)", async () => {
      resolveManifestMock.mockResolvedValue(referralManifest());
      const { middleware } = await importMiddleware();
      const res = await middleware(req(`/?ref=${encodeURIComponent("<script>alert(1)")}`));
      expect(refCookie(res)).toBeNull();
      expect(res.status).toBe(200);
    });

    it("captures NOTHING on a non-live store", async () => {
      resolveManifestMock.mockResolvedValue(referralManifest({ status: "draft" }));
      const { middleware } = await importMiddleware();
      const res = await middleware(req("/?ref=lori-h"));
      expect(refCookie(res)).toBeNull();
    });

    it("rides the cookie on a product-alias 301 so the code survives the redirect", async () => {
      resolveManifestMock.mockResolvedValue({
        manifest: {
          ...referralManifest().manifest,
          catalog: { slugAliases: { "old-name": "new-name" } },
        },
      });
      const { middleware } = await importMiddleware();
      const res = await middleware(req("/products/old-name?ref=lori-h"));
      expect(res.status).toBe(301);
      expect(refCookie(res)).toBe("lori-h");
    });
  });
});
