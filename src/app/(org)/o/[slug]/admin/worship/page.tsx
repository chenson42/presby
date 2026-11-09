import Link from "next/link";
import { CalendarCheck, ChevronRight, Layers, Users } from "lucide-react";
import { gateWorshipPage } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { HUB_COPY, TILE_COPY } from "@/lib/worship/copy";

/**
 * `/o/<slug>/admin/worship` - "Plan worship", the hub (Copy G3). Replaces the
 * "coming soon" stub. Cards only for what the viewer's keys allow: Services for a
 * holder of any worship key, Teams and Service types for `worship.manage`. A
 * leader with only a team seat has no key and reaches their board from "Worship"
 * (the member page), not from here.
 *
 * Gate: signed in, the org miss, applicability, the per-organization toggle (no
 * platform flag), then ANY worship key. No `loading.tsx` under `admin/worship/**`.
 */
export default async function PlanWorshipHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await gateWorshipPage({
    slug,
    path: `/o/${slug}/admin/worship`,
    anyOf: ["manage", "plan", "schedule"],
    heading: HUB_COPY.heading,
  });
  if (!gate.ok) return gate.node;
  const { has } = gate.identity;

  const cards = [
    { show: true, href: `/o/${slug}/admin/worship/services`, Icon: CalendarCheck, ...HUB_COPY.cards.services },
    { show: has.manage, href: `/o/${slug}/admin/worship/teams`, Icon: Users, ...HUB_COPY.cards.teams },
    { show: has.manage, href: `/o/${slug}/admin/worship/service-types`, Icon: Layers, ...HUB_COPY.cards.serviceTypes },
  ].filter((card) => card.show);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{HUB_COPY.heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{TILE_COPY.admin.description}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="worship-hub">
        {cards.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="flex h-full min-h-11 items-start gap-3 rounded-xl border border-border bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <card.Icon className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">{card.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{card.description}</span>
              </span>
              <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
