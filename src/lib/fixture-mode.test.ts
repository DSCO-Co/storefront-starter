import { describe, expect, it } from "vitest";
import { resolveFixtureModeGate } from "@/lib/fixture-mode";

describe("resolveFixtureModeGate", () => {
  it("allows fixture mode outside production (dev)", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: "development",
      allowFixtureMode: undefined,
      vercelEnv: undefined,
    });
    expect(gate.allowed).toBe(true);
  });

  it("allows fixture mode outside production (test)", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: "test",
      allowFixtureMode: undefined,
      vercelEnv: undefined,
    });
    expect(gate.allowed).toBe(true);
  });

  it("allows fixture mode with NODE_ENV unset entirely", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: undefined,
      allowFixtureMode: undefined,
      vercelEnv: undefined,
    });
    expect(gate.allowed).toBe(true);
  });

  it("refuses fixture mode in production with no opt-in — the hazard this closes", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: "production",
      allowFixtureMode: undefined,
      vercelEnv: undefined,
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.reason).toMatch(/FLIGHTDECK_API_URL/);
      expect(gate.reason).toMatch(/production/);
    }
  });

  it("allows production fixture mode when ALLOW_FIXTURE_MODE=1 is set explicitly", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: "production",
      allowFixtureMode: "1",
      vercelEnv: undefined,
    });
    expect(gate.allowed).toBe(true);
  });

  it("allows production fixture mode when ALLOW_FIXTURE_MODE=true (case-insensitive)", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: "production",
      allowFixtureMode: "TRUE",
      vercelEnv: undefined,
    });
    expect(gate.allowed).toBe(true);
  });

  it("does NOT treat an arbitrary truthy-looking string as an opt-in", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: "production",
      allowFixtureMode: "please",
      vercelEnv: undefined,
    });
    expect(gate.allowed).toBe(false);
  });

  it("allows a Vercel preview build (NODE_ENV=production but VERCEL_ENV=preview)", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: "production",
      allowFixtureMode: undefined,
      vercelEnv: "preview",
    });
    expect(gate.allowed).toBe(true);
  });

  it("does NOT allow a real Vercel production deploy (VERCEL_ENV=production)", () => {
    const gate = resolveFixtureModeGate({
      nodeEnv: "production",
      allowFixtureMode: undefined,
      vercelEnv: "production",
    });
    expect(gate.allowed).toBe(false);
  });
});
