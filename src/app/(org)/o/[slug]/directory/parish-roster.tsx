import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ParishRosterEntry } from "@/lib/directory";

/**
 * The Parishes / deacon-roster view (Increment 4). One card per org unit —
 * district name, its deacon (or "Vacant"), and how many eligible households
 * it covers. `householdCount` and `deaconName` both come straight off
 * `getParishRoster()`'s own `ParishRosterEntry` — no re-derivation here, so
 * this view can never disagree with the Households tab about who's assigned
 * where (Phase 2 note 4 / Phase 3's own edge-case note).
 *
 * A SINGLE empty state (no search on this surface — the Phase 3 design
 * names no search box for Parishes): zero org units at all, which is true of
 * every congregation until district-shaped org units are created.
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
        <Card key={parish.orgUnitId} className="py-4">
          <CardContent>
            <h3 className="text-lg font-medium break-words">
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
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
