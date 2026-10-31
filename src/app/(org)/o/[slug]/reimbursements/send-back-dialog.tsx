"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { CHECKBOX_CLASSES } from "@/components/giving/form-field";
import { COPY } from "@/lib/reimbursement/copy";
import { MAX_LENGTH } from "@/lib/reimbursement/limits";
import { cleanText, textLength } from "@/lib/reimbursement/text";
import { returnRequestAction } from "./actions";
import { failureNeedsReload } from "./decision-feedback";

/**
 * "Send this request back?" - the approver's other choice. docs/work-log/
 * 2026-10-25-treasury-inc1.md, Copy C6: a radio (`Needs changes`, which the
 * requester can fix and resend, or `Not approved`, which ends the request unless
 * the requester withdraws it), a required reason the requester will read, and
 * `Send back` / `Cancel`.
 *
 * A `useForm` root, so it renders `<HydrationGate>` (DECISION-159) even though it
 * mounts only after the page has hydrated: the dialog content is created when
 * the button is pressed, which is also why the gate costs nothing here and why
 * `check:hydration-gate` can hold every form to one rule.
 *
 * The reason is judged after cleaning (a reason of only spaces is missing) and is
 * at most 300 characters; the server's field message lands under the box. The
 * reason stays in the box through any failure. The revision is the one the page
 * displayed.
 */

type Kind = "needs_info" | "not_approved";
interface Values {
  kind: Kind;
  reason: string;
}

export function SendBackDialog({ slug, requestId, revision }: { slug: string; requestId: string; revision: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const busy = useRef(false);
  const form = useForm<Values>({ defaultValues: { kind: "needs_info", reason: "" } });
  const {
    register,
    setError,
    clearErrors,
    getValues,
    reset,
    formState: { errors },
  } = form;

  function close() {
    setOpen(false);
    reset({ kind: "needs_info", reason: "" });
    setBanner(null);
  }

  async function submit() {
    if (busy.current) return;
    const values = getValues();
    clearErrors();
    setBanner(null);
    const reason = cleanText(values.reason);
    if (reason === null) {
      setError("reason", { type: "required", message: COPY.decision.reasonRequired }, { shouldFocus: true });
      return;
    }
    if (textLength(reason) > MAX_LENGTH.reason) {
      setError("reason", { type: "length", message: COPY.fieldErrors.tooLong(MAX_LENGTH.reason) }, { shouldFocus: true });
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const result = await returnRequestAction(slug, {
        requestId,
        expectedRevision: revision,
        kind: values.kind,
        reason: values.reason,
      });
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
      if (result.fieldErrors?.reason) {
        setError("reason", { type: "server", message: result.fieldErrors.reason }, { shouldFocus: true });
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

  const reasonError = errors.reason?.message;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : !pending && close())}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" data-testid="send-back-open">
          {COPY.decision.sendBackButton}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{COPY.decision.sendBackTitle}</DialogTitle>
        </DialogHeader>
        <HydrationGate>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="space-y-4"
            data-testid="send-back-form"
          >
            {banner && (
              <p role="alert" className="rounded-lg border border-border bg-muted p-3 text-base">
                {banner}
              </p>
            )}
            <div role="radiogroup" aria-label={COPY.decision.sendBackTitle} className="space-y-2">
              <label className="flex min-h-11 items-start gap-2 text-base">
                <input type="radio" value="needs_info" className={`${CHECKBOX_CLASSES} mt-1 shrink-0`} {...register("kind")} />
                <span>
                  {COPY.decision.needsChanges}
                  <span className="block text-sm text-muted-foreground">{COPY.decision.needsChangesHint}</span>
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-2 text-base">
                <input type="radio" value="not_approved" className={`${CHECKBOX_CLASSES} mt-1 shrink-0`} {...register("kind")} />
                <span>
                  {COPY.decision.notApproved}
                  <span className="block text-sm text-muted-foreground">{COPY.decision.notApprovedHint}</span>
                </span>
              </label>
            </div>
            <div>
              <Label htmlFor="send-back-reason">{COPY.decision.reasonLabel}</Label>
              <Textarea
                id="send-back-reason"
                className="mt-1 min-h-24"
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={reasonError ? "send-back-reason-error" : undefined}
                {...register("reason", { onChange: () => clearErrors("reason") })}
              />
              {reasonError && (
                <p id="send-back-reason-error" role="alert" className="mt-1 text-sm text-destructive">
                  {reasonError}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={close}>
                {COPY.decision.cancel}
              </Button>
              <Button type="submit" className="min-h-11" disabled={pending} data-testid="send-back-confirm">
                {COPY.decision.sendBackConfirm}
              </Button>
            </DialogFooter>
          </form>
        </HydrationGate>
      </DialogContent>
    </Dialog>
  );
}
