import type { Config } from "tailwindcss";

// The storefront renderer is theme-agnostic: brand colors, fonts and radii
// come ONLY from per-store CSS custom properties injected per request
// (src/lib/tokens.ts, src/lib/theme.ts) from the resolved manifest's DTCG
// token JSON. Tailwind is used for layout/spacing utilities; anything
// brand-flavored goes through `var(--*)`. Do NOT add literal brand colors
// here — that would leak one tenant's look into every tenant.
const config: Config = {
  // BOTH source trees that render through this app: the storefront's own
  // src AND @dscodotco/storefront-sections (every section/component ships its
  // classes from there). Scanning only ./src silently dropped any package
  // utility the storefront didn't coincidentally also use — sections then
  // rendered with missing padding/alignment/grid classes in production.
  content: ["./src/**/*.{ts,tsx}", "../../packages/storefront-sections/src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
