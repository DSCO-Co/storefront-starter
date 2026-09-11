"use client";

import { logoutShopper } from "@/app/account/actions";

/** Sign-out — posts to the `logoutShopper` server action, which revokes the session and clears the cookie. */
export function LogoutButton() {
  return (
    <form action={logoutShopper}>
      <button type="submit" className="text-sm underline opacity-70 hover:opacity-100">
        Sign out
      </button>
    </form>
  );
}
