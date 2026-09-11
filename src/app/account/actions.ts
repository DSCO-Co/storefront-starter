"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccountClient } from "@/lib/account-client";
import { requireAccountSurface } from "@/lib/account-context";
import { getShopperSessionStore } from "@/lib/account-session";
import { resolveClientIp } from "@/lib/region";

/**
 * The shopper-auth server actions (LOO-3041) — the storefront analog of the
 * portal's `login/actions.ts`. Every action re-asserts the account surface
 * exists (`requireAccountSurface` — 404s if `accounts.enabled` is off) before
 * doing anything, so a disabled store's actions are as invisible as its
 * pages.
 */

export interface RequestLoginState {
  readonly error: string | null;
  readonly requested: boolean;
  /** Dev-only (fixture / non-prod echo): the magic-link token, so the flow completes without an inbox. */
  readonly devToken?: string;
}

export interface ExchangeState {
  readonly error: string | null;
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto =
    h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}

export async function requestShopperLogin(
  _prev: RequestLoginState,
  formData: FormData,
): Promise<RequestLoginState> {
  const ctx = await requireAccountSurface();
  const email = String(formData.get("email") ?? "").trim();
  if (email.length === 0) {
    return { error: "Enter your email address.", requested: false };
  }

  const origin = await requestOrigin();
  // Forward the shopper's real IP so persons can throttle magic-link requests
  // per client (security #10) — the BFF is the only party that can see it.
  const clientIp = resolveClientIp(await headers());
  const result = await getAccountClient().requestLogin({
    tenantRef: ctx.tenantRef,
    email,
    signInBaseUrl: `${origin}/account/callback`,
    clientIp,
  });
  if (!result.ok) {
    return {
      error: `Could not send a sign-in link right now (${result.error.message}). Try again shortly.`,
      requested: false,
    };
  }
  return {
    error: null,
    requested: true,
    ...(result.value.devToken !== undefined ? { devToken: result.value.devToken } : {}),
  };
}

export async function exchangeShopperToken(
  _prev: ExchangeState,
  formData: FormData,
): Promise<ExchangeState> {
  await requireAccountSurface();
  const token = String(formData.get("token") ?? "").trim();
  if (token.length === 0) return { error: "Missing sign-in token." };

  const clientIp = resolveClientIp(await headers());
  const result = await getAccountClient().exchangeToken(token, clientIp);
  if (!result.ok) {
    return {
      error: `Could not verify that sign-in link right now (${result.error.message}). Try again shortly.`,
    };
  }
  if (result.value === null) {
    return { error: "That sign-in link is invalid or has expired. Request a new one." };
  }

  const store = await getShopperSessionStore();
  store.shopperSessionSecret = result.value.sessionSecret;
  store.tenantRef = result.value.tenantRef;
  store.personId = result.value.personId;
  store.email = result.value.email;
  store.name = result.value.name;
  await store.save();

  redirect("/account");
}

export async function logoutShopper(): Promise<void> {
  const store = await getShopperSessionStore();
  const secret = store.shopperSessionSecret;
  if (secret !== undefined) {
    // Best-effort server-side revoke — never blocks sign-out.
    await getAccountClient().logout(secret);
  }
  store.destroy();
  redirect("/account/login");
}
