"use client";

import { useState } from "react";
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
import { neutralizeOrganizationBrandAction } from "./actions";

interface NeutralizeDialogProps {
  organizationId: string;
  organizationName: string;
}

/**
 * Neutralise an abusive tenant's brand — reverts it to the platform default.
 * `AlertDialog`, never `confirm()` (Workflow Rule 2). Names the organization
 * in the confirmation copy itself (A2: "every consequential confirmation
 * names the organization"), not a generic "Are you sure?".
 */
export function NeutralizeDialog({
  organizationId,
  organizationName,
}: NeutralizeDialogProps) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await neutralizeOrganizationBrandAction(
      (() => {
        const fd = new FormData();
        fd.set("organizationId", organizationId);
        return fd;
      })(),
    );
    setPending(false);
    if (result.ok) {
      toast.success(`${organizationName}'s brand has been neutralised.`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          Neutralise brand
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Neutralise {organizationName}&apos;s brand?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {organizationName} will immediately revert to the platform
            default colours and lose its logo everywhere it is shown. The
            current colour, type pairing and logo are recorded in the brand
            history before this happens. This is meant for abuse or
            impersonation — for an ordinary colour change, edit the brand
            below instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Neutralising…" : `Yes, neutralise ${organizationName}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
