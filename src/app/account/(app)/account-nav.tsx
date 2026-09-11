import type { ResolvedBehavior } from "@/lib/manifest";
import { LogoutButton } from "./logout-button";

/**
 * Account side-nav. Only links to surfaces the manifest's account sub-flags
 * enable — the links are gated the SAME way the routes are (a disabled
 * surface 404s AND has no link), so the nav never points at a route that
 * would answer as if it does not exist.
 */
export function AccountNav({
  accounts,
  wishlistEnabled,
  email,
  name,
}: {
  accounts: ResolvedBehavior["accounts"];
  wishlistEnabled: boolean;
  email: string;
  name: string | null;
}) {
  const links: Array<{ href: string; label: string }> = [{ href: "/account", label: "Overview" }];
  if (accounts.orderHistory) links.push({ href: "/account/orders", label: "Orders" });
  // Returns ride the order-history gate (a return is an action on an order):
  // gated the SAME way the route is, so the nav never points at a surface
  // that answers as if it does not exist.
  if (accounts.orderHistory) links.push({ href: "/account/returns", label: "Returns" });
  if (accounts.addressBook) links.push({ href: "/account/addresses", label: "Addresses" });
  // Gated the SAME way the route is (404 + no link when off) so the nav never
  // points at a wishlist route that would answer as if it does not exist.
  if (wishlistEnabled) links.push({ href: "/account/wishlist", label: "Wishlist" });
  links.push({ href: "/account/payment", label: "Payment" });
  if (accounts.subscriptionSelfServe)
    links.push({ href: "/account/subscriptions", label: "Subscriptions" });

  return (
    <nav className="grid content-start gap-1 text-sm">
      <div className="mb-2">
        <div className="font-medium">{name ?? "Your account"}</div>
        <div className="opacity-60">{email}</div>
      </div>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="rounded-[var(--radius-button,6px)] px-2 py-1 hover:underline"
          style={{ color: "var(--color-primary)" }}
        >
          {link.label}
        </a>
      ))}
      <div className="mt-4">
        <LogoutButton />
      </div>
    </nav>
  );
}
