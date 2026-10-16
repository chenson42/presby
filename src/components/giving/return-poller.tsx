"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RETURN_COPY } from "@/lib/giving/giving-copy";

/** At most this many refreshes, this far apart: 30 seconds of patience, then stop. */
export const POLL_LIMIT = 6;
export const POLL_INTERVAL_MS = 5000;

/**
 * Re-reads the return page while a gift is still `confirming` - docs/work-log/
 * 2026-10-15-online-giving.md, Flow 3 step 4. The page reads presby's own rows,
 * not the query string, so the transition from "confirming" to "received" is the
 * webhook landing; this just asks the server component to render again.
 *
 * Bounded on purpose (6 x 5 s): an abandoned tab must not poll forever, and a
 * slow webhook is not an error. When the budget is spent it stops and says so
 * in words, without alarm. The server re-renders THIS component away the moment
 * the state is anything other than `confirming`, so no cleanup beyond the timer
 * is needed.
 */
export function ReturnPoller() {
  const router = useRouter();
  const [spent, setSpent] = useState(false);
  // The timer must outlive re-renders (setSpent re-renders this component) and
  // never restart because a router handle changed identity.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      routerRef.current.refresh();
      if (count >= POLL_LIMIT) {
        window.clearInterval(timer);
        setSpent(true);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return spent ? (
    <p role="status" data-testid="return-still-confirming" className="text-base text-muted-foreground">
      {RETURN_COPY.stillConfirming}
    </p>
  ) : (
    <p role="status" aria-live="polite" className="sr-only">
      Checking on your gift.
    </p>
  );
}
