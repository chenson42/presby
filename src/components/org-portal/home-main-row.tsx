import { cn } from "@/lib/utils";
import type { MainRowPlan } from "@/lib/org-portal/main-row";
import { YoursZone } from "@/components/org-portal/yours-zone";
import { UpcomingEventsCard } from "@/components/org-portal/upcoming-events-card";

/**
 * The portal home's main row: "Yours" and "Coming up" side by side from `md`,
 * stacked below. A Server Component and a pure render of the plan
 * `composeMainRow` produced — which cards exist, and how many columns, is
 * decided there, on the server, with no client measurement (R5; fpcw's
 * measured-height trim is deliberately not carried).
 *
 * `none` renders no element at all. `single` is a one-column grid, which is
 * full width — never a blank half. `double` is `md:grid-cols-2 items-start`
 * (unequal card heights are accepted). Each card owns its own `h2`, so the
 * outline stays h1 greeting, then h2 cards, then h2 domain sections. Yours
 * first, Coming up second, always.
 */
export function HomeMainRow({
  slug,
  plan,
  householdPageEnabled,
}: {
  slug: string;
  plan: MainRowPlan;
  householdPageEnabled: boolean;
}) {
  if (plan.layout === "none") return null;

  return (
    <div
      data-testid="home-main-row"
      className={cn(
        "grid grid-cols-1 items-start gap-6",
        plan.layout === "double" && "md:grid-cols-2",
      )}
    >
      {plan.yours && (
        <YoursZone
          slug={slug}
          household={plan.yours.household}
          groups={plan.yours.groups}
          householdPageEnabled={householdPageEnabled}
        />
      )}
      {plan.upcoming && <UpcomingEventsCard slug={slug} state={plan.upcoming} />}
    </div>
  );
}
