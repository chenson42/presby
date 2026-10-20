import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import { formatCents } from "@/lib/giving/money";
import type { StatementRow } from "@/lib/giving/statements";
import { StatementRowActions } from "./statement-row-actions";

/**
 * The year's statements as a list of cards - one DOM for every width, phone
 * first (a table would scroll sideways at 360 px). Each card: the donor and the
 * total, when it was issued and how many gifts, then the words its state wears
 * (never colour alone): "Corrected" for version 2 and up, "Out of date" when a
 * later gift or refund has changed what it should say, "Replaced" for a version
 * a newer one supersedes, "Mailed" and "Notice emailed / bounced" for delivery,
 * and "No email or address" when it cannot be sent. Download is a plain link to
 * the route handler (an attachment); the two mutating actions are a client
 * component, rendered for a `giving.manage` holder only. A server component.
 */
export function StatementsTable({
  slug,
  year,
  statements,
  canManage,
  issuingEnabled,
}: {
  slug: string;
  year: number;
  statements: StatementRow[];
  canManage: boolean;
  issuingEnabled: boolean;
}) {
  return (
    <ul className="space-y-2" data-testid="statements-list">
      {statements.map((s) => {
        const undeliverable = !s.hasEmail && !s.hasAddress;
        return (
          <li key={s.id} className="rounded-lg border border-border bg-card p-4 text-card-foreground" data-testid="statement-row">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words text-base font-medium">{s.donorName}</p>
              <p className="shrink-0 text-base font-semibold">
                {s.cashTotalCents > 0 ? formatCents(s.cashTotalCents) : "Non-cash only"}
              </p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {s.giftCount === 1 ? "1 gift" : `${s.giftCount} gifts`}
              {s.nonCashCount > 0 ? ` (${s.nonCashCount} non-cash)` : ""} &middot; issued{" "}
              <FormattedDate value={s.issuedAt} mode="date" />
              {s.version > 1 ? ` · version ${s.version}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
              {s.version > 1 && s.isLatest && <Badge variant="outline">Corrected</Badge>}
              {!s.isLatest && <Badge variant="secondary">Replaced by a newer version</Badge>}
              {s.isStale && <Badge variant="secondary">Out of date</Badge>}
              {s.printMailedAt && <Badge variant="outline">Mailed</Badge>}
              {s.noticeSentAt && !s.noticeBounced && <Badge variant="outline">Notice emailed</Badge>}
              {s.noticeBounced && <Badge variant="secondary">Notice bounced</Badge>}
              {undeliverable && s.isLatest && <Badge variant="secondary">No email or address</Badge>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" className="min-h-11">
                <a href={`/o/${slug}/admin/giving/statements/${s.id}/download`} download>
                  <Download className="size-4" aria-hidden />
                  Download PDF
                </a>
              </Button>
              {canManage && s.isLatest && (
                <StatementRowActions
                  slug={slug}
                  statementId={s.id}
                  donorName={s.donorName}
                  year={year}
                  showMarkMailed={!s.printMailedAt}
                  showReissue={s.isStale}
                  issuingEnabled={issuingEnabled}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
