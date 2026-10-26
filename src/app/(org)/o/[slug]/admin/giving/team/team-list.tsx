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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { TeamGrant } from "@/lib/giving/team";
import { revokeGivingRoleAction } from "./actions";

const KEY_WORDS: Record<string, string> = {
  "giving.view": "View giving",
  "giving.record": "Record gifts",
  "giving.manage": "Manage giving",
};

/** Who holds a giving permission now, with an AlertDialog-confirmed "End" on the ones this page may end. */
export function TeamList({ slug, grants }: { slug: string; grants: TeamGrant[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);

  async function revoke(grantId: string, label: string) {
    setPending(grantId);
    const result = await revokeGivingRoleAction(slug, { grantId });
    setPending(null);
    if (result.ok) {
      toast.success(`${label} no longer has this role.`);
      router.refresh();
    } else if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
    } else {
      toast.error(result.error);
    }
  }

  if (grants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center">
        <p className="text-sm font-medium">No one holds a giving role yet</p>
        <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
          Give a role below. A treasurer manages everything; a recorder can only enter gifts.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3" data-testid="team-list">
      {grants.map((grant) => {
        const who = grant.grantee.kind === "person" ? grant.grantee.displayName : `${grant.grantee.groupName} (group)`;
        return (
          <li key={grant.grantId} className="rounded-lg border border-border bg-card p-4 text-card-foreground">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-medium">{who}</p>
                <p className="text-sm text-muted-foreground">
                  {grant.roleName} &middot; since <FormattedDate value={grant.startsOn} mode="date" />
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {grant.givingKeys.map((key) => (
                <Badge key={key} variant="secondary">
                  {KEY_WORDS[key] ?? key}
                </Badge>
              ))}
            </div>
            <div className="mt-3">
              {grant.endableHere ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated || pending !== null}>
                      End this role
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>End {who}&apos;s {grant.roleName} role?</AlertDialogTitle>
                      <AlertDialogDescription>
                        They will lose the giving permissions above right away. Anything they have already
                        recorded stays. You can give the role again later.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep the role</AlertDialogCancel>
                      <AlertDialogAction onClick={() => revoke(grant.grantId, who)}>End role</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This one is managed under Roles, because it is given to a group or includes permissions
                  outside Giving and Reimbursements.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
