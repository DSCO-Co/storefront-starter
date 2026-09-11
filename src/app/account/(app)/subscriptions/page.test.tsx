import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SubscriptionSummary } from "@/lib/account-client";
import { SubscriptionCard } from "./page";

/**
 * C4 (consumer-compliance remediation 2026-09-09): the self-serve action
 * matrix. CANCEL is reachable from EVERY non-canceled state (ARL / FTC
 * Click-to-Cancel); `paused` additionally offers Resume; only `active`
 * offers Pause; `canceled` offers nothing.
 */

function sub(status: SubscriptionSummary["status"]): SubscriptionSummary {
  return {
    id: `sub-${status}`,
    planRef: "plan-bpc-30d",
    status,
    interval: "day",
    intervalCount: 30,
    unitPriceCents: 4050,
    currency: "usd",
    nextBillAt: "2026-10-01T00:00:00.000Z",
    failureCount: 0,
  };
}

describe("SubscriptionCard action matrix (C4)", () => {
  afterEach(cleanup);

  it("active: Pause + Cancel (no Resume)", () => {
    render(<SubscriptionCard sub={sub("active")} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("paused: Resume AND Cancel — cancel stays one click away while paused", () => {
    render(<SubscriptionCard sub={sub("paused")} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("past_due: Cancel remains reachable", () => {
    render(<SubscriptionCard sub={sub("past_due")} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("canceled: no actions", () => {
    render(<SubscriptionCard sub={sub("canceled")} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
