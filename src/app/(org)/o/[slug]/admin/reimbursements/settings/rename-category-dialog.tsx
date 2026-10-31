"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, fieldA11y } from "@/components/giving/form-field";
import { COPY } from "@/lib/reimbursement/copy";
import { MAX_LENGTH } from "@/lib/reimbursement/limits";
import { cleanText, textLength } from "@/lib/reimbursement/text";
import { saveCategoryAction } from "../actions";

/**
 * `Rename` (Copy C9): a dialog titled with the word, the field `Name` holding the
 * current name, and `Rename` / `Cancel`. A `useForm` root, so it renders
 * `<HydrationGate>` (DECISION-159). The sort order is left as it is
 * (`sortOrder` is not sent). A category that has gone since the page loaded gets
 * `That category isn't in the list any more. Reload the page to see the current
 * list.` and the page re-reads; the name stays in the box through any other
 * failure.
 */

interface Values {
  name: string;
}

export function RenameCategoryDialog({
  slug,
  categoryId,
  currentName,
  describedBy,
}: {
  slug: string;
  categoryId: string;
  currentName: string;
  /** The id of the element that names the row, so the button reads "Rename <name>" without a new string. */
  describedBy: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const busy = useRef(false);
  const form = useForm<Values>({ defaultValues: { name: currentName } });
  const {
    register,
    setError,
    clearErrors,
    getValues,
    reset,
    formState: { errors },
  } = form;
  const triggerId = `rename-${categoryId}`;

  function close() {
    setOpen(false);
    reset({ name: currentName });
    setBanner(null);
  }

  async function submit() {
    if (busy.current) return;
    clearErrors();
    setBanner(null);
    const name = cleanText(getValues().name);
    if (name === null || textLength(name) > MAX_LENGTH.category) {
      setError("name", { type: "length", message: COPY.settings.categoryNameInvalid }, { shouldFocus: true });
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const result = await saveCategoryAction(slug, { categoryId, name: getValues().name });
      if (result.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      const message = result.fieldErrors?.name;
      if (message) {
        setError("name", { type: "server", message }, { shouldFocus: true });
        return;
      }
      if (result.error === COPY.settings.categoryGone) {
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

  const error = errors.name?.message;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : !pending && close())}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          id={triggerId}
          aria-labelledby={`${triggerId} ${describedBy}`}
          data-testid="rename-open"
        >
          {COPY.settings.rename}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{COPY.settings.rename}</DialogTitle>
        </DialogHeader>
        <HydrationGate>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="space-y-4"
            data-testid="rename-form"
          >
            {banner && (
              <p role="alert" className="rounded-lg border border-border bg-muted p-3 text-base">
                {banner}
              </p>
            )}
            <FormField id={`${triggerId}-name`} label={COPY.settings.categoryName} error={error}>
              <Input
                className="min-h-11"
                autoComplete="off"
                {...fieldA11y(`${triggerId}-name`, error)}
                {...register("name", { onChange: () => clearErrors("name") })}
              />
            </FormField>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={close}>
                {COPY.decision.cancel}
              </Button>
              <Button type="submit" className="min-h-11" disabled={pending} data-testid="rename-confirm">
                {COPY.settings.rename}
              </Button>
            </DialogFooter>
          </form>
        </HydrationGate>
      </DialogContent>
    </Dialog>
  );
}
