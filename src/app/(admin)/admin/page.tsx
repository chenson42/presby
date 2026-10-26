import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { CountCardSkeleton } from "@/components/shared/count-card";
import { EmptyState } from "@/components/shared/empty-state";
import { FormattedDate } from "@/components/shared/formatted-date";
import { GreetingBand } from "@/components/shared/greeting-band";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { DASHBOARD_CARD_VIEWS } from "./_dashboard/cards";
import { FindOrganization } from "./_dashboard/find-organization";
import { visibleDashboardZones } from "./_dashboard/visible";
import { visibleAdminNav } from "./visible-nav";

/**
 * `/admin` — the platform console's dashboard (Increment 1 of the platform
 * admin redesign; the tile grid is retired).
 *
 *   GreetingBand
 *   [ADMIN_ORGANIZATIONS]  action bar: New organization, Find an organization
 *   "Updated {time}"
 *   zone Organizations / Support / Access and settings / Recent operator changes
 *
 * EACH CARD IS ITS OWN `Suspense` and its own async server component, so a slow
 * or failed read costs one card, never the page (U2, E5), and the page shell
 * paints at once. There is NO `loading.tsx` under this segment (R1c,
 * DECISION-251): it would wrap four `notFound()` routes and answer their 404s
 * with HTTP 200.
 *
 * A CARD IS MOUNTED ONLY FOR A HOLDER of the key of the page it links to, so a
 * reader never runs for a non-holder (E4). Zones follow the nav groups and are
 * static, so each card streams independently. Hiding is not authorization;
 * every destination re-checks.
 *
 * "Updated" is this request's render time, not a database timestamp: cards
 * stream in after it, within the same request.
 *
 * EMPTY STATE (reachable): a role holding only the door feature
 * (`ADMIN_DASHBOARD`) is admitted by the proxy but holds no other `admin.*`
 * key. It gets the honest empty state, with the strings it has always had.
 * A holder of only nav-only keys (flags, what's new) has tools but no card;
 * they get the greeting and the nav, not a false "no access".
 *
 * `GreetingBand` keeps `data-testid="greeting-band"`, which six e2e specs key
 * on; `GreetingBand` itself is not edited, so the org portal is untouched.
 */
export default async function AdminDashboard() {
  const session = await auth();
  const features = session?.user?.features;

  const holdsAnyTool = visibleAdminNav(features).some((group) =>
    group.items.some((item) => item.requiredFeature !== null),
  );
  const canManageOrganizations = hasFeature(features, FEATURES.ADMIN_ORGANIZATIONS);
  const zones = visibleDashboardZones(features);

  return (
    <div className="space-y-8">
      <GreetingBand
        displayName={session?.user?.name ?? null}
        motionEnabled={false}
      />

      {holdsAnyTool ? null : (
        <EmptyState
          title="You don't have access to any admin tools yet."
          body="Contact a platform administrator to request the features you need."
        />
      )}

      {canManageOrganizations ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <Button asChild className="min-h-11 w-full sm:order-2 sm:w-auto">
            <Link href="/admin/organizations/new">New organization</Link>
          </Button>
          <FindOrganization />
        </div>
      ) : null}

      {zones.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Updated <FormattedDate value={new Date()} />
        </p>
      ) : null}

      {zones.map(({ zone, cards }) => (
        <section key={zone.key} aria-labelledby={`zone-${zone.key}`}>
          <h2 id={`zone-${zone.key}`} className="text-lg font-semibold">
            {zone.heading}
          </h2>
          <div
            className={
              zone.key === "recent"
                ? "mt-3 grid grid-cols-1 gap-3"
                : "mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            }
          >
            {cards.map((card) => {
              const View = DASHBOARD_CARD_VIEWS[card.id];
              return (
                <Suspense
                  key={card.id}
                  fallback={<CountCardSkeleton title={card.title} />}
                >
                  <View />
                </Suspense>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
