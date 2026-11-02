"use client";

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

/**
 * The shell the three Community confirmations share (engagement, archive,
 * restore; Increment 3a, Copy groups B and D): an `AlertDialog` (Rule 2, never a
 * native dialog), a title, one body sentence and then the impact lines, a Keep
 * button and a confirm button. Controlled: the caller owns `open` (a row button
 * or a card button opens it) and the write. The confirm control is a plain
 * `Button`, not `AlertDialogAction`, so a refusal does not auto-close it and the
 * caller decides what happens next. Long names wrap (`break-words`) and the
 * content scrolls inside the viewport, so nothing clips at 360px.
 */
export function ImpactDialog({
  open,
  onOpenChange,
  title,
  body,
  lines,
  cancel,
  confirm,
  pending,
  isPending,
  variant = "default",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  lines: readonly string[];
  cancel: string;
  confirm: string;
  /** The confirm label while the write is in flight. */
  pending: string;
  isPending: boolean;
  variant?: "default" | "destructive";
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => (isPending ? undefined : onOpenChange(next))}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 break-words">
              <p>{body}</p>
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} className="min-h-11">
            {cancel}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={variant}
            className="min-h-11"
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? pending : confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
