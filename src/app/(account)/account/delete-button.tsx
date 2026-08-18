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
import { requestAccountDeletion } from "./actions";

export function DeleteAccountButton() {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await requestAccountDeletion();
    setPending(false);
    if (result.ok) {
      toast.info(
        "Account deletion is not yet implemented. Contact support to delete your account.",
      );
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="rounded-md border border-red-500/40 px-4 py-2 text-sm text-red-600 hover:bg-red-500/10"
        >
          Delete account
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. All your data will be permanently
            removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? "Processing…" : "Yes, delete my account"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
