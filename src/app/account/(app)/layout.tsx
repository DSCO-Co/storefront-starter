import type { ReactNode } from "react";
import { requireAccountSurface, requireShopper } from "@/lib/account-context";
import { AccountNav } from "./account-nav";

/**
 * The authenticated account shell. Guards EVERY `/account/*` page under it:
 * `requireAccountSurface()` 404s when the store has accounts disabled;
 * `requireShopper()` redirects to `/account/login` when there is no live
 * session. Login/callback live OUTSIDE this group, so they are reachable
 * without a session. LOO-3041.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAccountSurface();
  const session = await requireShopper();

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-12">
      <a href="/products" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
        ← {ctx.storeName}
      </a>
      <div className="mt-6 grid gap-8 md:grid-cols-[200px_1fr]">
        <AccountNav
          accounts={ctx.accounts}
          wishlistEnabled={ctx.wishlistEnabled}
          email={session.email}
          name={session.name}
        />
        <div>{children}</div>
      </div>
    </main>
  );
}
