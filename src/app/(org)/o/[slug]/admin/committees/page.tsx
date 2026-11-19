import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OrgAccessError } from "@/lib/authz";
import { readCommissionList, readCommitteeList } from "@/lib/committees/reads";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { AREA, COMMISSIONS, LIST } from "@/lib/committees/ui-copy";
import { CommissionsSection } from "@/components/committees/commissions-section";
import { CommitteesList } from "@/components/committees/committees-list";
import { CommitteesForbidden, CommitteesLoadError, SectionLoadError } from "@/components/committees/committee-states";
import { CommitteeGateStateView } from "./committee-gate-state";

/**
 * `/o/<slug>/admin/committees`: the presbytery's committees by kind (Required,
 * Standing, Ad hoc, Not yet labelled) and, on request, the dissolved ones
 * (`?show=dissolved`), then the administrative commissions and, on request, the ended
 * ones (`?show=ended`). `show` is read as a fixed enum (either, both, or neither; any
 * other value is ignored), never a redirect target. Behind `gateCommitteesPage`
 * (DECISION-359): signed in, the Node-side second-factor recheck, the four-way org
 * miss, `assertOrgAccess`, the `org_portal.committees` flag, then the organization
 * type. The key (`groups.manage`) is each reader's own business, inside its own
 * transaction. The commissions section has its own reader and its own load error: if
 * it fails the committees above it stay up. No `loading.tsx` beneath this tree
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
  // A fixed enum: one value or several, each of them one of the two toggles. Anything else is no request at all.
  const asked = Array.isArray(show) ? show : show ? [show] : [];
  const shown = asked.every((v) => v === "dissolved" || v === "ended") ? asked : [];
  const showDissolved = shown.includes("dissolved");
  const showEnded = shown.includes("ended");
  const base = `/o/${slug}/admin/committees`;
  const pathFor = (dissolved: boolean, ended: boolean) => {
    const parts = [dissolved ? "show=dissolved" : null, ended ? "show=ended" : null].filter(Boolean);
    return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
  };

  const gate = await gateCommitteesPage({ slug, path: pathFor(showDissolved, showEnded) });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  let result;
  let commissions;
  try {
    [result, commissions] = await Promise.all([
      readCommitteeList(identity, { showDissolved }),
      readCommissionList(identity, { showEnded }).catch((err: unknown) => {
        if (err instanceof OrgAccessError) throw err;
        return null;
      }),
    ]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={base} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind !== "ok") return <CommitteesLoadError href={base} />;

  return (
    <section className="space-y-10">
      <div className="space-y-6">
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
        <CommitteesList list={result.data} slug={slug} toggleHref={pathFor(!showDissolved, showEnded)} />
      </div>
      {commissions !== null && commissions.kind === "ok" ? (
        <CommissionsSection list={commissions.data} slug={slug} toggleHref={pathFor(showDissolved, !showEnded)} />
      ) : (
        <section aria-labelledby="commissions-heading" className="space-y-3">
          <h2 id="commissions-heading" className="text-lg font-semibold">
            {COMMISSIONS.heading}
          </h2>
          <SectionLoadError href={pathFor(showDissolved, showEnded)} />
        </section>
      )}
    </section>
  );
}
