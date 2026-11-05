import Link from "next/link";
import { Plus } from "lucide-react";
import { gateWorshipPage, readOrState } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { formatClockTime } from "@/components/worship/service-when";
import { OrgAccessError } from "@/lib/authz";
import { NAV_COPY, SERVICES_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { getServiceFormOptions, getServiceTypes } from "@/lib/worship/reads";

/** `/o/<slug>/admin/worship/service-types` - the usual time, place and teams for a kind of service (Copy G4): `worship.manage`. */
export default async function ServiceTypesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/worship/service-types`;
  const heading = SERVICES_COPY.types.heading;
  const gate = await gateWorshipPage({ slug, path, anyOf: ["manage"], heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let types: Awaited<ReturnType<typeof getServiceTypes>>;
  let options: Awaited<ReturnType<typeof getServiceFormOptions>>;
  try {
    [types, options] = await Promise.all([getServiceTypes(identity.viewer), getServiceFormOptions(identity.viewer)]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    types = options = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(types, { slug, name: identity.organizationName, heading, retryHref: path });
  if (!read.ok) return read.node;
  const teamNames = new Map((options.kind === "ok" ? options.data.teams : []).map((t) => [t.groupId, t.name]));
  const newHref = `/o/${slug}/admin/worship/service-types/new`;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <Button asChild className="min-h-11">
          <Link href={newHref}>
            <Plus className="size-4" aria-hidden />
            {NAV_COPY.newServiceType}
          </Link>
        </Button>
      </div>
      {read.data.length === 0 ? (
        <EmptyState
          title={SERVICES_COPY.types.empty}
          action={
            <Button asChild className="min-h-11">
              <Link href={newHref}>{NAV_COPY.newServiceType}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3" data-testid="service-types-list">
          {read.data.map((type) => (
            <li key={type.id}>
              <Link
                href={`/o/${slug}/admin/worship/service-types/${type.id}`}
                className="block min-h-11 space-y-1 rounded-lg border border-border bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="flex flex-wrap items-center gap-2 text-lg font-semibold [overflow-wrap:anywhere]">
                  {type.name}
                  {type.retired && (
                    <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm font-normal">{TEAMS_COPY.retiredBadge}</span>
                  )}
                </span>
                <span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {[
                    formatClockTime(type.startTime),
                    type.durationMinutes ? NAV_COPY.minutes(type.durationMinutes) : null,
                    type.location,
                  ]
                    .filter(Boolean)
                    .join(" - ")}
                </span>
                {type.teamIds.length > 0 && (
                  <span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {type.teamIds.map((id) => teamNames.get(id)).filter(Boolean).join(", ")}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
