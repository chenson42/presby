"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dissolveCommitteeAction } from "@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions";
import { dissolveCarries, TOAST } from "@/lib/committees/copy";
import { parseDissolve } from "@/lib/committees/validate";
import { DISSOLVE } from "@/lib/committees/ui-copy";

/**
 * "Dissolve committee": a date and a confirmation in an `AlertDialog` (plain
 * controlled input, no `useForm`). One-way from this page, and the body says so.
 * A refusal that belongs to the date (a future date, or a date before a member
 * started) shows under the field; anything else is a toast.
 */
export function DissolveDialog({
  slug,
  committeeId,
  committeeName,
  carriedRoleNames,
  today,
}: {
  slug: string;
  committeeId: string;
  committeeName: string;
  carriedRoleNames: readonly string[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dissolvedOn, setDissolvedOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const carries = dissolveCarries(carriedRoleNames);

  async function onConfirm() {
    const parsed = parseDissolve({ dissolvedOn }, { today });
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    setPending(true);
    const result = await dissolveCommitteeAction(slug, { committeeId, dissolvedOn });
    setPending(false);
    if (result.ok) {
      toast.success(TOAST.dissolved);
      setOpen(false);
      router.refresh();
    } else if ((result.kind === "invalid" && result.field) || result.kind === "date_before_start") {
      setError(result.error);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto">
          Dissolve committee
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">{DISSOLVE.title(committeeName)}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{DISSOLVE.body}</p>
              {carries ? <p>{carries}</p> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div>
          <Label htmlFor="dissolve-on">{DISSOLVE.field}</Label>
          <Input
            id="dissolve-on"
            type="date"
            max={today}
            value={dissolvedOn}
            onChange={(e) => setDissolvedOn(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "dissolve-on-error dissolve-on-hint" : "dissolve-on-hint"}
            className="mt-1 min-h-11"
          />
          <p id="dissolve-on-hint" className="mt-1 text-sm text-muted-foreground">
            {DISSOLVE.helper}
          </p>
          {error ? (
            <p id="dissolve-on-error" role="alert" className="mt-1 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel className="min-h-11 w-full sm:w-auto">{DISSOLVE.goBack}</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm} className="min-h-11 w-full sm:w-auto">
            {pending ? "Dissolving…" : DISSOLVE.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
