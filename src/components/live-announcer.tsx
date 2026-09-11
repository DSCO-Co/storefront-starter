"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Polite screen-reader announcements (consumer-compliance remediation
 * 2026-09-09, D6 / WCAG 4.1.3 status messages). One `aria-live="polite"`
 * region mounted ONCE by the root layout; any client component announces by
 * calling `announce()` — a window CustomEvent, so callers need no context
 * threading and an announce with no listener (tests, SSR) is a harmless
 * no-op.
 *
 * Announced today: add-to-cart, cart-count changes, coupon verdicts, and
 * checkout errors — dynamic outcomes a sighted shopper sees but a screen
 * reader would otherwise miss.
 */

export const ANNOUNCE_EVENT = "fd:announce";

/** Fire-and-forget: never throws into a caller's render/handler. */
export function announce(message: string): void {
  try {
    if (typeof window === "undefined" || message.length === 0) return;
    window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: { message } }));
  } catch {
    // An announcement is an enhancement — its failure must stay invisible.
  }
}

export function LiveAnnouncer() {
  const [message, setMessage] = useState("");
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: unknown }>).detail;
      if (typeof detail?.message !== "string" || detail.message.length === 0) return;
      // Clear-then-set so an identical repeat (second "Added to cart") still
      // re-announces; the timeout empties the region so stale text is never
      // re-read on focus.
      setMessage("");
      const text = detail.message;
      window.requestAnimationFrame(() => setMessage(text));
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setMessage(""), 7000);
    };
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => {
      window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    };
  }, []);

  return (
    <div aria-live="polite" role="status" className="sr-only" data-testid="live-announcer">
      {message}
    </div>
  );
}
