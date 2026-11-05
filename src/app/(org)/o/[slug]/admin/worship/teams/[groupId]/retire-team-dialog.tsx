"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ACTION_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { retireTeamAction } from "../../actions";

/** "Retire {team}?" (Copy G3): an AlertDialog. A team still scheduled for upcoming services is refused by the store with its own sentence. */
export function RetireTeamDialog({ slug, groupId, teamName }: { slug: string; groupId: string; teamName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function retire() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await retireTeamAction(slug, { groupId });
      if (result.ok) {
        toast.success(TEAMS_COPY.retireTeamDialog.toast);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
        setOpen(false);
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)} data-testid="retire-team-open">
        {TEAMS_COPY.retireTeamDialog.confirm}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">{TEAMS_COPY.retireTeamDialog.title(teamName)}</AlertDialogTitle>
            <AlertDialogDescription>{TEAMS_COPY.retireTeamDialog.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {TEAMS_COPY.retireTeamDialog.cancel}
            </AlertDialogCancel>
            <Button type="button" className="min-h-11" disabled={pending} onClick={retire} data-testid="retire-team-confirm">
              {TEAMS_COPY.retireTeamDialog.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
