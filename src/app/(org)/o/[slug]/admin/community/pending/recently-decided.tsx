import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import { ROLL_ACTION_KIND_LABELS } from "@/lib/roll-action-kinds";
import type { DecidedRollAction } from "@/lib/roll";

const STATUS_LABEL = {
  approved: "Approved",
  denied: "Denied",
  withdrawn: "Withdrawn",
} as const;

/**
 * "Recently decided": the last decisions, newest first, with denial and
 * withdrawal reasons (a denied proposal used to vanish: F179). A server
 * component; reasons are returned only to holders of the two roll keys. A
 * long reason wraps (`break-words`) rather than widening the page at 360px.
 */
export function RecentlyDecided({ actions }: { actions: DecidedRollAction[] }) {
  return (
    <section aria-labelledby="recently-decided-heading" className="space-y-3">
      <h2 id="recently-decided-heading" className="text-lg font-semibold">
        Recently decided
      </h2>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing decided yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {actions.map((a) => (
            <li
              key={a.id}
              className="space-y-1 p-4 text-sm"
              data-testid="decided-row"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-words font-medium">
                  {a.personDisplayName}
                </span>
                {a.selfDecided && a.status === "approved" && (
                  <Badge variant="outline" className="font-normal">
                    Self-approved
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground">
                {ROLL_ACTION_KIND_LABELS[a.kind]}, effective{" "}
                <FormattedDate value={a.effectiveDate} mode="date" />
              </p>
              <p className="break-words">
                {STATUS_LABEL[a.status]}{" "}
                <FormattedDate value={a.decidedOn} mode="date" />
                {a.reason ? `: ${a.reason}` : ""}
                {a.status === "approved" && a.minuteReference
                  ? ` · ${a.minuteReference}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
