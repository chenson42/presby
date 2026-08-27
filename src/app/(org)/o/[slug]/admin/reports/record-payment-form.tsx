"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import type { PerCapitaRecordRow } from "@/lib/presbytery";
import {
  recordPaymentSchema,
  type RecordPaymentFormValues,
} from "./per-capita-schema";
import { recordPerCapitaPaymentAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Records a payment against ONE existing per-capita record —
 *  `paidStatus` is derived server-side from `paidAmount` vs. the record's
 *  own frozen `amountOwed` (`src/lib/presbytery.ts`'s
 *  `recordPerCapitaPayment()` header); this form never submits a status. */
export function RecordPaymentForm({
  slug,
  records,
}: {
  slug: string;
  records: PerCapitaRecordRow[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<RecordPaymentFormValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      recordId: records[0]?.recordId ?? "",
      paidAmount: "",
      paidAt: "",
    },
  });

  const {
    register,
    formState: { errors },
  } = form;

  if (records.length === 0) {
    return null;
  }

  async function onSubmit(values: RecordPaymentFormValues) {
    setSubmitting(true);
    const result = await recordPerCapitaPaymentAction(slug, values.recordId, {
      paidAmount: values.paidAmount,
      paidAt: values.paidAt,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Payment recorded.");
      form.reset({ recordId: values.recordId, paidAmount: "", paidAt: "" });
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
      <div>
        <Label htmlFor="payment-record">
          Congregation
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="payment-record"
            className={SELECT_CLASSES}
            aria-required="true"
            {...register("recordId")}
          >
            {records.map((record) => (
              <option key={record.recordId} value={record.recordId}>
                {record.name} (${record.amountOwed} owed, {record.paidStatus})
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        {errors.recordId && (
          <p className="mt-1 text-sm text-destructive">{errors.recordId.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="payment-amount">
            Amount paid
            <RequiredMark />
          </Label>
          <Input
            id="payment-amount"
            type="number"
            step="0.01"
            min={0}
            aria-required="true"
            className="mt-1"
            {...register("paidAmount")}
          />
          {errors.paidAmount && (
            <p className="mt-1 text-sm text-destructive">{errors.paidAmount.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="payment-date">
            Payment date
            <RequiredMark />
          </Label>
          <Input
            id="payment-date"
            type="date"
            aria-required="true"
            className="mt-1"
            {...register("paidAt")}
          />
          {errors.paidAt && (
            <p className="mt-1 text-sm text-destructive">{errors.paidAt.message}</p>
          )}
        </div>
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Recording…" : "Record payment"}
      </Button>
    </form>
  );
}
