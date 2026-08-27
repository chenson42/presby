import { Badge } from "@/components/ui/badge";
import type { ParishRosterEntry } from "@/lib/directory";

/**
 * The Parishes / deacon-roster view (Increment 4). One panel per org unit —
 * district name, its deacon (or "Vacant"), and how many eligible households
 * it covers. `householdCount` and `deaconName` both come straight off
 * `getParishRoster()`'s own `ParishRosterEntry` — no re-derivation here, so
 * this view can never disagree with the Households tab about who's assigned
 * where (Phase 2 note 4 / Phase 3's own edge-case note).
 *
 * A SINGLE empty state (no search on this surface — the Phase 3 design
 * names no search box for Parishes): zero org units at all, which is true of
 * every congregation until district-shaped org units are created.
 *
 * NOT A `<Card>` (portal UX review 2026-08-26, H4): `getParishRoster()`
 * returns only per-district aggregates (name, deacon, a household count) —
 * there is no per-parish member/roster reader to drill into, so these
 * summaries have nowhere honest to link. Wired up as `<Card>`s (the same
 * `bg-card` + `shadow-sm` + hover-lift recipe `PersonCard`/`HouseholdCard`
 * use for their real links, DECISION-099) they were dead ends that *looked*
 * clickable. Rendered instead as flat `bg-muted/40` info panels — the same
 * non-interactive treatment already used for read-only summaries elsewhere
 * in the portal (e.g. the 2FA recovery-codes panel, the file-ticket form's
 * context box) — so they read as information, not a button that does
 * nothing. A future per-parish detail page (a real member roster to link
 * to) is tracked in `docs/TODO.md`, not built here — this polish batch's
 * scope is the existing dead-end cards, not a new route.
 */
export function ParishRoster({
  parishes,
  orgName,
}: {
  parishes: ParishRosterEntry[];
  orgName: string;
}) {
  if (parishes.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        {orgName} has no districts or parishes set up yet.
      </p>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {parishes.map((parish) => (
        <div
          key={parish.orgUnitId}
          className="rounded-lg border border-border bg-muted/40 p-4"
        >
          <h3 className="text-base font-semibold break-words">
            {parish.orgUnitName}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {parish.deaconName ? (
              <>Deacon: {parish.deaconName}</>
            ) : (
              <>Deacon: Vacant</>
            )}
          </p>
          <div className="mt-2">
            <Badge variant="secondary">
              {parish.householdCount}{" "}
              {parish.householdCount === 1 ? "household" : "households"}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
