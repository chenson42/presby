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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { ReimbursementActionResult } from "@/lib/reimbursement/action-result";
import { COPY } from "@/lib/reimbursement/copy";
import type { TreasuryTeamGrant } from "@/lib/treasury/team";

/**
 * Who holds a treasury role now, with an `AlertDialog`-confirmed `End this role`
 * on the grants this page may end (a person-arm grant of a role made only of
 * treasury keys; anything else is ended under Roles and says so). docs/work-log/
 * 2026-10-25-treasury-inc1.md, Copy C9 and F296. Names only: no email, no key
 * list. The last holder of `reimbursement.manage` cannot be ended here and the
 * action says so (`That would leave no one able to manage reimbursements...`).
 * The trigger is disabled until hydration (it opens a dialog and calls an action).
 * The chrome strings are `COPY.team.panel`.
 */

export function TeamGrantList({
  grants,
  revoke,
}: {
  grants: TreasuryTeamGrant[];
  revoke: (input: { grantId: string }) => Promise<ReimbursementActionResult>;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const panel = COPY.team.panel;

  async function end(grantId: string, who: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(grantId);
    try {
      const result = await revoke({ grantId });
      if (result.ok) {
        toast.success(panel.roleEnded(who));
        router.refresh();
      } else if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return (
    <ul className="space-y-3" data-testid="team-list">
      {grants.map((grant) => {
        const who = grant.grantee.kind === "person" ? grant.grantee.displayName : `${grant.grantee.groupName} ${panel.groupSuffix}`;
        return (
          <li key={grant.grantId} className="rounded-lg border border-border bg-card p-4 text-card-foreground" data-testid="team-row">
            <p className="text-base font-medium [overflow-wrap:anywhere]">{who}</p>
            <p className="text-sm text-muted-foreground">
              <span className="[overflow-wrap:anywhere]">{grant.roleName}</span> &middot; {panel.since}{" "}
              <FormattedDate value={grant.startsOn} mode="date" />
            </p>
            <div className="mt-3">
              {grant.endableHere ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated || pending !== null} data-testid="team-end-open">
                      {panel.endButton}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="[overflow-wrap:anywhere]">{panel.endTitle(who, grant.roleName)}</AlertDialogTitle>
                      <AlertDialogDescription>{panel.endBody}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="min-h-11">{panel.keepRole}</AlertDialogCancel>
                      <Button type="button" className="min-h-11" onClick={() => void end(grant.grantId, who)} data-testid="team-end-confirm">
                        {panel.endConfirm}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <p className="text-sm text-muted-foreground">{panel.managedUnderRoles}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
