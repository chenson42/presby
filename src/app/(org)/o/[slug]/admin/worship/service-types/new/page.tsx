import { gateWorshipPage, readOrState } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { OrgAccessError } from "@/lib/authz";
import { NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { getServiceFormOptions } from "@/lib/worship/reads";
import { ServiceTypeForm } from "../service-type-form";

export default async function NewServiceTypePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/worship/service-types/new`;
  const heading = NAV_COPY.newServiceType;
  const gate = await gateWorshipPage({ slug, path, anyOf: ["manage"], heading });
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
      <h1 className="text-2xl font-semibold">{SERVICES_COPY.types.heading}</h1>
      <ServiceTypeForm slug={slug} teams={read.data.teams} />
    </div>
  );
}
