import type { NextConfig } from "next";

// Deploy substrate is deliberately open (ADR 0003 D16 — Vercel vs
// CloudFront+OpenNext decided on measured economics at store 10-20; Gate 0
// blocks the AWS infra work anyway). This config stays plain until that
// decision lands.
/**
 * Security headers on every response (security-audit-2026-09-01 #4). The
 * storefront renders untrusted-ish per-tenant catalog content and authenticated
 * `/account/*` + checkout pages with NO headers before this — open to
 * clickjacking and MIME-sniffing.
 *
 * The CSP here carries the directives that harden without a nonce pipeline:
 * `frame-ancestors 'none'` (clickjacking, superset of X-Frame-Options),
 * `object-src 'none'` (plugins), `base-uri 'self'` (base-tag injection),
 * `form-action 'self'` (form hijacking), `upgrade-insecure-requests`. A
 * nonce-based `script-src`/`style-src` lock-down (the second line against script
 * injection) is a tracked follow-up — it needs per-request nonces threaded
 * through the App Router, and the stored-XSS sink it would backstop is already
 * fixed at source (audit #2). Omitting script/style directives here is honest:
 * no false claim of script protection we don't yet enforce.
 */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The section presentation layer ships TS/JSX source (`@dscodotco/storefront-sections`,
  // consumed identically by the console's Puck editor) — Next must transpile it
  // from node_modules rather than expecting pre-built JS.
  transpilePackages: ["@dscodotco/storefront-sections"],
  // Standalone starter: the app root IS the repo root, so Next's default
  // file-tracing root is correct — no monorepo tracing-root pin needed.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  images: {
    // No image-optimization server assumed yet (substrate-agnostic) — the
    // custom loader resolves asset URLs straight to their CDN/origin path.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
  },
};

export default nextConfig;
