"use client";

import { useEffect, useRef } from "react";
import { type TrackEvent, track } from "@/lib/track";

/**
 * Fires a single funnel `track()` event once, on mount — the client seam that
 * lets a SERVER component (a product page, the search results page) emit a
 * funnel event without becoming a client component itself. Used for
 * VIEW_CONTENT (per PDP render) and SEARCH (per results view): each fresh
 * navigation remounts it, so the event fires exactly once per view.
 *
 * `track()` is consent-gated and error-swallowing, so this renders nothing and
 * can never affect the page. The event is snapshotted in a ref so a re-render
 * of the parent never re-fires it.
 */
export function TrackOnMount({ event }: { event: TrackEvent }) {
  const eventRef = useRef(event);
  useEffect(() => {
    track(eventRef.current);
  }, []);
  return null;
}
