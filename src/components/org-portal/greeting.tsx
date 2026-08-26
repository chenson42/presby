import { timeOfDayGreeting } from "@/lib/org-portal/greeting";
import { cn } from "@/lib/utils";

/**
 * The portal home's hero band, wrapping the `<h1>` (title role, per
 * `docs/ui-standards.md`). See `src/lib/org-portal/greeting.ts` for the pure
 * hour-boundary logic and the server-clock-vs-viewer-clock tradeoff this
 * component accepts.
 *
 * `displayName === null` covers TWO distinct cases the caller does not need
 * to tell apart here: a genuinely missing membership row, or
 * `getPortalHomeData()` having failed and degraded gracefully (Phase 3's
 * edge case: a non-essential read failing must never crash the whole page).
 * Either way, a generic "Welcome." is the honest thing to say.
 *
 * ELEVATED CARD, ACCENT STRIPE (docs/work-log/2026-08-26-portal-visual-
 * modernization.md, Phase 3 / DECISION-104, revised same day — DECISION-105
 * — on direct operator feedback that the original solid `bg-primary`/
 * `text-primary-foreground` fill's color combination was unpleasant, the same
 * flatness verdict as the tile grid). The band is now a `bg-card` surface
 * with a border, `shadow-sm`, and a `border-l-primary` accent stripe — the
 * same existing brand-cascade tokens every other surface uses, never a
 * hardcoded value, so a congregation's own brand override still applies
 * (DECISION-046), just carried by a stripe and the heading's own color
 * instead of a full-bleed fill. The `<h1>` itself keeps its existing
 * `text-2xl font-semibold` (already exactly `TYPE_SCALE`'s `title` role) —
 * no size change.
 *
 * `motionEnabled` is REQUIRED, not defaulted `true`/`false` inside the
 * component, so a future second caller can't silently inherit a motion
 * decision made for the home page (Phase 3 API Contract). It gates ONLY the
 * one-time CSS mount fade-in (`animate-in fade-in-0`, `tw-animate-css`,
 * already imported in `globals.css` and already used elsewhere in the tree —
 * e.g. `dropdown-menu.tsx`) behind `org_portal.motion` (seeded off) — the
 * band's fill and padding are unconditional; only the entrance animation is
 * gated. `prefers-reduced-motion: reduce` neutralizes the animation via
 * `globals.css`'s existing tree-wide rule, not a rule added here.
 */
export function Greeting({
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
