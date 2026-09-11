import { NextResponse } from "next/server";
import { RUO_OK_COOKIE, RUO_OK_MAX_AGE_SECONDS, RUO_OK_VALUE } from "@/lib/compliance-cookies";
import { getRequestManifest } from "@/lib/request-manifest";

/**
 * RUO-acknowledgment affirmation BFF. The checkout form POSTs
 * `{ confirmed: true }` here when the shopper checks the research-use-only box;
 * this route sets the httpOnly `fd_ruo_ok` cookie SERVER-SIDE. That is what
 * makes the acknowledgment un-forgeable: client JS never sets this cookie, so a
 * scripted POST straight to `/api/checkout` cannot skip the affirmation — the
 * checkout route re-checks this cookie and refuses without it. This mirrors the
 * `/api/age-gate` mechanism exactly.
 *
 * Unlike the age gate, the RUO acknowledgment is NOT a per-store toggle — it is
 * a non-removable compliance surface (the sibling of the hardcoded
 * `RUO_DISCLAIMER`), so there is no "store without an RUO gate" to fail closed
 * against. The only gate is a resolvable tenant + an explicit confirmation.
 */
export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "error", message: "unknown store" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { confirmed?: unknown } | null;
  if (body?.confirmed !== true) {
    return NextResponse.json(
      { outcome: "error", message: "confirmed:true required to affirm the RUO acknowledgment" },
      { status: 400 },
    );
  }

  const res = NextResponse.json({ outcome: "ok" });
  res.cookies.set(RUO_OK_COOKIE, RUO_OK_VALUE, {
    path: "/",
    maxAge: RUO_OK_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  });
  return res;
}
