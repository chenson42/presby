"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, NativeSelect, fieldA11y } from "@/components/giving/form-field";
import { COPY } from "@/lib/reimbursement/copy";
import { isRealIsoDate } from "@/lib/reimbursement/dates";
import { MAX_LENGTH } from "@/lib/reimbursement/limits";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/reimbursement/treasury-input";
import { cleanText, textLength } from "@/lib/reimbursement/text";
import { recordPaymentAction } from "../actions";

/**
 * "Record payment" - docs/work-log/2026-10-25-treasury-inc1.md, Copy C8 and the
 * Batch 4 amendment (S1). A `useForm` root, so it renders `<HydrationGate>`
 * (DECISION-159): a method or date picked before hydration would otherwise be
 * overwritten by the defaults, and this is the form that writes a payment.
 *
 * `How was it paid?` (Check, ACH, Cash, Other), `Check number` (required for a
 * check) or `Reference (optional)`, `Date paid`, `Note (optional)`, the hint
 * that PresbyPortal records the payment and does not send money. The payer is
 * the signed-in user and is never a field. The page only renders this form when
 * `treasuryUi` says the click can succeed; the definer re-checks everything
 * (the approver, the requester side, the receipt), so a refusal comes back as a
 * sentence in the banner above the form and what was typed stays.
 *
 * Dates: the box is the browser's own date control, `max` the organization's
 * local today and `min` the expense date; the same two bounds are checked here
 * before the call (and by the definer after it) with ONE sentence, because the
 * database's `date_out_of_range` covers both.
 */

interface Values {
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  note: string;
}

export function PaymentForm({
  slug,
  requestId,
  orgToday,
  expenseDate,
}: {
  slug: string;
  requestId: string;
  /** The organization's local date, `YYYY-MM-DD`: the date box's default and latest value. */
  orgToday: string;
  /** `YYYY-MM-DD`: the earliest date a payment can carry. */
  expenseDate: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const busy = useRef(false);
  const form = useForm<Values>({ defaultValues: { method: "check", reference: "", paidOn: orgToday, note: "" } });
  const {
    register,
    control,
    setError,
    clearErrors,
    getValues,
    formState: { errors },
  } = form;
  const method = useWatch({ control, name: "method" });

  async function submit() {
    if (busy.current) return;
    const values = getValues();
    clearErrors();
    setBanner(null);

    const reference = cleanText(values.reference);
    if (values.method === "check" && reference === null) {
      setError("reference", { type: "required", message: COPY.treasury.results.checkNumberRequired }, { shouldFocus: true });
      return;
    }
    if (reference !== null && textLength(reference) > MAX_LENGTH.reference) {
      setError("reference", { type: "length", message: COPY.fieldErrors.tooLong(MAX_LENGTH.reference) }, { shouldFocus: true });
      return;
    }
    if (
      !isRealIsoDate(values.paidOn) ||
      values.paidOn > orgToday ||
      (expenseDate !== null && values.paidOn < expenseDate)
    ) {
      setError("paidOn", { type: "range", message: COPY.treasury.results.dateOutOfRange }, { shouldFocus: true });
      return;
    }
    const note = cleanText(values.note);
    if (note !== null && textLength(note) > MAX_LENGTH.paymentNote) {
      setError("note", { type: "length", message: COPY.fieldErrors.tooLong(MAX_LENGTH.paymentNote) }, { shouldFocus: true });
      return;
    }

    busy.current = true;
    setPending(true);
    try {
      const result = await recordPaymentAction(slug, {
        requestId,
        method: values.method,
        reference: values.reference,
        paidOn: values.paidOn,
        note: values.note,
      });
      if (result.ok) {
        toast.success(result.data.message);
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      let placed = false;
      for (const key of ["reference", "paidOn", "note"] as const) {
        const message = result.fieldErrors?.[key];
        if (message) {
          setError(key, { type: "server", message }, { shouldFocus: !placed });
          placed = true;
        }
      }
      if (!placed) setBanner(result.error);
      if (result.kind === "not_found") router.refresh();
    } catch {
      setBanner(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const referenceError = errors.reference?.message;
  const dateError = errors.paidOn?.message;
  const noteError = errors.note?.message;

  return (
    <HydrationGate>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
        aria-busy={pending ? true : undefined}
        data-testid="payment-form"
      >
        {banner && (
          <p role="alert" data-testid="payment-form-banner" className="rounded-lg border border-border bg-muted p-3 text-base">
            {banner}
          </p>
        )}
        <FormField id="pay-method" label={COPY.treasury.paymentForm.methodLabel}>
          <NativeSelect className="min-h-11" {...fieldA11y("pay-method", undefined)} {...register("method")}>
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {COPY.treasury.paymentForm.methods[value]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          id="pay-reference"
          label={method === "check" ? COPY.treasury.paymentForm.checkNumber : COPY.treasury.paymentForm.reference}
          error={referenceError}
        >
          <Input
            className="min-h-11"
            autoComplete="off"
            {...fieldA11y("pay-reference", referenceError)}
            {...register("reference", { onChange: () => clearErrors("reference") })}
          />
        </FormField>
        <FormField id="pay-date" label={COPY.treasury.paymentForm.datePaid} error={dateError}>
          <Input
            type="date"
            className="min-h-11"
            max={orgToday}
            min={expenseDate ?? undefined}
            {...fieldA11y("pay-date", dateError)}
            {...register("paidOn", { onChange: () => clearErrors("paidOn") })}
          />
        </FormField>
        <FormField id="pay-note" label={COPY.treasury.paymentForm.note} error={noteError}>
          <Textarea
            className="min-h-20"
            {...fieldA11y("pay-note", noteError)}
            {...register("note", { onChange: () => clearErrors("note") })}
          />
        </FormField>
        <p className="text-sm text-muted-foreground">{COPY.treasury.paymentForm.hint}</p>
        <Button type="submit" className="min-h-11" disabled={pending} data-testid="payment-submit">
          {COPY.treasury.paymentForm.submit}
        </Button>
      </form>
    </HydrationGate>
  );
}
