import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `next build` rewrites tsconfig.json's `jsx` to "preserve" (its own SWC
  // transform handles JSX at build time) — harmless for Next, but esbuild's
  // tsconfig-inferred JSX transform then leaves JSX untouched and tests blow
  // up with "React is not defined". Pin the automatic runtime here so
  // `pnpm test` doesn't depend on whichever value `next build` last wrote.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      // Published @dscodotco packages: resolve to their shipped dist builds —
      // their "development" export condition points at src/, which the npm
      // tarballs do not include.
      {
        find: /^\@dscodotco\/storefront-sections$/,
        replacement: resolve(__dirname, "node_modules/@dscodotco/storefront-sections/dist/index.js"),
      },
      {
        find: /^\@dscodotco\/storefront-sections\/(.*)$/,
        replacement: resolve(__dirname, "node_modules/@dscodotco/storefront-sections/dist/$1.js"),
      },
      {
        find: /^\@dscodotco\/theme-presets$/,
        replacement: resolve(__dirname, "node_modules/@dscodotco/theme-presets/dist/index.js"),
      },
      {
        find: /^\@dscodotco\/theme-presets\/(.*)$/,
        replacement: resolve(__dirname, "node_modules/@dscodotco/theme-presets/dist/$1.js"),
      },
      // Next vendors `server-only` — stub it so server modules stay unit-testable
      // (same pattern as apps/loop-health-v2).
      { find: /^server-only$/, replacement: resolve(__dirname, "vitest.server-only-stub.ts") },
      // `next/cache` (unstable_cache) has no test runtime — pass-through stub.
      { find: /^next\/cache$/, replacement: resolve(__dirname, "vitest.next-cache-stub.ts") },
      // Mirror tsconfig `@/*` → `./src/*`.
      { find: /^@\/(.*)$/, replacement: resolve(__dirname, "src/$1") },
      // Mirror tsconfig.json's `@dscodotco-shared/*` direct-file aliases (see
      // its comment) — vitest/vite does not read tsconfig `paths` on its
      // own, only what's aliased here.
      {
        find: /^@dscodotco-shared\/phi-redaction$/,
        replacement: resolve(__dirname, "./vendor/phi-redaction.ts"),
      },
      {
        find: /^@dscodotco-shared\/secret-redaction$/,
        replacement: resolve(__dirname, "./vendor/secret-redaction.ts"),
      },
      // Mirror tsconfig.json's order-total resolver aliases (see its comment):
      // the PURE shipping/tax/total math + core's PURE Result module it needs.
      {
        find: /^@dscodotco-shared\/order-totals$/,
        replacement: resolve(__dirname, "./vendor/order-totals.ts"),
      },
      {
        find: /^@dscodotco\/core$/,
        replacement: resolve(__dirname, "./vendor/result.ts"),
      },
    ],
  },
  test: {
    server: { deps: { inline: [/@dscodotco[\\/]/] } },
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
