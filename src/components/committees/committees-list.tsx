import Link from "next/link";
import { Button } from "@/components/ui/button";
import { groupCommittees } from "@/lib/committees/derive";
import type { CommitteeList } from "@/lib/committees/reads";
import { LIST } from "@/lib/committees/ui-copy";
import { CommitteesSection } from "./committees-section";
import { GuidedEmpty } from "./committee-states";

/**
 * The list's sections in the order Required, Standing, Ad hoc, Not yet labelled (a
 * section with no committee is omitted; the unlabelled one carries its prompt),
 * then the Dissolved toggle and, when asked for, the Dissolved section. A
 * presbytery with no committee of any kind (dissolved ones included) sees the
 * guided empty state, never a bare "No committees".
 */
export function CommitteesList({ list, slug }: { list: CommitteeList; slug: string }) {
  const base = `/o/${slug}/admin/committees`;
  const sections = groupCommittees(list.committees);
  const liveCount = list.committees.filter((c) => c.dissolvedOn === null).length;

  if (liveCount === 0 && list.dissolvedCount === 0) {
    return (
      <GuidedEmpty title={LIST.emptyTitle}>
        <p>{LIST.emptyBody}</p>
        <Button asChild className="mt-4 min-h-11">
          <Link href={`${base}/new`}>{LIST.emptyAction}</Link>
        </Button>
      </GuidedEmpty>
    );
  }

  return (
    <div className="space-y-8">
      {sections.required.length > 0 ? <CommitteesSection heading={LIST.sections.required} rows={sections.required} slug={slug} /> : null}
      {sections.standing.length > 0 ? <CommitteesSection heading={LIST.sections.standing} rows={sections.standing} slug={slug} /> : null}
      {sections.ad_hoc.length > 0 ? <CommitteesSection heading={LIST.sections.ad_hoc} rows={sections.ad_hoc} slug={slug} /> : null}
      {sections.unlabelled.length > 0 ? (
        <CommitteesSection heading={LIST.sections.unlabelled} note={LIST.unlabelledNote} rows={sections.unlabelled} slug={slug} />
      ) : null}
      {list.showDissolved && sections.dissolved.length > 0 ? (
        <CommitteesSection heading={LIST.sections.dissolved} rows={sections.dissolved} slug={slug} showKind />
      ) : null}
      {list.dissolvedCount > 0 ? (
        <p>
          <Link
            href={list.showDissolved ? base : `${base}?show=dissolved`}
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {list.showDissolved ? LIST.hideDissolved : LIST.showDissolved(list.dissolvedCount)}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
