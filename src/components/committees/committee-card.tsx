import Link from "next/link";
import { chairLine, servingLine } from "@/lib/committees/copy";
import { LIST } from "@/lib/committees/ui-copy";
import type { CommitteeListRow } from "@/lib/committees/reads";
import { FormattedDate } from "@/components/shared/formatted-date";
import { KindBadge } from "./kind-badge";

export const LINK_CLASSES =
  "inline-flex min-h-11 max-w-full items-center font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function committeeHref(slug: string, id: string): string {
  return `/o/${slug}/admin/committees/${id}`;
}

/** One committee as a card (below `sm`): name as the link, kind badge, chair, how many serve, when it meets. */
export function CommitteeCard({ slug, row }: { slug: string; row: CommitteeListRow }) {
  return (
    <li className="space-y-1 rounded-lg border border-border p-3">
      <Link href={committeeHref(slug, row.id)} className={LINK_CLASSES}>
        <span className="min-w-0 [overflow-wrap:anywhere]">{row.name}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={row.kind} />
        {row.dissolvedOn ? (
          <span className="text-sm text-muted-foreground">
            {LIST.dissolvedOn} <FormattedDate value={row.dissolvedOn} mode="date" />
          </span>
        ) : null}
      </div>
      {row.dissolvedOn ? null : (
        <>
          <p className="text-sm [overflow-wrap:anywhere]">{chairLine(row.chairNames)}</p>
          <p className="text-sm text-muted-foreground">{servingLine(row.servingCount)}</p>
        </>
      )}
      {row.meetsWhen ? <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{LIST.meets(row.meetsWhen)}</p> : null}
    </li>
  );
}
