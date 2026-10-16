"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConnectionRates } from "@/lib/giving/connection-input";
import { RATES_COPY } from "@/lib/giving/giving-copy";
import {
  formatBpsAsPercent,
  formatCentsAsDollars,
  parseDollarsToCents,
  parsePercentToBps,
} from "@/lib/giving/rates-format";
import { updateRatesAction } from "./connect/actions";

/**
 * Edit the processor's fee rates (G21). A treasurer types percent and dollars
 * ("2.9", "0.30"); the form converts to the schema's basis points and cents
 * (`rates-format.ts`, exact string arithmetic) and sends them to
 * `updateRatesAction`, whose zod schema and the database CHECKs are the real
 * bounds. Plain controlled state (four short fields), rendered inside the
 * panel's `<HydrationGate>`. Per-field errors use `aria-invalid` and
 * `aria-describedby`.
 */

type FieldKey = keyof ConnectionRates;

const FIELDS: Array<{ key: FieldKey; label: string; hint: string; kind: "percent" | "dollars" }> = [
  { key: "cardFeeBps", label: RATES_COPY.cardPercent, hint: "Between 0 and 10 percent.", kind: "percent" },
  { key: "cardFeeFixedCents", label: RATES_COPY.cardFixed, hint: "Between 0.00 and 1.00.", kind: "dollars" },
  { key: "achFeeBps", label: RATES_COPY.achPercent, hint: "Between 0 and 5 percent.", kind: "percent" },
  { key: "achFeeCapCents", label: RATES_COPY.achCap, hint: "Between 0.00 and 20.00.", kind: "dollars" },
];

function initial(rates: ConnectionRates): Record<FieldKey, string> {
  return {
    cardFeeBps: formatBpsAsPercent(rates.cardFeeBps),
    cardFeeFixedCents: formatCentsAsDollars(rates.cardFeeFixedCents),
    achFeeBps: formatBpsAsPercent(rates.achFeeBps),
    achFeeCapCents: formatCentsAsDollars(rates.achFeeCapCents),
  };
}

export function RatesForm({ slug, rates, onDone }: { slug: string; rates: ConnectionRates; onDone: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState(() => initial(rates));
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Partial<Record<FieldKey, string>> = {};
    const parsed = {} as Record<FieldKey, number>;
    for (const field of FIELDS) {
      const n = field.kind === "percent" ? parsePercentToBps(values[field.key]) : parseDollarsToCents(values[field.key]);
      if (n === null) next[field.key] = `${field.label}: enter a number like ${field.kind === "percent" ? "2.9" : "0.30"}.`;
      else parsed[field.key] = n;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    const result = await updateRatesAction(slug, parsed);
    setPending(false);
    if (result.ok) {
      toast.success(RATES_COPY.saved);
      router.refresh();
      onDone();
      return;
    }
    if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
      return;
    }
    if (result.fieldErrors) {
      setErrors(Object.fromEntries(Object.entries(result.fieldErrors).filter(([k]) => FIELDS.some((f) => f.key === k))) as Partial<Record<FieldKey, string>>);
    }
    toast.error(result.error);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h4 className="text-base font-medium">{RATES_COPY.heading}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{RATES_COPY.help}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const id = `rate-${field.key}`;
          const error = errors[field.key];
          return (
            <div key={field.key} className="space-y-1">
              <Label htmlFor={id}>{field.label}</Label>
              <Input
                id={id}
                inputMode="decimal"
                value={values[field.key]}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
              />
              <p id={`${id}-hint`} className="text-sm text-muted-foreground">
                {field.hint}
              </p>
              {error && (
                <p id={`${id}-error`} className="text-sm font-medium text-destructive">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : RATES_COPY.save}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
