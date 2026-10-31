"use client";

import { useRef, useState } from "react";
import Link from "next/link";
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
import { COPY } from "@/lib/reimbursement/copy";
import { failureNeedsReload } from "../../../reimbursements/decision-feedback";
import { overrideApproveAction } from "../actions";

/**
 * "Approve as treasurer?" - the override approval, when no one in the group is
 * able to approve a submitted request. docs/work-log/2026-10-25-treasury-inc1.md,
 * Copy C8 ("Override") and the Batch 4 amendment (X3).
 *
 * An `AlertDialog` (never a native confirm). The two refusals the definer can give
 * - `Someone in {group} can approve this, so it needs their approval.` and
 * `This needs a second person who can record payments before you can approve it.
 * Whoever approves can't also pay.` - come back as the action's `error` and stay
 * INSIDE the dialog, because they are an answer to this very click and closing
 * would hide it. For the second, a viewer who holds `reimbursement.manage` gets
 * `suggestTeam`: the action cannot return a link, so this appends
 * `COPY.treasury.override.addOneUnderTeam` as a link to the Treasury team page,
 * its leading space kept as a real space before the link text (X3). A `pay`-only
 * viewer gets the sentence alone.
 *
 * The call carries the revision the page displayed; a stale one is "This request
 * changed after you opened it" and re-reads the page.
 */

export function OverrideDialog({
  slug,
  requestId,
  revision,
  group,
}: {
  slug: string;
  requestId: string;
  revision: number;
  group: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<{ error: string; suggestTeam: boolean } | null>(null);
  const busy = useRef(false);

  async function approve() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setRefusal(null);
    try {
      const result = await overrideApproveAction(slug, { requestId, expectedRevision: revision });
      if (result.ok) {
        toast.success(result.data.message);
        setOpen(false);
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      if (failureNeedsReload(result)) {
        toast.error(result.error);
        setOpen(false);
        router.refresh();
        return;
      }
      setRefusal({ error: result.error, suggestTeam: result.suggestTeam === true });
    } catch {
      setRefusal({ error: COPY.form.saveFailed, suggestTeam: false });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const link = COPY.treasury.override.addOneUnderTeam;
  const linkText = link.trimStart();
  const lead = link.slice(0, link.length - linkText.length);

  return (
    <>
      <Button type="button" className="min-h-11" onClick={() => setOpen(true)} data-testid="override-open">
        {COPY.treasury.buttons.approveAsTreasurer}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) setRefusal(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{COPY.treasury.override.title}</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {COPY.treasury.override.body(group)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {refusal && (
            <p role="alert" className="rounded-lg border border-border bg-muted p-3 text-base" data-testid="override-refusal">
              {refusal.error}
              {refusal.suggestTeam && (
                <>
                  {lead}
                  <Link
                    href={`/o/${slug}/admin/reimbursements/team`}
                    className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    data-testid="override-team-link"
                  >
                    {linkText}
                  </Link>
                </>
              )}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {COPY.decision.cancel}
            </AlertDialogCancel>
            <Button type="button" className="min-h-11" disabled={pending} onClick={approve} data-testid="override-confirm">
              {COPY.treasury.buttons.approveAsTreasurer}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
