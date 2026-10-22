"use client";

import { useId, useState, useTransition } from "react";
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
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DIALOG_BUTTONS,
  REASON_FIELD,
  revokeDialogContent,
  revokedMessage,
} from "@/lib/onboarding/designation-holder-copy";
import type { DesignationSlot, HolderRow } from "@/lib/onboarding/designation-holder-types";
import { revokeDesignationHolderAction } from "./actions";

/**
 * The confirm step for ending a designation holder's access (Workflow Rule 2:
 * an `AlertDialog`, never a native dialog). Controlled by the row that owns
 * the trigger. It names the organization and the person (or group), exactly
 * which roles end and what they carry, what happens to the slot, and takes a
 * REQUIRED reason (10 to 500 characters, kept in the audit log). All of its
 * sentences come from `designation-holder-copy.ts`.
 *
 * Plain controlled state, deliberately NOT `useForm`: the textarea is mounted
 * only while the dialog is open, which can only happen after hydration, so
 * there is no pre-hydration input to lose (the sections that render this keep
 * their own `<HydrationGate>`; `check:hydration-gate` covers `useForm` roots).
 * The body is a child that mounts with the dialog content, so the reason and
 * any error start empty every time it opens.
 *
 * The action runs on `AlertDialogAction` with `preventDefault()` (the
 * `send-invitation-dialog` idiom): the dialog stays open on a field error and
 * an inline failure, and closes on success or when the list needs a re-read
 * (`refresh`). A forged or stale submit gets the database's answer, never a
 * client-side decision.
 */
export function RevokeHolderDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
  slot,
  row,
  onRevoked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationName: string;
  slot: DesignationSlot;
  row: HolderRow;
  /** Called with the success sentence, so the section can keep it after the row is gone. */
  onRevoked: (message: string) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <RevokeHolderBody
          organizationId={organizationId}
          organizationName={organizationName}
          slot={slot}
          row={row}
          onClose={() => onOpenChange(false)}
          onRevoked={onRevoked}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RevokeHolderBody({
  organizationId,
  organizationName,
  slot,
  row,
  onClose,
  onRevoked,
}: {
  organizationId: string;
  organizationName: string;
  slot: DesignationSlot;
  row: HolderRow;
  onClose: () => void;
  onRevoked: (message: string) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const content = revokeDialogContent(slot, organizationName, row);

  function submit() {
    setFieldError(null);
    setInlineError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      fd.set("slot", slot);
      fd.set("subjectKind", row.subjectKind);
      fd.set("subjectId", row.subjectId);
      for (const id of row.grantIds) fd.append("expectedGrantId", id);
      fd.set("reason", reason);
      const result = await revokeDesignationHolderAction(fd);
      if (result.ok) {
        const message = revokedMessage(row, result.reachedZero);
        toast.success(message);
        onRevoked(message);
        onClose();
        return;
      }
      if (result.field === "reason") {
        setFieldError(result.error);
        return;
      }
      if (result.refresh) {
        toast.info(result.error);
        router.refresh();
        onClose();
        return;
      }
      setInlineError(result.error);
    });
  }

  return (
    <>
      <AlertDialogHeader className="place-items-start text-left">
        <AlertDialogTitle>{content.title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-3 text-left" data-testid="revoke-holder-dialog-body">
            <p>{content.intro}</p>
            <p>{content.rolesLine}</p>
            {content.permissionDescriptions.length > 0 && (
              <div>
                <p>{content.carriesLabel}</p>
                <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5">
                  {content.permissionDescriptions.map((description) => (
                    <li key={description}>{description}</li>
                  ))}
                </ul>
              </div>
            )}
            {content.companionLine && <p>{content.companionLine}</p>}
            {content.groupLine && <p>{content.groupLine}</p>}
            {content.stillHoldsLine && <p>{content.stillHoldsLine}</p>}
            <p className="font-medium text-foreground">{content.lastHolderLine}</p>
            {content.treasurerLine && <p>{content.treasurerLine}</p>}
            <p>{content.recordLine}</p>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div>
        <Label htmlFor={fieldId}>{REASON_FIELD.label}</Label>
        <Textarea
          id={fieldId}
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={`${fieldId}-help${fieldError ? ` ${fieldId}-error` : ""}`}
          autoComplete="off"
          rows={3}
          className="mt-1"
        />
        <p id={`${fieldId}-help`} className="mt-1.5 text-sm text-muted-foreground">
          {REASON_FIELD.helper}
        </p>
        {fieldError && (
          <p id={`${fieldId}-error`} role="alert" className="mt-1.5 text-sm text-destructive">
            {fieldError}
          </p>
        )}
      </div>

      {inlineError && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
          {inlineError}
        </p>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending} className="min-h-11">
          {DIALOG_BUTTONS.cancel}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          disabled={isPending}
          className="min-h-11"
          onClick={(event) => {
            // Keep the dialog open until the action returns: a field error or an
            // inline failure is shown here, not after the dialog has gone.
            event.preventDefault();
            submit();
          }}
        >
          {isPending ? DIALOG_BUTTONS.pending : DIALOG_BUTTONS.confirm}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
