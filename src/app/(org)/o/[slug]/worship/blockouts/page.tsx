import { OrgAccessError } from "@/lib/authz";
import { MEMBER_COPY, NAV_COPY } from "@/lib/worship/copy";
import { getMyBlockouts } from "@/lib/worship/reads";
import { gateWorshipPage, readOrState } from "../worship-gate";
import { BackLink } from "../worship-states";
import { BlockoutForm } from "./blockout-form";
import { BlockoutList } from "./blockout-list";

/**
 * `/o/<slug>/worship/blockouts` - "Dates I can't serve" (Copy G6, DECISION-327). The
 * viewer's own live ranges and the form to add one. A reason is a closed choice
 * (never free text); a range that touches another joins it; saving never cancels
 * anything the person already agreed to.
 */
export default async function BlockoutsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/worship/blockouts`;
  const gate = await gateWorshipPage({ slug, path, heading: MEMBER_COPY.blockouts.heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getMyBlockouts>>;
  try {
    result = await getMyBlockouts(identity.viewer);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, { slug, name: identity.organizationName, heading: MEMBER_COPY.blockouts.heading, retryHref: path });
  if (!read.ok) return read.node;

  return (
    <div className="max-w-2xl space-y-8">
      <BackLink href={`/o/${slug}/worship`} label={NAV_COPY.backToWorship} />
      <div>
        <h1 className="text-2xl font-semibold">{MEMBER_COPY.blockouts.heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{MEMBER_COPY.blockouts.helper}</p>
      </div>
      <BlockoutForm slug={slug} />
      <BlockoutList slug={slug} items={read.data} />
    </div>
  );
}
