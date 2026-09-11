// Re-export shim — the implementation moved to `@dscodotco/storefront-sections`
// (single source of truth). Imported here so the storefront's existing
// `@/lib/copy-tokens` call sites resolve unchanged; the subpath import avoids pulling
// the package barrel (and every section component) into client bundles.
export * from "@dscodotco/storefront-sections/lib/copy-tokens";
