import { NextResponse } from "next/server";
import { AGE_OK_COOKIE, AGE_OK_MAX_AGE_SECONDS, AGE_OK_VALUE } from "@/lib/compliance-cookies";
import { resolveBehavior } from "@/lib/manifest";
import { getRequestManifest } from "@/lib/request-manifest";

/**
 * Age-gate affirmation BFF (LOO-3050 item 3). The client gate POSTs
 * `{ confirmed: true }` here on affirmation; this route sets the httpOnly
 * `fd_age_ok` cookie SERVER-SIDE. That is what makes the gate reload-proof:
 * client JS never sets this cookie, so clearing storage or reloading cannot
 * forge a pass — only this server route, after confirming the store
 * actually has an age gate enabled, sets it.
 *
 * Fail-closed: if the store has no age gate, there is nothing to pass, so a
 * POST is a 400 (never quietly mint a pass cookie for a store that didn't
 * ask for one).
 */
export async function POST(request: Request) {
  const resolution = await getRequestManifest();
  if (!resolution) {
    return NextResponse.json({ outcome: "error", message: "unknown store" }, { status: 404 });
  }
  const ageGate = resolveBehavior(resolution.manifest).compliance.ageGate;
  if (!ageGate.enabled) {
    return NextResponse.json(
      { outcome: "error", message: "this store has no age gate" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as { confirmed?: unknown } | null;
  if (body?.confirmed !== true) {
    return NextResponse.json(
      { outcome: "error", message: "confirmed:true required to pass the age gate" },
      { status: 400 },
    );
  }

  const res = NextResponse.json({ outcome: "ok", minAge: ageGate.minAge });
  res.cookies.set(AGE_OK_COOKIE, AGE_OK_VALUE, {
    path: "/",
    maxAge: AGE_OK_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  });
  return res;
}
