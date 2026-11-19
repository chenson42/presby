import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OrgAccessError } from "@/lib/authz";
import { readCommitteeList } from "@/lib/committees/reads";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { AREA, LIST } from "@/lib/committees/ui-copy";
import { CommitteesList } from "@/components/committees/committees-list";
import { CommitteesForbidden, CommitteesLoadError } from "@/components/committees/committee-states";
import { CommitteeGateStateView } from "./committee-gate-state";

/**
 * `/o/<slug>/admin/committees`: the presbytery's committees by kind (Required,
 * Standing, Ad hoc, Not yet labelled) and, on request, the dissolved ones
 * (`?show=dissolved`, read as a fixed enum, never a redirect target). Behind
 * `gateCommitteesPage` (DECISION-359): signed in, the Node-side second-factor
 * recheck, the four-way org miss, `assertOrgAccess`, the `org_portal.committees`
 * flag, then the organization type. The key (`groups.manage`) is the reader's own
 * business, inside its own transaction. No `loading.tsx` beneath this tree
 * (DECISION-251).
 */
export default async function CommitteesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { slug } = await params;
  const { show } = await searchParams;
  const showDissolved = show === "dissolved";
  const base = `/o/${slug}/admin/committees`;

  const gate = await gateCommitteesPage({ slug, path: showDissolved ? `${base}?show=dissolved` : base });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  let result;
  try {
    result = await readCommitteeList(identity, { showDissolved });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={base} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind !== "ok") return <CommitteesLoadError href={base} />;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{AREA}</h1>
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{identity.organizationName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{LIST.intro(identity.organizationName)}</p>
        </div>
        <Button asChild className="min-h-11">
          <Link href={`${base}/new`}>{LIST.newCommittee}</Link>
        </Button>
      </div>
      <CommitteesList list={result.data} slug={slug} />
    </section>
  );
}
