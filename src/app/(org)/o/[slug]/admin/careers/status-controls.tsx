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
import { useHydrated } from "@/components/shared/use-hydrated";
import { STALE_MESSAGE } from "@/lib/careers/messages";
import type { PostingStatus } from "@/lib/careers/postings";
import { setPostingStatusAction } from "./actions";

/**
 * Publish, Close, Reopen and Discard for ONE posting (Copy S6, S8). Every change goes
 * through an `AlertDialog` that names the posting - never a native `confirm()`
 * (Workflow Rule 2) - and calls `setPostingStatusAction(slug, { id, version, to })`; the
 * toast reports the status the action RETURNED, not the one that was asked for.
 *
 * WHICH BUTTONS, BY STATE (the lib's edges, the trigger's edges):
 *   draft        Publish, Discard this draft
 *   published    Close this opening
 *   closed       Reopen - EXCEPT a "Never published" row (a discarded draft), which stays
 *                discarded: its Reopen would be a first publication under a dialog that says
 *                "returns to your website ... at the top of the list", which is not true of it
 *                (orchestrator ruling on Batch 2's open point).
 *
 * REOPEN WITH A PASSED CLOSING DATE is refused by the lib and the trigger; the button is
 * disabled and the note says what to do instead (Copy S6), rather than letting the person
 * walk into the refusal.
 *
 * `prepare` lets the form save unsaved edits first, for the two changes that make the
 * posting public (Publish, Reopen), and hands back the version to publish: otherwise a
 * person who typed a change and clicked Publish would publish the SAVED text and lose
 * the rest on refresh. It returns null when the save failed (it has already said why).
 * Close and Discard never save.
 *
 * `disabled` until the page has hydrated (DECISION-159): a pre-hydration click does
 * nothing and reads as a broken button. A stale version (somebody else changed the
 * opening) shows the S8 message with a "Reload" action; nothing was written.
 */

type Change = "publish" | "close" | "reopen" | "discard";

function describe(change: Change, title: string) {
  switch (change) {
    case "publish":
      return {
        trigger: "Publish",
        title: `Publish "${title}"?`,
        body: "Anyone on the internet will be able to read this opening on your website. Changes you save later appear right away.",
        confirm: "Yes, publish",
        cancel: "Keep as draft",
        to: "published" as const,
      };
    case "close":
      return {
        trigger: "Close this opening",
        title: `Close "${title}"?`,
        body: "It will come off your website and out of the list of openings. You can reopen it later.",
        confirm: "Yes, close it",
        cancel: "Keep it open",
        to: "closed" as const,
      };
    case "reopen":
      return {
        trigger: "Reopen",
        title: `Reopen "${title}"?`,
        body: "It returns to your website right away, at the top of the list.",
        confirm: "Yes, reopen it",
        cancel: "Leave it closed",
        to: "published" as const,
      };
    case "discard":
      return {
        trigger: "Discard this draft",
        title: "Discard this draft?",
        body: "It moves to Closed and never appears on your website.",
        confirm: "Yes, discard it",
        cancel: "Keep the draft",
        to: "closed" as const,
      };
  }
}

/** The toast for the status the action returned, given where the posting started. */
function successToast(from: PostingStatus, returned: PostingStatus): string {
  if (returned === "published") return from === "draft" ? "Published." : "Reopened.";
  return from === "draft" ? "Draft discarded." : "Closed.";
}

function ChangeDialog({
  slug,
  postingId,
  title,
  version,
  from,
  change,
  disabled,
  describedBy,
  prepare,
}: {
  slug: string;
  postingId: string;
  title: string;
  version: number;
  from: PostingStatus;
  change: Change;
  disabled: boolean;
  describedBy?: string;
  prepare?: () => Promise<number | null>;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const copy = describe(change, title);
  const makesPublic = copy.to === "published";

  async function applyChange() {
    setPending(true);
    let useVersion = version;
    if (makesPublic && prepare) {
      const prepared = await prepare();
      if (prepared === null) {
        setPending(false);
        setOpen(false);
        return;
      }
      useVersion = prepared;
    }
    const result = await setPostingStatusAction(slug, { id: postingId, version: useVersion, to: copy.to });
    setPending(false);
    setOpen(false);
    if (result.ok) {
      toast.success(successToast(from, result.data!.status));
      router.refresh();
      return;
    }
    if (result.error === STALE_MESSAGE) {
      toast.error(result.error, { action: { label: "Reload", onClick: () => window.location.reload() } });
      return;
    }
    toast.error(result.error);
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={change === "publish" || change === "reopen" ? "default" : "outline"}
          className="min-h-11"
          disabled={!hydrated || disabled}
          aria-describedby={describedBy}
        >
          {copy.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog open until the action returns; `applyChange` closes it.
              event.preventDefault();
              void applyChange();
            }}
            disabled={pending}
          >
            {copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function StatusControls({
  slug,
  postingId,
  title,
  version,
  status,
  neverPublished,
  closingDatePassed,
  prepare,
}: {
  slug: string;
  postingId: string;
  title: string;
  version: number;
  status: PostingStatus;
  /** Closed and never published: a discarded draft. */
  neverPublished: boolean;
  /** The closing date is before the organization's today. */
  closingDatePassed: boolean;
  prepare?: () => Promise<number | null>;
}) {
  const common = { slug, postingId, title, version, from: status, prepare };
  const noteId = `reopen-note-${postingId}`;

  return (
    <div className="space-y-2" data-testid="status-controls">
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <>
            <ChangeDialog {...common} change="publish" disabled={false} />
            <ChangeDialog {...common} change="discard" disabled={false} />
          </>
        )}
        {status === "published" && <ChangeDialog {...common} change="close" disabled={false} />}
        {status === "closed" && !neverPublished && (
          <ChangeDialog
            {...common}
            change="reopen"
            disabled={closingDatePassed}
            describedBy={closingDatePassed ? noteId : undefined}
          />
        )}
      </div>
      {status === "closed" && !neverPublished && closingDatePassed && (
        <p id={noteId} className="text-sm text-muted-foreground">
          Its closing date has passed. Change the closing date, save, then reopen.
        </p>
      )}
    </div>
  );
}
