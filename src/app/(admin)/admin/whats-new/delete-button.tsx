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
import { deleteWhatsNewEntry } from "./actions";

interface DeleteWhatsNewButtonProps {
  id: string;
  entryTitle: string;
}

export function DeleteWhatsNewButton({ id, entryTitle }: DeleteWhatsNewButtonProps) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await deleteWhatsNewEntry(id);
    setPending(false);
    if (result.ok) {
      toast.success("Entry deleted.");
    } else {
      toast.error(result.error ?? "Unable to delete — please try again.");
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{entryTitle}&rdquo; — Members will no longer see it. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
