import type { HouseholdSummary } from "@/lib/directory";
import { HouseholdCard } from "./household-card";

/**
 * `?view=households`'s card grid — the households counterpart to
 * `directory-grid.tsx`'s member cards. Deliberately NOT an async component
 * (unlike `DirectoryGrid`): a household card has no photo to resolve, so
 * there is nothing to `Promise.all()` before rendering.
 *
 * TWO DISTINCT EMPTY STATES, same discipline as `directory-grid.tsx`'s own:
 * a brand-new/zero-household congregation vs. a search that matched
 * nobody. `getHouseholds()` has already dropped every zero-visible-member
 * household by the time this component ever sees the list — nothing here
 * re-decides that.
 */
export function HouseholdsGrid({
  households,
  search,
  orgName,
  slug,
}: {
  households: HouseholdSummary[];
  search: string;
  orgName: string;
  slug: string;
}) {
  return (
    <div className="mt-6 space-y-6">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {households.length}{" "}
        {households.length === 1 ? "household" : "households"}
      </p>

      {households.length === 0 ? (
        <EmptyState search={search} orgName={orgName} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {households.map((household) => (
            <HouseholdCard
              key={household.householdId}
              household={household}
              slug={slug}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ search, orgName }: { search: string; orgName: string }) {
  if (search) {
    return (
      <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        No households match &ldquo;{search}&rdquo;. Try a different name.
      </p>
    );
  }

  return (
    <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
      No households are listed for {orgName} yet.
    </p>
  );
}
