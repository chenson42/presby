import Link from "next/link";
import { CircleAlert, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormattedDate } from "@/components/shared/formatted-date";
import { CHANGE_LABELS } from "@/lib/admin-portal/dashboard/change-labels";
import { readRecentChangesCard } from "@/lib/admin-portal/dashboard/recent-changes";

/**
 * "Recent operator changes": a wide LIST card (Phase 3 Copy, group E), the one
 * dashboard card that is not a count. Mounted only for an `ADMIN_AUDIT` holder.
 *
 * A row is plain text, so there is no nested link; the one link is "View the
 * audit log" at 44px. A row shows the label, the subject (an organization's
 * public name or a flag key) when there is one, the actor's address or
 * "System", and the time. The time goes on its own line so a 360px screen
 * wraps the subject and address instead of widening the card (`min-w-0`,
 * `break-words`). It claims "worth a second look" and nothing like "protected"
 * or "verified": the residual in DECISION-194 is detected by audit, not
 * prevented.
 *
 * An empty list means no row of this closed list exists, not that nothing
 * happened, hence "of this kind". A failed read is its own state and never
 * the empty line (U2).
 *
 * The zone heading above this card is the title, so the card carries none.
 */
export async function RecentChangesCard() {
  const result = await readRecentChangesCard();

  if (result.kind === "error") {
    return (
      <Card className="gap-3 border-dashed py-5 shadow-none">
        <CardHeader className="gap-2">
          <p className="flex items-start gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>We can&apos;t load this right now.</span>
          </p>
          <Button asChild variant="outline" className="mt-1 min-h-11 w-fit">
            <Link href="/admin">Try again</Link>
          </Button>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="gap-4 py-5">
      <CardHeader className="gap-1">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="size-4 shrink-0" aria-hidden="true" />
          Access, flag and account changes worth a second look.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recent changes of this kind.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {result.rows.map((row, i) => (
              <li key={`${row.at}-${i}`} className="min-w-0 py-3 first:pt-0">
                <p className="break-words text-sm font-medium">
                  {CHANGE_LABELS[row.action]}
                  {row.subject ? ` · ${row.subject}` : ""}
                </p>
                <p className="mt-0.5 break-words text-sm text-muted-foreground">
                  {row.actorEmail ?? "System"}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  <FormattedDate value={row.at} />
                </p>
              </li>
            ))}
          </ul>
        )}
        <Button asChild variant="outline" className="min-h-11 w-full sm:w-fit">
          <Link href="/admin/audit">View the audit log</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
