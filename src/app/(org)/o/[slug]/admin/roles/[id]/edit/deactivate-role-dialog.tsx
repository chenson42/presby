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
import { deactivateRoleAction } from "./actions";

/**
 * Deactivates an existing custom role. `AlertDialog`, never `confirm()`
 * (Workflow Rule 2) — modeled directly on `../../revoke-dialog.tsx`'s own
 * destructive-confirm shape.
 *
 * NAMES `holderCount` AND STATES GRANTS ARE ENDED, NOT THE ROLE DELETED
 * (Phase 3 Component Plan, DECISION-106 ruling 4): the confirmation copy
 * must not read as a delete. This soft-deactivates
 * (`app_roles.deactivated_at`) and ends every currently-effective
 * `role_grants` row pointing at the role in the SAME transaction
 * (`deactivateRole()`) — the role's own history, and the ended grants'
 * history, both stay on record.
 */
export function DeactivateRoleDialog({
  slug,
  roleId,
  roleName,
  holderCount,
}: {
  slug: string;
  roleId: string;
  roleName: string;
  holderCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await deactivateRoleAction(slug, roleId);
    setPending(false);
    if (result.ok) {
      toast.success(`${roleName} deactivated.`);
      router.push(`/o/${slug}/admin/roles`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" className="min-h-11">
          Deactivate role
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {roleName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {holderCount === 0
              ? "Nobody currently holds this role. "
              : holderCount === 1
                ? "1 person currently holds this role. "
                : `${holderCount} people currently hold this role. `}
            Deactivating it immediately ends every current grant of this
            role — the role itself is not deleted, and both the role and its
            ended grants stay on record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Deactivating…" : `Yes, deactivate ${roleName}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
