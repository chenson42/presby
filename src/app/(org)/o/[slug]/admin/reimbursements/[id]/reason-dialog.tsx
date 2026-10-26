"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HydrationGate } from "@/components/shared/hydration-gate";
import type { ReimbursementActionResult } from "@/lib/reimbursement/action-result";
import { COPY } from "@/lib/reimbursement/copy";
import { cleanText, textLength } from "@/lib/reimbursement/text";
import { failureNeedsReload } from "../../../reimbursements/decision-feedback";

/**
 * One dialog for every treasurer verb that asks for a line of text: Reverse
 * payment (`Reason`, required), Void request (`Reason`, required), Send back to
 * requester (`Reason (the requester will see this)`, required), Waive receipt
 * (`Note (optional)`) and Add a note (`Note`, required). docs/work-log/
 * 2026-10-25-treasury-inc1.md, Copy C8 and the Batch 4 amendment (S1, S4).
 * Strings come from the caller, which takes them from `COPY`; this file types none.
 *
 * A `useForm` root, so it renders `<HydrationGate>` (DECISION-159) - the dialog's
 * content is created when its button is pressed, which is after hydration, so
 * the gate costs nothing and `check:hydration-gate` holds every form to one rule.
 *
 * The text is judged after cleaning (a reason of only spaces is missing) and is
 * at most `maxLength` characters; the server's message for the field lands under
 * the box. The text stays in the box through ANY failure, and `reset` runs only
 * after success. A refusal that means "what you were looking at is no longer
 * true" (changed, already decided, not available) toasts, closes and re-reads the
 * page; any other refusal stays inside the dialog next to what was typed. The
 * confirm button is the same words as the trigger (Copy names no other).
 */

export interface ReasonDialogProps {
  triggerLabel: string;
  title: string;
  body?: string;
  fieldLabel: string;
  /** The key the server's `fieldErrors` uses for the text. */
  fieldName: "reason" | "note";
  hint?: string;
  required: boolean;
  requiredMessage: string;
  maxLength: number;
  confirmLabel: string;
  /** Prefix for `data-testid`s: `<id>-open`, `<id>-field`, `<id>-confirm`. */
  testId: string;
  submit: (text: string) => Promise<ReimbursementActionResult<{ message: string }>>;
}

interface Values {
  text: string;
}

export function ReasonDialog({
  triggerLabel,
  title,
  body,
  fieldLabel,
  fieldName,
  hint,
  required,
  requiredMessage,
  maxLength,
  confirmLabel,
  testId,
  submit,
}: ReasonDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const busy = useRef(false);
  const form = useForm<Values>({ defaultValues: { text: "" } });
  const {
    register,
    setError,
    clearErrors,
    getValues,
    reset,
    formState: { errors },
  } = form;
  const fieldId = `${testId}-text`;

  function close() {
    setOpen(false);
    reset({ text: "" });
    setBanner(null);
  }

  async function confirm() {
    if (busy.current) return;
    const raw = getValues().text;
    clearErrors();
    setBanner(null);
    const cleaned = cleanText(raw);
    if (required && cleaned === null) {
      setError("text", { type: "required", message: requiredMessage }, { shouldFocus: true });
      return;
    }
    if (cleaned !== null && textLength(cleaned) > maxLength) {
      setError("text", { type: "length", message: COPY.fieldErrors.tooLong(maxLength) }, { shouldFocus: true });
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const result = await submit(raw);
      if (result.ok) {
        toast.success(result.data.message);
        close();
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      const fieldMessage = result.fieldErrors?.[fieldName];
      if (fieldMessage) {
        setError("text", { type: "server", message: fieldMessage }, { shouldFocus: true });
        return;
      }
      if (failureNeedsReload(result)) {
        toast.error(result.error);
        close();
        router.refresh();
        return;
      }
      setBanner(result.error);
    } catch {
      setBanner(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const error = errors.text?.message;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : !pending && close())}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" data-testid={`${testId}-open`}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent {...(body ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body && <DialogDescription>{body}</DialogDescription>}
        </DialogHeader>
        <HydrationGate>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
            className="space-y-4"
            data-testid={`${testId}-form`}
          >
            {banner && (
              <p role="alert" className="rounded-lg border border-border bg-muted p-3 text-base" data-testid={`${testId}-banner`}>
                {banner}
              </p>
            )}
            <div>
              <Label htmlFor={fieldId}>{fieldLabel}</Label>
              <Textarea
                id={fieldId}
                className="mt-1 min-h-24"
                aria-invalid={error ? true : undefined}
                aria-describedby={[error ? `${fieldId}-error` : null, hint ? `${fieldId}-hint` : null].filter(Boolean).join(" ") || undefined}
                data-testid={`${testId}-field`}
                {...register("text", { onChange: () => clearErrors("text") })}
              />
              {hint && (
                <p id={`${fieldId}-hint`} className="mt-1 text-sm text-muted-foreground">
                  {hint}
                </p>
              )}
              {error && (
                <p id={`${fieldId}-error`} role="alert" className="mt-1 text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={close}>
                {COPY.decision.cancel}
              </Button>
              <Button type="submit" className="min-h-11" disabled={pending} data-testid={`${testId}-confirm`}>
                {confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        </HydrationGate>
      </DialogContent>
    </Dialog>
  );
}
