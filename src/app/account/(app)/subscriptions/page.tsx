import type { SubscriptionSummary } from "@/lib/account-client";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountFlag, requireAccountSurface, requireShopper } from "@/lib/account-context";
import { formatCents } from "@/lib/format";
import {
  cancelSubscriptionAction,
  pauseSubscriptionAction,
  resumeSubscriptionAction,
} from "./actions";

/**
 * `/account/subscriptions` — gated by `accounts.subscriptionSelfServe` (404
 * when off). Now that a real subscriptions engine exists (@dscodotco/subscriptions),
 * this reads the signed-in shopper's subscriptions exactly like orders reads
 * commerce, scoped SERVER-SIDE to the session's personId — never a
 * client-supplied id.
 *
 * HONEST-ABSENCE (root CLAUDE.md): a failed read (`ok: false`) renders "we
 * couldn't load your subscriptions", NEVER "you have none". Only a verified
 * empty list is "no subscriptions yet".
 */
export default async function SubscriptionsPage() {
  const ctx = await requireAccountSurface();
  requireAccountFlag(ctx, "subscriptionSelfServe");
  const session = await requireShopper();

  const result = await getAccountClient().listSubscriptions({
    tenantRef: ctx.tenantRef,
    personId: session.personId,
  });

  return (
    <div className="grid gap-6">
      <h1
        className="text-3xl"
        style={{ fontFamily: "var(--font-display, var(--font-heading))", fontWeight: 600 }}
      >
        Subscriptions
      </h1>

      {!result.ok ? (
        <p
          className="rounded-[var(--radius-card,12px)] border p-4 text-sm"
          style={{ borderColor: "var(--color-error, #ef4343)" }}
        >
          We couldn&apos;t load your subscriptions right now. Please try again in a moment.
        </p>
      ) : result.value.length === 0 ? (
        <p className="text-sm opacity-70">You don&apos;t have any subscriptions yet.</p>
      ) : (
        <ul className="grid gap-3">
          {result.value.map((sub) => (
            <SubscriptionCard key={sub.id} sub={sub} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Exported for the page test. Action rules (C4, consumer-compliance
 * remediation 2026-09-09): CANCEL is reachable from EVERY non-canceled state
 * (ARL/Click-to-Cancel — a paused or past-due subscription still auto-renews
 * later, so its cancel path must stay one click away); `paused` additionally
 * offers Resume; only `active` offers Pause.
 */
export function SubscriptionCard({ sub }: { sub: SubscriptionSummary }) {
  const billing = sub.status === "active" || sub.status === "past_due";
  const cancelable = sub.status !== "canceled";
  return (
    <li
      className="grid gap-3 rounded-[var(--radius-card,12px)] border p-4"
      style={{ borderColor: "var(--color-border, #e5e5e5)" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{sub.planRef}</div>
          <div className="mt-1 text-sm opacity-70">
            {formatCents(sub.unitPriceCents)} · every{" "}
            {sub.intervalCount > 1 ? `${sub.intervalCount} ${sub.interval}s` : sub.interval} ·{" "}
            {humanStatus(sub.status)}
          </div>
          {billing ? (
            <div className="mt-1 text-xs opacity-60">
              Next charge {new Date(sub.nextBillAt).toLocaleDateString()}
            </div>
          ) : null}
        </div>
        <StatusPill status={sub.status} />
      </div>

      {cancelable ? (
        <div className="flex gap-2">
          {sub.status === "active" ? (
            <form action={pauseSubscriptionAction}>
              <input type="hidden" name="subscriptionId" value={sub.id} />
              <button
                type="submit"
                className="rounded-[var(--radius-button,6px)] border px-3 py-1 text-sm"
                style={{ borderColor: "var(--color-border, #e5e5e5)" }}
              >
                Pause
              </button>
            </form>
          ) : null}
          {sub.status === "paused" ? (
            <form action={resumeSubscriptionAction}>
              <input type="hidden" name="subscriptionId" value={sub.id} />
              <button
                type="submit"
                className="rounded-[var(--radius-button,6px)] border px-3 py-1 text-sm"
                style={{ borderColor: "var(--color-border, #e5e5e5)" }}
              >
                Resume
              </button>
            </form>
          ) : null}
          <form action={cancelSubscriptionAction}>
            <input type="hidden" name="subscriptionId" value={sub.id} />
            <button
              type="submit"
              className="rounded-[var(--radius-button,6px)] border px-3 py-1 text-sm"
              style={{
                borderColor: "var(--color-error, #ef4343)",
                color: "var(--color-error, #ef4343)",
              }}
            >
              Cancel
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function StatusPill({ status }: { status: SubscriptionSummary["status"] }) {
  return (
    <span
      className="rounded-[var(--radius-button,6px)] px-1.5 py-0.5 text-xs"
      style={{ backgroundColor: "var(--color-muted, #eee)" }}
    >
      {humanStatus(status)}
    </span>
  );
}

function humanStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
