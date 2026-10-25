import { auth } from "@/auth";
import { EmptyState } from "@/components/shared/empty-state";
import { GreetingBand } from "@/components/shared/greeting-band";
import { visibleAdminNav } from "./visible-nav";

/**
 * `/admin` — the platform console's home.
 *
 * INTERIM (Increment 1, Batch A): the tile grid is retired and the nav in the
 * layout is now the way to every tool. Batch C replaces the body below the
 * greeting with the dashboard (zones of count cards, each its own Suspense).
 * `GreetingBand` keeps `data-testid="greeting-band"`, which six e2e specs key
 * on; `GreetingBand` itself is not edited, so the org portal is untouched.
 *
 * EMPTY STATE (reachable): a role holding only the door feature
 * (`ADMIN_DASHBOARD`) is admitted by the proxy but holds no other `admin.*`
 * key. It gets the honest empty state, with the strings it has always had.
 */
export default async function AdminDashboard() {
  const session = await auth();

  const holdsAnyTool = visibleAdminNav(session?.user?.features).some((group) =>
    group.items.some((item) => item.requiredFeature !== null),
  );

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
    </div>
  );
}
