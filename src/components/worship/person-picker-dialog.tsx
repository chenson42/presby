"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getPickerCandidatesAction, placePersonAction } from "@/app/(org)/o/[slug]/worship/actions";
import { ACTION_COPY, BOARD_COPY, NAV_COPY } from "@/lib/worship/copy";
import type { PickerCandidate } from "@/lib/worship/reads";
import type { PickerWarning } from "@/lib/worship/plan";
import { formatCalendarDay } from "./service-when";

/**
 * "Add someone to {Position}" (Copy G5): the team's roster for one position on one
 * service, each with the warnings the leader should weigh. WARN, NEVER BLOCK: a
 * warning changes the button from "Add" to "Add anyway" and nothing more - the
 * database knows nothing about availability and the leader knows the people.
 *
 * Candidates are fetched when the dialog opens (and again when "Show everyone on
 * the team" flips), through a read action that repeats the gate (`schedule` or a
 * live seat on this team). A failed fetch says so and offers a retry; it is never an
 * empty list (which would read as "no one on the team"). A person is placed as a
 * DRAFT: nobody is told until the leader presses Send.
 */

function warningText(warning: PickerWarning): string {
  switch (warning.kind) {
    case "blocked_out":
      return BOARD_COPY.picker.cantServeOn(formatCalendarDay(warning.date));
    case "same_day":
      return BOARD_COPY.picker.alreadyScheduled(warning.position);
    case "overlap":
      return BOARD_COPY.picker.overlaps(warning.title);
    case "declined_this_service":
      return BOARD_COPY.picker.declinedThis;
  }
}

export function PersonPickerDialog({
  slug,
  eventId,
  groupId,
  positionId,
  positionName,
}: {
  slug: string;
  eventId: string;
  groupId: string;
  positionId: string;
  positionName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [candidates, setCandidates] = useState<PickerCandidate[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (all: boolean) => {
      setCandidates(null);
      setLoadFailed(false);
      try {
        const result = await getPickerCandidatesAction(slug, { eventId, groupId, positionId, showAll: all });
        if (result.ok) setCandidates(result.data ?? []);
        else setLoadFailed(true);
      } catch {
        setLoadFailed(true);
      }
    },
    [slug, eventId, groupId, positionId],
  );

  async function place(personId: string) {
    if (busy.current) return;
    busy.current = true;
    setPlacingId(personId);
    try {
      const result = await placePersonAction(slug, { eventId, groupId, positionId, personId });
      if (result.ok) {
        toast.success(BOARD_COPY.picker.toast);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
        void load(showAll);
        router.refresh();
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPlacingId(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load(false);
        else setShowAll(false);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" data-testid={`add-someone-${positionId}`}>
          {BOARD_COPY.addSomeone}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{BOARD_COPY.picker.title(positionName)}</DialogTitle>
          <DialogDescription className="sr-only">{BOARD_COPY.picker.title(positionName)}</DialogDescription>
        </DialogHeader>

        <label className="flex min-h-11 items-center gap-3 text-base">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
              void load(e.target.checked);
            }}
            data-testid="show-everyone"
          />
          {BOARD_COPY.picker.showEveryone}
        </label>

        <div aria-live="polite">
          {loadFailed ? (
            <div className="space-y-3" data-testid="picker-error">
              <p role="alert" className="text-base font-medium">
                {NAV_COPY.candidatesError}
              </p>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => void load(showAll)}>
                {NAV_COPY.tryAgain}
              </Button>
            </div>
          ) : candidates === null ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
              ))}
              <span className="sr-only">{NAV_COPY.loadingCandidates}</span>
            </div>
          ) : candidates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-base text-muted-foreground" data-testid="picker-empty">
              {BOARD_COPY.picker.empty}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="picker-list">
              {candidates.map((candidate) => {
                const warned = candidate.warnings.length > 0;
                return (
                  <li key={candidate.personId} className="space-y-2 rounded-lg border border-border p-3" data-testid="picker-row">
                    <div>
                      <p className="text-base font-medium [overflow-wrap:anywhere]">{candidate.displayName}</p>
                      <p className="text-sm text-muted-foreground">
                        {candidate.qualified ? BOARD_COPY.picker.canFill : BOARD_COPY.picker.notMarked}
                      </p>
                      {candidate.warnings.map((warning, index) => (
                        <p key={index} className="text-sm font-medium [overflow-wrap:anywhere]" data-testid="picker-warning">
                          {warningText(warning)}
                        </p>
                      ))}
                      {candidate.info.map((info) => (
                        <p key={info.kind} className="text-sm text-muted-foreground">
                          {BOARD_COPY.picker.mayBeUnder18}
                        </p>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant={warned ? "outline" : "default"}
                      className="min-h-11 w-full sm:w-auto"
                      disabled={placingId !== null}
                      onClick={() => void place(candidate.personId)}
                    >
                      {warned ? BOARD_COPY.picker.addAnyway : BOARD_COPY.picker.add}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
