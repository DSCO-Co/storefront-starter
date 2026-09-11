/**
 * Proves the client Sentry init's no-silent-mocks posture: DSN unset is a
 * clean, visible no-op (returns false, never throws, never sends). Does
 * NOT test the DSN-set path — that would require a live/mocked Sentry
 * transport, which is exactly what @sentry/nextjs's own test suite covers;
 * this surface only owns the gating + scrub composition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("initSentryClient — DSN unset", () => {
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  afterEach(() => {
    if (originalDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
  });

  it("returns false and never throws when the DSN is unset", async () => {
    const { initSentryClient } = await import("./sentry");
    expect(() => initSentryClient()).not.toThrow();
    expect(initSentryClient()).toBe(false);
  });

  it("reportClientError is a silent no-op when the DSN is unset", async () => {
    const { reportClientError } = await import("./sentry");
    expect(() => reportClientError(new Error("boom"), { correlationId: "req_1" })).not.toThrow();
  });
});
