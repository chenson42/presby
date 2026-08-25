import { timeOfDayGreeting } from "@/lib/org-portal/greeting";

/**
 * The portal home's `<h1>` (title role, per `docs/ui-standards.md`). See
 * `src/lib/org-portal/greeting.ts` for the pure hour-boundary logic and the
 * server-clock-vs-viewer-clock tradeoff this component accepts.
 *
 * `displayName === null` covers TWO distinct cases the caller does not need
 * to tell apart here: a genuinely missing membership row, or
 * `getPortalHomeData()` having failed and degraded gracefully (Phase 3's
 * edge case: a non-essential read failing must never crash the whole page).
 * Either way, a generic "Welcome." is the honest thing to say.
 */
export function Greeting({ displayName }: { displayName: string | null }) {
  const greeting = timeOfDayGreeting(new Date().getHours());
  return (
    <h1 className="text-2xl font-semibold">
      {displayName ? `${greeting}, ${displayName}.` : "Welcome."}
    </h1>
  );
}
