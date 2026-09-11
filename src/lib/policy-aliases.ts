/**
 * Standard legal-slug aliases (LOO-3050 item 1): `/terms`, `/privacy`, … are
 * rewritten by the proxy onto the manifest-driven `/policies/{slug}` route so
 * the conventional URLs never 404 on a store carrying the default legal pack.
 *
 * The right-hand side is a policy-page slug. `shipping`/`returns` map to
 * themselves (Store #0's split-page convention) and the provisioning pack's
 * combined `shipping-returns` also gets its conventional aliases.
 */
export const POLICY_PATH_ALIASES: Readonly<Record<string, string>> = {
  "/terms": "terms",
  "/terms-of-service": "terms",
  "/privacy": "privacy",
  "/privacy-policy": "privacy",
  "/shipping": "shipping",
  "/returns": "returns",
  "/shipping-returns": "shipping-returns",
  "/ruo-terms": "ruo-terms",
};

/** `/terms` → `/policies/terms`; non-alias paths pass through unchanged. */
export function resolvePolicyAlias(pathname: string): string {
  const slug = POLICY_PATH_ALIASES[pathname];
  return slug ? `/policies/${slug}` : pathname;
}
