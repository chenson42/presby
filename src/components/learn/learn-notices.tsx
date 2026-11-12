import { NOTICE } from "@/lib/learn/spot-the-scam/copy";

/**
 * The one notice the live slot shows for `unavailable` AND `failed` alike (the slot
 * cannot tell the causes apart and must not claim to, DECISION-154), and the route
 * shows for `failed` only. docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 Copy G4.
 * The `careers-notice.tsx` precedent. A Server Component.
 */
export function SpotTheScamUnavailableNotice() {
  return (
    <p className="text-lg text-muted-foreground" data-testid="spot-the-scam-unavailable">
      {NOTICE.unavailable}
    </p>
  );
}
