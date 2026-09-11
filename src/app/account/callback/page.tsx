import { requireAccountSurface } from "@/lib/account-context";
import { CallbackRunner } from "./callback-runner";

/**
 * `/account/callback?token=…` — the magic-link landing. Burns the token via
 * persons' exchange (server action), sets the httpOnly shopper session
 * cookie, and redirects to `/account`. Gated by `accounts.enabled`.
 */
export default async function AccountCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const ctx = await requireAccountSurface();
  const { token } = await searchParams;

  return (
    <main id="main" className="mx-auto max-w-md px-6 py-12">
      <a href="/products" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
        ← {ctx.storeName}
      </a>
      <h1
        className="mt-6 text-2xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Signing you in…
      </h1>
      <div className="mt-6">
        {token ? (
          <CallbackRunner token={token} />
        ) : (
          <p className="text-sm">
            This page needs a sign-in token.{" "}
            <a
              href="/account/login"
              className="underline"
              style={{ color: "var(--color-primary)" }}
            >
              Request a new link
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
