import { timeOfDayGreeting } from "@/lib/shared/greeting";
import { cn } from "@/lib/utils";

/**
 * MOVED HERE, UNMODIFIED IN BEHAVIOR, FROM
 * `src/components/org-portal/greeting.tsx` (exported there as `Greeting`) —
 * commit 1 of docs/work-log/2026-08-27-platform-home-and-portal.md (Phase 3,
 * DECISION-125). Renamed `GreetingBand` on the move: it now backs TWO route
 * trees (`/o/<slug>` and the new `/admin`), and `Greeting` alone no longer
 * disambiguated which. Same reasoning `DestinationCard`'s own header comment
 * already gives for one component across two axes — "two components would
 * drift... within a release."
 *
 * `/admin`'s previously bare `<h1>Welcome, {name}.</h1>` adopts the same
 * `bg-card`/`border-l-primary` accent-stripe treatment DECISION-104/105
 * already gave the org-portal home, rather than duplicating that Tailwind
 * string a second time.
 *
 * `displayName === null` covers TWO distinct cases the caller does not need
 * to tell apart here: a genuinely missing membership row, or a
 * non-essential read having failed and degraded gracefully. Either way, a
 * generic "Welcome." is the honest thing to say.
 *
 * `motionEnabled` is REQUIRED, not defaulted, so a future caller can't
 * silently inherit a motion decision made for a different call site. It
 * gates ONLY the one-time CSS mount fade-in (`animate-in fade-in-0`,
 * `tw-animate-css`) — the band's fill and padding are unconditional; only
 * the entrance animation is gated. `/admin`'s call site passes `false`,
 * hardcoded — there is no `org_portal.motion`-equivalent flag on the
 * platform axis, and inventing one for a single mount fade-in is not
 * justified by this pipeline. `prefers-reduced-motion: reduce` neutralizes
 * the animation via `globals.css`'s existing tree-wide rule, not a rule
 * added here.
 */
export function GreetingBand({
  displayName,
  motionEnabled,
}: {
  displayName: string | null;
  motionEnabled: boolean;
}) {
  const greeting = timeOfDayGreeting(new Date().getHours());
  return (
    <div
      className={cn(
        "rounded-xl border border-l-4 border-l-primary bg-card px-6 py-8 text-card-foreground shadow-sm",
        motionEnabled && "animate-in fade-in-0 duration-700",
      )}
    >
      <h1 className="text-2xl font-semibold">
        {displayName ? `${greeting}, ${displayName}.` : "Welcome."}
      </h1>
    </div>
  );
}
