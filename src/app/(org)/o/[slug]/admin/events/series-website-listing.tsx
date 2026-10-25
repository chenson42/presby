"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatLongDate } from "@/lib/calendar/month";
import type { SeriesListingOutcome, SeriesWebsiteSummary } from "@/lib/events";
import { setSeriesWebsiteListingAction } from "./actions";

/** "1 event" / "3 events" */
function events(n: number): string {
  return `${n} ${n === 1 ? "event" : "events"}`;
}

/** The sentence the toast ends a "put" with when some rows were left out. */
export function putToast(outcome: SeriesListingOutcome): string {
  if (outcome.changed === 0) return "Nothing needed to change.";
  const skipped = outcome.skippedCancelled + outcome.skippedMembersOnly;
  return `${events(outcome.changed)} put on the website.${skipped > 0 ? ` ${skipped} left out.` : ""}`;
}

export function takeToast(outcome: SeriesListingOutcome): string {
  if (outcome.changed === 0) return "Nothing needed to change.";
  return `${events(outcome.changed)} taken off the website.`;
}

/** " 2 cancelled events and 1 members-only event are left out." (each clause only above zero) */
function leftOutSentence(cancelled: number, membersOnly: number): string {
  const parts: string[] = [];
  if (cancelled > 0) parts.push(`${cancelled} cancelled ${cancelled === 1 ? "event" : "events"}`);
  if (membersOnly > 0) parts.push(`${membersOnly} members-only ${membersOnly === 1 ? "event" : "events"}`);
  if (parts.length === 0) return "";
  const verb = cancelled + membersOnly === 1 ? "is" : "are";
  return ` ${parts.join(" and ")} ${verb} left out.`;
}

/**
 * The "Website listing" section on a series occurrence's page: put this event
 * and all later events of the series on the public website, or take them off,
 * in one step (Phase 3 Copy E7). Every other edit to a series stays one
 * occurrence at a time; this is the one series-wide action.
 *
 * The counts in the dialogs come from `getEvent()`'s `seriesWebsite`, computed
 * by the SAME planner the action writes with. The toast reports what the action
 * RETURNED (a concurrent edit may have moved the numbers since the page
 * loaded). `AlertDialog`, never `confirm()` (Workflow Rule 2).
 */
export function SeriesWebsiteListing({
  slug,
  eventId,
  summary,
}: {
  slug: string;
  eventId: string;
  summary: SeriesWebsiteSummary;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const fromDate = formatLongDate(summary.fromStartsAt.slice(0, 10));
  const { put, take } = summary;

  async function run(listed: boolean) {
    setPending(true);
    try {
      const result = await setSeriesWebsiteListingAction(slug, { eventId, listed });
      if (result.ok) {
        toast.success(listed ? putToast(result.data!) : takeToast(result.data!));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("We couldn't save that change. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h2 className="text-xl font-semibold">Website listing</h2>
      <p className="text-sm text-muted-foreground">
        Change this event and all the events after it in this series at once. To change only this
        event, use Edit event.
      </p>

      {put.changes === 0 && take.changes === 0 && (
        <p className="text-sm text-muted-foreground">
          No later events in this series can be changed.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {put.changes > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending}>
                Put this and later events on the website
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Put {events(put.changes)} on the website?</AlertDialogTitle>
                <AlertDialogDescription>
                  From {fromDate} on, {put.changes} {put.changes === 1 ? "event is" : "events are"}{" "}
                  marked to appear on your public website&apos;s calendar. Anyone on the internet can
                  read their titles, descriptions, locations and event types.
                  {leftOutSentence(put.skippedCancelled, put.skippedMembersOnly)}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep as it is</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(true)} disabled={pending}>
                  Yes, put {put.changes} on the website
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {take.changes > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending}>
                Take this and later events off the website
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Take {events(take.changes)} off the website?</AlertDialogTitle>
                <AlertDialogDescription>
                  From {fromDate} on, {events(take.changes)} will no longer appear on your public
                  website. Search engines and web archives may already hold copies.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep as it is</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(false)} disabled={pending}>
                  Yes, take {take.changes} off the website
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
