import { requireAccountSurface, requireShopper } from "@/lib/account-context";

/** `/account` — the account overview: who's signed in + what they can do. */
export default async function AccountHomePage() {
  const ctx = await requireAccountSurface();
  const session = await requireShopper();

  const cards: Array<{ href: string; title: string; body: string }> = [];
  if (ctx.accounts.orderHistory)
    cards.push({
      href: "/account/orders",
      title: "Order history",
      body: "View your past orders and reorder in one tap.",
    });
  if (ctx.accounts.addressBook)
    cards.push({
      href: "/account/addresses",
      title: "Addresses",
      body: "Manage the shipping addresses saved to your account.",
    });
  cards.push({
    href: "/account/payment",
    title: "Payment",
    body: "Review the cards on file for your account.",
  });
  if (ctx.accounts.subscriptionSelfServe)
    cards.push({
      href: "/account/subscriptions",
      title: "Subscriptions",
      body: "Manage recurring orders.",
    });

  return (
    <div className="grid gap-6">
      <div>
        <h1
          className="text-3xl"
          style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
        >
          Welcome{session.name ? `, ${session.name}` : ""}
        </h1>
        <p className="mt-1 text-sm opacity-70">Signed in as {session.email}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <a
            key={card.href}
            href={card.href}
            className="rounded-[var(--radius-card,12px)] border p-4 hover:shadow-sm"
            style={{ borderColor: "var(--color-border, #e5e5e5)" }}
          >
            <div className="font-medium">{card.title}</div>
            <div className="mt-1 text-sm opacity-70">{card.body}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
