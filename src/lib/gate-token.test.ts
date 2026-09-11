import { describe, expect, it } from "vitest";
import {
  mintGateAdmit,
  mintGateSession,
  sessionNeedsRenewal,
  verifyGateAdmit,
  verifyGateSession,
} from "./gate-token";

const SECRET = "an-adequately-long-signing-secret-0123456789";
const NOW = new Date("2026-09-08T12:00:00.000Z");
const UA = "Mozilla/5.0 (Test) IntegrationBrowser/1.0";

const BASE = {
  tenantRef: "gate-co",
  risk: 12,
  ttlSeconds: 900,
  ceilingHours: 24,
  userAgent: UA,
  bindUserAgent: true,
  now: NOW,
};

describe("gate session tokens", () => {
  it("round-trips and reports freshness", async () => {
    const token = await mintGateSession(SECRET, BASE);
    expect(token).not.toBeNull();
    const state = await verifyGateSession(SECRET, token ?? undefined, UA, NOW);
    expect(state.state).toBe("valid");
    if (state.state !== "valid") return;
    expect(state.claims.t).toBe("gate-co");
    expect(state.claims.risk).toBe(12);
    expect(sessionNeedsRenewal(state)).toBe(false);
  });

  it("refuses to mint or verify without a usable secret — no fallback, ever", async () => {
    expect(await mintGateSession("short", BASE)).toBeNull();
    const token = await mintGateSession(SECRET, BASE);
    const state = await verifyGateSession("short", token ?? undefined, UA, NOW);
    expect(state.state).toBe("invalid");
  });

  it("a tampered payload fails signature verification", async () => {
    const token = (await mintGateSession(SECRET, BASE)) ?? "";
    const [payload, sig] = token.split(".") as [string, string];
    const forged = `${payload.slice(0, -2)}AA.${sig}`;
    expect((await verifyGateSession(SECRET, forged, UA, NOW)).state).toBe("invalid");
  });

  it("UA binding invalidates a stolen cookie on a different browser", async () => {
    const token = await mintGateSession(SECRET, BASE);
    const other = await verifyGateSession(SECRET, token ?? undefined, "curl/8.0", NOW);
    expect(other.state).toBe("invalid");
  });

  it("expiry is reported LAST — an authentic lapsed session is 'expired' with claims, not 'invalid'", async () => {
    const token = await mintGateSession(SECRET, BASE);
    const later = new Date(NOW.getTime() + 1000 * 1000);
    const state = await verifyGateSession(SECRET, token ?? undefined, UA, later);
    expect(state.state).toBe("expired");
    if (state.state !== "expired") return;
    expect(state.claims.sid.length).toBeGreaterThan(0);
    expect(state.expiredForSeconds).toBeGreaterThan(0);
  });

  it("renewal carries ist and the absolute ceiling clamps the window", async () => {
    const first = await mintGateSession(SECRET, BASE);
    const firstState = await verifyGateSession(SECRET, first ?? undefined, UA, NOW);
    if (firstState.state !== "valid") throw new Error("setup");
    // Renew 23h50m later: only 10 minutes of ceiling remain.
    const nearCeiling = new Date(NOW.getTime() + (24 * 60 - 10) * 60_000);
    const renewed = await mintGateSession(SECRET, {
      ...BASE,
      now: nearCeiling,
      ist: firstState.claims.ist,
      sid: firstState.claims.sid,
    });
    const renewedState = await verifyGateSession(SECRET, renewed ?? undefined, UA, nearCeiling);
    expect(renewedState.state).toBe("valid");
    if (renewedState.state !== "valid") return;
    expect(renewedState.claims.exp - Math.floor(nearCeiling.getTime() / 1000)).toBeLessThanOrEqual(
      10 * 60,
    );
    // Past the ceiling entirely: expired regardless of exp arithmetic.
    const past = new Date(NOW.getTime() + 25 * 60 * 60_000);
    expect((await verifyGateSession(SECRET, renewed ?? undefined, UA, past)).state).toBe("expired");
  });

  it("flags renewal past half-life", async () => {
    const token = await mintGateSession(SECRET, BASE);
    const late = new Date(NOW.getTime() + 8 * 60_000); // 8 of 15 minutes elapsed
    const state = await verifyGateSession(SECRET, token ?? undefined, UA, late);
    expect(state.state).toBe("valid");
    expect(sessionNeedsRenewal(state)).toBe(true);
  });
});

describe("gate admit tokens", () => {
  it("round-trips, is tenant-bound, and expires", async () => {
    const token = await mintGateAdmit(SECRET, { tenantRef: "gate-co", admitDays: 30, now: NOW });
    expect(await verifyGateAdmit(SECRET, token ?? undefined, "gate-co", NOW)).toBe(true);
    expect(await verifyGateAdmit(SECRET, token ?? undefined, "other-co", NOW)).toBe(false);
    const later = new Date(NOW.getTime() + 31 * 86400 * 1000);
    expect(await verifyGateAdmit(SECRET, token ?? undefined, "gate-co", later)).toBe(false);
  });
});
