"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-requests the page once, from the browser, when it rendered with no token.
 *
 * Why this exists (found in the 360px browser pass): the hand-off cookie is
 * `Path=/invite` (R6), so the browser does not send it to `/signin` or `/totp`.
 * Those two Server Actions finish with `redirect("/invite")`, and Next renders
 * that redirect target INSIDE the action's own request, whose cookies lack
 * `invite_token`. The client then paints that payload: a signed-in invitee
 * would land on "This link isn't active" until they reloaded. A refresh is a
 * real browser request to `/invite`, which does carry the cookie. Mounted only
 * on the no-token render, so a genuinely dead link (token present) never
 * re-requests, and the component stays mounted across the refresh so it cannot
 * loop.
 */
export function RecheckOnce() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
