"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSendPreviewAction, sendRequestsAction } from "@/app/(org)/o/[slug]/worship/actions";
import { ACTION_COPY, BOARD_COPY, NAV_COPY } from "@/lib/worship/copy";
import type { SendPreview } from "@/lib/worship/reads";

/**
 * "Send requests ({n})" and its confirming Dialog (Copy G5). Pressing the button
 * opens the dialog, which asks the server what a Send WOULD do (the same decision
 * `sendRequests` makes, without writing) and prints the counts: how many requests,
 * and how many of those people cannot be emailed and why. Only "Send requests" in the
 * dialog writes anything. A Send that would be refused for size, or when mail is
 * unavailable, says so in Copy's words and disables the button.
 *
 * `eventIds`/`groupId` are the scope: one team on one service on the member board,
 * every serving team on the admin board.
 */
export function SendRequestsDialog({
  slug,
  eventId,
  groupId,
  draftCount,
}: {
  slug: string;
  eventId: string;
  groupId?: string;
  draftCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const previewRun = useRef(0);

  /** Opening the dialog asks the server what a Send would do. Nothing is written. */
  async function openDialog() {
    const run = ++previewRun.current;
    setOpen(true);
    setPreview(null);
    setFailed(false);
    try {
      const result = await getSendPreviewAction(slug, { eventIds: [eventId], ...(groupId ? { groupId } : {}) });
      if (run !== previewRun.current) return;
      if (result.ok && result.data) setPreview(result.data);
      else setFailed(true);
    } catch {
      if (run === previewRun.current) setFailed(true);
    }
  }

  async function send() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await sendRequestsAction(slug, { eventIds: [eventId], ...(groupId ? { groupId } : {}) });
      if (result.ok && result.data) {
        toast.success(BOARD_COPY.send.toast(result.data.emailed, result.data.notEmailed));
        setOpen(false);
        router.refresh();
      } else if (!result.ok) {
        toast.error(result.error);
        setOpen(false);
        router.refresh();
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const blocked = preview
    ? preview.assignments === 0
      ? ACTION_COPY.sendNothing
      : preview.overCap
        ? ACTION_COPY.sendOverCap
        : !preview.mailAvailable
          ? ACTION_COPY.sendMailUnavailable
          : null
    : null;

  return (
    <>
      <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => void openDialog()} data-testid="send-open">
        {BOARD_COPY.send.button(draftCount)}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{BOARD_COPY.send.title(preview?.assignments ?? draftCount)}</DialogTitle>
            <DialogDescription asChild>
              <div aria-live="polite" className="text-sm text-muted-foreground">
                {failed ? (
                  <p role="alert">{NAV_COPY.candidatesError}</p>
                ) : preview === null ? (
                  <p>{NAV_COPY.loadingCandidates}</p>
                ) : blocked ? (
                  <p data-testid="send-blocked">{blocked}</p>
                ) : preview.notEmailed === 0 ? (
                  <p>{BOARD_COPY.send.bodyAllReachable}</p>
                ) : (
                  <p data-testid="send-body">
                    {BOARD_COPY.send.body(preview.notEmailed, preview.guardian, preview.noAddress, preview.doNotContact)}
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setOpen(false)}>
              {BOARD_COPY.send.cancel}
            </Button>
            <Button type="button" className="min-h-11" disabled={pending || preview === null || blocked !== null} onClick={send} data-testid="send-confirm">
              {BOARD_COPY.send.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
