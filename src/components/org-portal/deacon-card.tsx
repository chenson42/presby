import { UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PersonAvatar } from "@/app/(org)/o/[slug]/directory/person-avatar";

/**
 * The deacon block — rendered LAST and identically on both the household and
 * person detail pages (Phase 1's Flow 5, matching fpcw-directory's own
 * pattern), sourced from `HouseholdSummary.deaconName` /
 * `HouseholdDetail.deaconName` (`src/lib/directory.ts`'s
 * `deriveDeaconsByOrgUnit()`).
 *
 * `deaconName === null` covers TWO causes the caller does not and should not
 * distinguish here — a household with no district assigned at all, and a
 * household whose district's deacon term is currently vacant (Phase 3's own
 * design text: "renders a neutral 'no deacon assigned' state when
 * `org_unit_id` is null or the org unit is vacant — never a broken card").
 * Both render the SAME neutral copy below.
 *
 * The deacon is shown BY OFFICE, not filtered through the deacon's own
 * `directory_hidden`/field-privacy settings — `deriveDeaconsByOrgUnit()`
 * deliberately reads `officer_terms`/`people` directly rather than through
 * `queryDirectoryRows()`'s privacy-filtered predicate. This mirrors
 * fpcw-directory (Phase 1's prior-art survey): a parish/district's deacon is
 * public church structure, the same way `officer_terms`/`group_memberships`
 * already publish who's on Session regardless of a session member's own
 * directory preferences. Only a plain name string reaches this component —
 * no photo, no contact detail — so there is nothing privacy-sensitive to gate
 * even if that ruling were reversed later.
 *
 * No lock indicator here: the lock badge (Increment 4's `includeHidden` UI)
 * marks a DIRECTORY row an elevated viewer is seeing that an ordinary viewer
 * wouldn't — it has no meaning for a deacon shown by office to every viewer
 * who can reach this card at all.
 */
export function DeaconCard({ deaconName }: { deaconName: string | null }) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-center gap-3">
        {deaconName ? (
          <>
            <PersonAvatar
              photoSrc={null}
              displayName={deaconName}
              className="size-12"
            />
            <div>
              <p className="text-sm text-muted-foreground">Deacon</p>
              <p className="text-lg font-medium">{deaconName}</p>
            </div>
          </>
        ) : (
          <>
            <div
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <UserRound className="size-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Deacon</p>
              <p className="text-lg font-medium text-muted-foreground">
                No deacon is currently assigned
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
