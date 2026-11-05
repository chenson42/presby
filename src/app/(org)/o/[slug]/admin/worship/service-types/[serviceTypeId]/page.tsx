import { gateWorshipPage, readOrState } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { BackLink } from "@/app/(org)/o/[slug]/worship/worship-states";
import { OrgAccessError } from "@/lib/authz";
import { NAV_COPY, SERVICES_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { getServiceFormOptions, getServiceType } from "@/lib/worship/reads";
import { RetireServiceTypeDialog } from "../retire-service-type-dialog";
import { ServiceTypeForm } from "../service-type-form";

/** `/o/<slug>/admin/worship/service-types/<id>` - edit or retire a service type (Copy G4). An unknown id is the organization's 404. */
export default async function EditServiceTypePage({ params }: { params: Promise<{ slug: string; serviceTypeId: string }> }) {
  const { slug, serviceTypeId } = await params;
  const path = `/o/${slug}/admin/worship/service-types/${serviceTypeId}`;
  const heading = NAV_COPY.editServiceType;
  const gate = await gateWorshipPage({ slug, path, anyOf: ["manage"], heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let type: Awaited<ReturnType<typeof getServiceType>>;
  let options: Awaited<ReturnType<typeof getServiceFormOptions>>;
  try {
    [type, options] = await Promise.all([getServiceType(identity.viewer, { serviceTypeId }), getServiceFormOptions(identity.viewer)]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    type = options = { kind: "invalid_input", message: "" };
  }
  const readType = readOrState(type, { slug, name: identity.organizationName, heading, retryHref: path });
  if (!readType.ok) return readType.node;
  const readOptions = readOrState(options, { slug, name: identity.organizationName, heading, retryHref: path });
  if (!readOptions.ok) return readOptions.node;
  const value = readType.data;

  return (
    <div className="max-w-xl space-y-6">
      <BackLink href={`/o/${slug}/admin/worship/service-types`} label={NAV_COPY.backToServiceTypes} />
      <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold [overflow-wrap:anywhere]">
        {value.name}
        {value.retired && (
          <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm font-normal">{TEAMS_COPY.retiredBadge}</span>
        )}
      </h1>
      <ServiceTypeForm slug={slug} teams={readOptions.data.teams} existing={value} />
      {!value.retired && (
        <section className="border-t border-border pt-6" aria-label={SERVICES_COPY.types.retireDialog.confirm}>
          <RetireServiceTypeDialog slug={slug} serviceTypeId={value.id} name={value.name} />
        </section>
      )}
    </div>
  );
}
