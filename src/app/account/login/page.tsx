import { redirect } from "next/navigation";
import { requireAccountSurface } from "@/lib/account-context";
import { getShopperSession } from "@/lib/account-session";
import { LoginForm } from "./login-form";

/**
 * `/account/login` — the shopper sign-in entry point. Gated by
 * `accounts.enabled` (404 when the store has accounts turned off). An
 * already-signed-in shopper is sent straight to their account.
 */
export default async function AccountLoginPage() {
  const ctx = await requireAccountSurface();
  const session = await getShopperSession();
  if (session !== null) redirect("/account");

  return (
    <main id="main" className="mx-auto max-w-md px-6 py-12">
      <a href="/products" className="text-sm underline" style={{ color: "var(--color-primary)" }}>
        ← {ctx.storeName}
      </a>
      <h1
        className="mt-6 text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Sign in
      </h1>
      <p className="mt-2 text-sm opacity-70">
        Enter your email and we&apos;ll send you a secure sign-in link. No password needed.
      </p>
      <div className="mt-8">
        <LoginForm />
      </div>
    </main>
  );
}
