import Link from "next/link";
import { Ban, Plus } from "lucide-react";
import { gateWorshipPage, readOrState } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { BackLink } from "@/app/(org)/o/[slug]/worship/worship-states";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { formatWhen } from "@/components/worship/service-when";
import { OrgAccessError } from "@/lib/authz";
import { NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { getServicesList } from "@/lib/worship/reads";

/**
 * `/o/<slug>/admin/worship/services` - the services list (Copy G4): "Coming up" and
 * "Earlier" as two links (a search param, so a bookmark works), each service a card
 * with how many positions are filled and how many people have not answered. Any
 * worship key may read it; the add buttons are for `worship.plan`.
 */
export default async function WorshipServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { slug } = await params;
  const { scope: rawScope } = await searchParams;
  const scope = rawScope === "earlier" ? "earlier" : "upcoming";
  const path = `/o/${slug}/admin/worship/services`;
  const heading = SERVICES_COPY.list.heading;
  const gate = await gateWorshipPage({ slug, path, anyOf: ["manage", "plan", "schedule"], heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getServicesList>>;
  try {
    result = await getServicesList(identity.viewer, { scope });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, { slug, name: identity.organizationName, heading, retryHref: path });
  if (!read.ok) return read.node;
  const canPlan = identity.has.plan;

  const tab = (value: "upcoming" | "earlier", label: string) => (
    <Button asChild variant={scope === value ? "default" : "outline"} className="min-h-11">
      <Link href={value === "upcoming" ? path : `${path}?scope=earlier`} aria-current={scope === value ? "page" : undefined}>
        {label}
      </Link>
    </Button>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/o/${slug}/admin/worship`} label={NAV_COPY.backToPlan} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        {canPlan && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="min-h-11">
              <Link href={`${path}/new`}>
                <Plus className="size-4" aria-hidden />
                {SERVICES_COPY.list.addOne}
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`${path}/generate`}>{SERVICES_COPY.list.addSeveral}</Link>
            </Button>
          </div>
        )}
      </div>
      <nav aria-label={heading} className="flex gap-2">
        {tab("upcoming", SERVICES_COPY.list.tabUpcoming)}
        {tab("earlier", SERVICES_COPY.list.tabEarlier)}
      </nav>
      {read.data.length === 0 ? (
        <EmptyState
          title={SERVICES_COPY.list.empty}
          action={
            canPlan ? (
              <Button asChild className="min-h-11">
                <Link href={`${path}/new`}>{SERVICES_COPY.list.addOne}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3" data-testid="services-list">
          {read.data.map((service) => (
            <li key={service.eventId}>
              <Link
                href={`${path}/${service.eventId}`}
                className="block min-h-11 space-y-1 rounded-lg border border-border bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="block text-lg font-semibold [overflow-wrap:anywhere]">{service.title}</span>
                <span className="block text-base [overflow-wrap:anywhere]">{formatWhen(service.startsAt)}</span>
                {service.cancelled ? (
                  <span className="flex items-center gap-2 text-base font-medium">
                    <Ban className="size-4 shrink-0" aria-hidden />
                    {SERVICES_COPY.list.cancelledBadge}
                  </span>
                ) : (
                  <>
                    <span className="block text-sm text-muted-foreground">{SERVICES_COPY.list.filled(service.filled, service.needed)}</span>
                    {service.waiting > 0 && (
                      <span className="block text-sm text-muted-foreground">{SERVICES_COPY.list.waiting(service.waiting)}</span>
                    )}
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
