/**
 * /api/leads — the email-capture BFF (LOO-3132). Pins the four postures:
 * manifest-gated 404 (surface ships dark), bot submits answered blandly but
 * NEVER recorded, a real submit forwarded with the store's welcome sequence,
 * and a failed forward surfaced as an honest error — never "you're on the
 * list" over a write that didn't land.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestManifestMock = vi.fn();
const recordMock = vi.fn();

vi.mock("@/lib/request-manifest", () => ({
  getRequestManifest: () => getRequestManifestMock(),
}));
vi.mock("@/lib/leads-store", () => ({
  getLeadsGateway: () => ({ record: recordMock }),
}));

async function importRoute() {
  return import("./route");
}

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://storefront.test/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function resolution(emailCapture: Record<string, unknown> | undefined) {
  return {
    tenantRef: "acme-labs",
    storeId: "store-1",
    status: "live" as const,
    manifest: {
      store: { status: "live" },
      catalog: { storeKey: "acme-labs" },
      behavior: emailCapture === undefined ? {} : { comms: { emailCapture } },
    },
  };
}

const humanBody = { email: "jane@example.com", website: "", started_at: Date.now() - 5000 };

describe("POST /api/leads", () => {
  afterEach(() => vi.clearAllMocks());

  it("404s an unknown host", async () => {
    getRequestManifestMock.mockResolvedValue(null);
    const { POST } = await importRoute();
    expect((await POST(req(humanBody))).status).toBe(404);
  });

  it("404s when the store has not opted into email capture — the surface does not exist", async () => {
    getRequestManifestMock.mockResolvedValue(resolution(undefined));
    const { POST } = await importRoute();
    expect((await POST(req(humanBody))).status).toBe(404);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("400s a malformed email without forwarding", async () => {
    getRequestManifestMock.mockResolvedValue(resolution({ enabled: true }));
    const { POST } = await importRoute();
    expect((await POST(req({ ...humanBody, email: "nope" }))).status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("a honeypot submit is answered 200 but recorded:false and never forwarded", async () => {
    getRequestManifestMock.mockResolvedValue(resolution({ enabled: true }));
    const { POST } = await importRoute();
    const res = await POST(req({ ...humanBody, website: "http://bot.example" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "ok", recorded: false });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("an instant submit (or one with no timestamp) is treated as a bot", async () => {
    getRequestManifestMock.mockResolvedValue(resolution({ enabled: true }));
    const { POST } = await importRoute();
    const res = await POST(req({ email: "jane@example.com", website: "" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: false });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("forwards a real submit with the tenant, anon subject, and the store's welcome sequence", async () => {
    getRequestManifestMock.mockResolvedValue(
      resolution({ enabled: true, sequenceRef: "camp_welcome" }),
    );
    recordMock.mockResolvedValue({ outcome: "recorded" });
    const { POST } = await importRoute();
    const res = await POST(req({ ...humanBody, email: "Jane@Example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "ok", recorded: true });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantRef: "acme-labs",
        email: "jane@example.com",
        campaignRef: "camp_welcome",
        subjectRef: expect.stringMatching(/^anon_/),
      }),
    );
    // A fresh visitor is minted the first-party anon id.
    expect(res.cookies.get("fd_sid")?.value).toMatch(/^anon_/);
  });

  it("a failed forward is an honest 502 — never laundered into success", async () => {
    getRequestManifestMock.mockResolvedValue(resolution({ enabled: true }));
    recordMock.mockResolvedValue({ outcome: "error", message: "boom" });
    const { POST } = await importRoute();
    const res = await POST(req(humanBody));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ outcome: "error" });
  });
});
