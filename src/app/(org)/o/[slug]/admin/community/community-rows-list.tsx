import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { CommunityRow } from "@/lib/community";
import type { CommunityView } from "@/lib/community-labels";

/**
 * Cards for the three admin-only lists (Visitors, Staff, Former). Each links to
 * the person's edit page, because a visitor or staff anchor has no Directory
 * page (DECISION-129/200). The detail line is "First visit {date}", the open
 * position titles, or "Removed {date}".
 */
export function CommunityRowsList({
  slug,
  view,
  rows,
}: {
  slug: string;
  view: Extract<CommunityView, "visitors" | "staff" | "former">;
  rows: CommunityRow[];
}) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.personId}>
          <Card className="py-4">
            <CardContent className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="break-words text-lg font-medium">{row.displayName}</h3>
                {row.email && (
                  <p className="break-all text-sm text-muted-foreground">{row.email}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  <Detail view={view} row={row} />
                </p>
              </div>
              <Button asChild variant="outline" className="min-h-11 shrink-0">
                <Link href={`/o/${slug}/admin/community/${row.personId}/edit`}>
                  Edit
                  <span className="sr-only"> {row.displayName}</span>
                </Link>
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Detail({
  view,
  row,
}: {
  view: "visitors" | "staff" | "former";
  row: CommunityRow;
}) {
  if (view === "visitors") {
    return row.firstVisitDate ? (
      <>
        First visit <FormattedDate value={row.firstVisitDate} mode="date" />
      </>
    ) : (
      <>Visitor</>
    );
  }
  if (view === "staff") {
    return <>{row.positions.join(", ")}</>;
  }
  return row.endedOn ? (
    <>
      Removed <FormattedDate value={row.endedOn} mode="date" />
    </>
  ) : (
    <>Removed</>
  );
}
