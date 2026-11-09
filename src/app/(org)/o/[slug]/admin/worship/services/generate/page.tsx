import { gateWorshipPage, readOrState } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { BackLink } from "@/app/(org)/o/[slug]/worship/worship-states";
import { EmptyState } from "@/components/shared/empty-state";
import { OrgAccessError } from "@/lib/authz";
import { NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { getServiceFormOptions } from "@/lib/worship/reads";
import { GenerateForm } from "../generate-form";

/** `/o/<slug>/admin/worship/services/generate` - add several services from a service type (Copy G4): `worship.plan`. */
export default async function GenerateServicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/worship/services/generate`;
  const heading = SERVICES_COPY.list.addSeveral;
  const gate = await gateWorshipPage({ slug, path, anyOf: ["plan"], heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getServiceFormOptions>>;
  try {
    result = await getServiceFormOptions(identity.viewer);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, { slug, name: identity.organizationName, heading, retryHref: path });
  if (!read.ok) return read.node;

  return (
    <div className="max-w-xl space-y-6">
      <BackLink href={`/o/${slug}/admin/worship/services`} label={NAV_COPY.backToServices} />
      <h1 className="text-2xl font-semibold">{heading}</h1>
      {read.data.types.length === 0 ? (
        <EmptyState title={NAV_COPY.noServiceTypesTitle} body={NAV_COPY.noServiceTypesToUse} />
      ) : (
        <GenerateForm slug={slug} types={read.data.types.map((t) => ({ id: t.id, name: t.name }))} />
      )}
    </div>
  );
}
