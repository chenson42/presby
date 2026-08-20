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
import { revokeRoleAction } from "./actions";

interface RevokeDialogProps {
  slug: string;
  grantId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  granteeType: "person" | "group";
  granteeId: string;
  granteeName: string;
}

/**
 * Revoke an existing role grant. `AlertDialog`, never `confirm()` (Workflow
 * Rule 2) — modeled directly on
 * `(admin)/admin/organizations/[id]/neutralize-dialog.tsx`. Names BOTH the
 * grantee and the role in the confirmation copy — never a generic "Are you
 * sure?" (Phase 3 design, mirroring that file's own A2 precedent).
 *
 * On `{ kind: "self_lockout_blocked" }` (or any other denial), the failure
 * surfaces via `toast.error(result.error)` with the server's own message —
 * the same pattern `NeutralizeDialog` already uses for its own destructive
 * confirm, and explicitly permitted by the Phase 3 design ("toast.error or
 * an inline alert — your call, but it must not close the dialog silently or
 * show a generic failure"). The toast IS the visible feedback; nothing here
 * downgrades a denial to a silent no-op.
 */
export function RevokeDialog({
  slug,
  grantId,
  roleId,
  roleKey,
  roleName,
  granteeType,
  granteeId,
  granteeName,
}: RevokeDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await revokeRoleAction(slug, {
      grantId,
      roleId,
      roleKey,
      granteeType,
      granteeId,
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${roleName} revoked from ${granteeName}.`);
      // See grant-role-form.tsx's identical comment — `revalidatePath()`
      // alone does not re-render an already-mounted page; confirmed live.
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Revoke {roleName} from {granteeName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {granteeName} will immediately lose the {roleName} role at this
            organization. The grant ends and stays on record — it is not
            deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Revoking…" : `Yes, revoke ${roleName}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
