import Link from "next/link";
import { Ban } from "lucide-react";
import { StatusChip } from "@/components/worship/status-chip";
import { formatWhen } from "@/components/worship/service-when";
import { MEMBER_COPY } from "@/lib/worship/copy";
import type { ScheduleItem } from "@/lib/worship/reads";
import { RequestActions } from "./request-actions";

/**
 * One request on "Worship" (Copy G6): "{Position}, {Team}", the service's title and
 * date, its status as text plus an icon, and the buttons for the status. A service
 * that was cancelled says so and offers no buttons (its answer can no longer
 * change). The heading links to the request page. Cards, not a table: this is the
 * 360px design.
 */
export function ScheduleCard({ slug, item }: { slug: string; item: ScheduleItem }) {
  const when = formatWhen(item.startsAt);
  return (
    <li className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="schedule-card" data-assignment-id={item.assignmentId}>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
          <Link
            href={`/o/${slug}/worship/requests/${item.assignmentId}`}
            className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {MEMBER_COPY.home.card(item.positionName, item.teamName)}
          </Link>
        </h3>
        <p className="text-base [overflow-wrap:anywhere]">{when}</p>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.title}</p>
      </div>
      {item.cancelled ? (
        <p className="flex items-center gap-2 text-base font-medium" data-testid="card-cancelled">
          <Ban className="size-4 shrink-0" aria-hidden />
          {MEMBER_COPY.home.cancelled}
        </p>
      ) : (
        <>
          <StatusChip status={item.status} declineReason={item.declineReason} />
          <RequestActions
            slug={slug}
            assignmentId={item.assignmentId}
            status={item.status}
            positionName={item.positionName}
            whenLabel={when}
            idPrefix={`card-${item.assignmentId}`}
          />
        </>
      )}
    </li>
  );
}
