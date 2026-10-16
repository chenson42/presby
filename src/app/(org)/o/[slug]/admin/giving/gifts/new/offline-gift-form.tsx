"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, NativeSelect, fieldA11y } from "@/components/giving/form-field";
import { formatCents, parseAmountToCents } from "@/lib/giving/money";
import {
  OFFLINE_METHODS,
  OFFLINE_METHOD_LABELS,
  offlineGiftSchema,
} from "@/lib/giving/gift-input";
import {
  giftFieldName,
  giftFormToInput,
  type DonorMode,
  type GiftFormValues,
} from "@/lib/giving/gift-form-mapping";
import { zodFieldErrors } from "@/lib/giving/field-errors";
import { recordOfflineGiftAction, type RecordGiftOutcome } from "../actions";
import { DonorPicker } from "./donor-picker";

/**
 * The offline-gift form - docs/work-log/2026-10-15-online-giving.md, Flow 8.
 * React Hook Form over the SAME `offlineGiftSchema` the server action parses
 * (a custom resolver runs it over `giftFormToInput(values)` and maps each issue
 * back to its flat field), wrapped in `<HydrationGate>` (DECISION-159): the
 * amount, fund, date and method controls and Save are inoperable until the page
 * has hydrated, because react-hook-form writes `defaultValues` over the live DOM
 * when it attaches and a pre-hydration pick of a non-default fund would
 * otherwise be silently lost (F116).
 *
 * The form states the deductibility rule in words: record only the deductible
 * amount. Two SOFT warnings come back from the server without blocking:
 *   - a possible DUPLICATE GIFT (same donor, date, amount, check number),
 *   - a new donor whose name or email matches an existing one,
 * each rendered inline with a one-tap "record it anyway" that re-submits with
 * `acknowledgeDuplicate`. After a successful save the form clears the donor,
 * amount and check/stock fields but KEEPS the fund, date and method, because a
 * treasurer entering a stack of checks keeps the same ones for the whole stack.
 */

export interface GiftFormFund {
  id: string;
  name: string;
}

function emptyValues(base: { fundId: string; occurredOn: string; method: GiftFormValues["method"] }): GiftFormValues {
  return {
    donorMode: "existing",
    donorId: "",
    newName: "",
    newEmail: "",
    newAddressLine1: "",
    newCity: "",
    newRegion: "",
    newPostalCode: "",
    fundId: base.fundId,
    occurredOn: base.occurredOn,
    method: base.method,
    amount: "",
    checkNumber: "",
    stockDescription: "",
    stockQuantity: "",
    memo: "",
  };
}

const resolver: Resolver<GiftFormValues> = async (values) => {
  const parsed = offlineGiftSchema.safeParse(giftFormToInput(values));
  if (parsed.success) return { values, errors: {} };
  const errors: Record<string, { type: string; message: string }> = {};
  for (const [path, message] of Object.entries(zodFieldErrors(parsed.error))) {
    const field = giftFieldName(path);
    if (!(field in errors)) errors[field] = { type: "validation", message };
  }
  return { values: {}, errors };
};

type Warning =
  | { kind: "duplicate_gift"; giftId: string }
  | { kind: "duplicate_donor"; donors: Array<{ id: string; displayName: string }> }
  | null;

export function OfflineGiftForm({
  slug,
  funds,
  today,
}: {
  slug: string;
  funds: GiftFormFund[];
  /** The organization's local date, 'YYYY-MM-DD'. */
  today: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [chosen, setChosen] = useState<{ id: string; displayName: string } | null>(null);
  const [warning, setWarning] = useState<Warning>(null);
  const [lastRecorded, setLastRecorded] = useState<{ giftId: string; text: string } | null>(null);

  const form = useForm<GiftFormValues>({
    resolver,
    defaultValues: emptyValues({ fundId: funds[0]?.id ?? "", occurredOn: today, method: "cash" }),
  });
  const {
    register,
    control,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = form;

  const formError = (errors as Record<string, { message?: string } | undefined>)["_form"]?.message;
  const donorMode = useWatch({ control, name: "donorMode" });
  const method = useWatch({ control, name: "method" });
  const amountText = useWatch({ control, name: "amount" });
  const parsedAmount = parseAmountToCents(amountText ?? "", "offline");

  function chooseDonor(donor: { id: string; displayName: string } | null) {
    setChosen(donor);
    setValue("donorId", donor?.id ?? "", { shouldValidate: Boolean(donor) });
    if (donor) clearErrors("donorId");
  }

  async function submit(acknowledgeDuplicate: boolean) {
    const values = form.getValues();
    setSubmitting(true);
    const result = await recordOfflineGiftAction(slug, giftFormToInput(values, acknowledgeDuplicate));
    setSubmitting(false);

    if (!result.ok) {
      if (result.kind === "two_factor_required" && result.redirectTo) {
        window.location.assign(result.redirectTo);
        return;
      }
      for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
        setError(giftFieldName(path) as keyof GiftFormValues, { message });
      }
      toast.error(result.error);
      return;
    }

    const outcome = result.data as RecordGiftOutcome;
    if (outcome.status === "duplicate_gift") {
      setWarning({ kind: "duplicate_gift", giftId: outcome.giftId });
      return;
    }
    if (outcome.status === "duplicate_donor") {
      setWarning({ kind: "duplicate_donor", donors: outcome.donors });
      return;
    }

    setWarning(null);
    const donorLabel =
      values.donorMode === "existing"
        ? (chosen?.displayName ?? "the donor")
        : values.donorMode === "new"
          ? values.newName.trim()
          : "an unidentified donor";
    const cents = parseAmountToCents(values.amount, "offline");
    setLastRecorded({
      giftId: outcome.giftId,
      text: `Recorded ${cents.ok ? formatCents(cents.cents) : "the gift"} from ${donorLabel}.`,
    });
    toast.success("Gift recorded.");
    setChosen(null);
    form.reset(emptyValues({ fundId: values.fundId, occurredOn: values.occurredOn, method: values.method }));
    router.refresh();
  }

  const modeLabel: Record<DonorMode, string> = {
    existing: "Someone in our records",
    new: "A new donor",
    unidentified: "Unidentified (plate offering)",
  };

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(() => submit(false))} className="space-y-6" noValidate>
        <p className="rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
          Record only the deductible amount. Dinners, raffles and purchases are not gifts.
        </p>

        {lastRecorded && (
          <p role="status" className="rounded-lg border border-border p-3 text-sm" data-testid="gift-recorded">
            {lastRecorded.text}{" "}
            <Link
              href={`/o/${slug}/admin/giving/gifts/${lastRecorded.giftId}`}
              className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              View it
            </Link>
          </p>
        )}

        {/* -- donor -------------------------------------------------------- */}
        <div className="space-y-3">
          <p id="donor-mode-label" className="text-sm font-medium">
            Who gave it?
          </p>
          <div role="radiogroup" aria-labelledby="donor-mode-label" className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            {(Object.keys(modeLabel) as DonorMode[]).map((mode) => (
              <label key={mode} className="inline-flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  value={mode}
                  className="size-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  {...register("donorMode", {
                    onChange: () => {
                      setWarning(null);
                      clearErrors();
                    },
                  })}
                />
                {modeLabel[mode]}
              </label>
            ))}
          </div>

          {donorMode === "existing" && (
            <FormField id="gift-donor-search" label="Find the donor" required error={errors.donorId?.message}>
              <DonorPicker
                slug={slug}
                inputId="gift-donor-search"
                value={chosen}
                onChange={chooseDonor}
                invalid={Boolean(errors.donorId)}
                describedBy={errors.donorId ? "gift-donor-search-error" : undefined}
              />
            </FormField>
          )}

          {donorMode === "new" && (
            <div className="space-y-4 rounded-lg border border-border p-4">
              <FormField id="gift-new-name" label="Name" required error={errors.newName?.message}>
                <Input type="text" autoComplete="off" {...fieldA11y("gift-new-name", errors.newName?.message)} {...register("newName")} />
              </FormField>
              <FormField
                id="gift-new-email"
                label="Email (optional)"
                hint="Used to suggest a link to a member, and for their statement."
                error={errors.newEmail?.message}
              >
                <Input
                  type="email"
                  autoComplete="off"
                  inputMode="email"
                  {...fieldA11y("gift-new-email", errors.newEmail?.message, true)}
                  {...register("newEmail")}
                />
              </FormField>
              <FormField id="gift-new-address" label="Street address (optional)" error={errors.newAddressLine1?.message}>
                <Input type="text" autoComplete="off" {...fieldA11y("gift-new-address", errors.newAddressLine1?.message)} {...register("newAddressLine1")} />
              </FormField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField id="gift-new-city" label="City" error={errors.newCity?.message}>
                  <Input type="text" autoComplete="off" {...fieldA11y("gift-new-city", errors.newCity?.message)} {...register("newCity")} />
                </FormField>
                <FormField id="gift-new-region" label="State" error={errors.newRegion?.message}>
                  <Input type="text" autoComplete="off" {...fieldA11y("gift-new-region", errors.newRegion?.message)} {...register("newRegion")} />
                </FormField>
                <FormField id="gift-new-zip" label="ZIP" error={errors.newPostalCode?.message}>
                  <Input type="text" autoComplete="off" inputMode="numeric" {...fieldA11y("gift-new-zip", errors.newPostalCode?.message)} {...register("newPostalCode")} />
                </FormField>
              </div>
            </div>
          )}

          {donorMode === "unidentified" && (
            <p className="text-sm text-muted-foreground">
              Cash from the offering plate with no name on it. It is counted in your totals but can
              never receive a year-end statement.
            </p>
          )}

          {warning?.kind === "duplicate_donor" && (
            <div role="alert" className="space-y-3 rounded-lg border border-border bg-muted p-4" data-testid="duplicate-donor-warning">
              <p className="text-sm font-medium">Someone with that name or email is already in your records.</p>
              <ul className="space-y-2">
                {warning.donors.map((donor) => (
                  <li key={donor.id}>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full justify-start"
                      onClick={() => {
                        setValue("donorMode", "existing");
                        chooseDonor({ id: donor.id, displayName: donor.displayName });
                        setWarning(null);
                      }}
                    >
                      Use {donor.displayName}
                    </Button>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" className="min-h-11" disabled={submitting} onClick={() => submit(true)}>
                This is a different person. Add them anyway
              </Button>
            </div>
          )}
        </div>

        {/* -- the gift ---------------------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id="gift-fund" label="Fund" required error={errors.fundId?.message}>
            <NativeSelect {...fieldA11y("gift-fund", errors.fundId?.message)} {...register("fundId")}>
              {funds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField id="gift-date" label="Date received" required error={errors.occurredOn?.message}>
            <Input type="date" max={today} {...fieldA11y("gift-date", errors.occurredOn?.message)} {...register("occurredOn")} />
          </FormField>

          <FormField id="gift-method" label="How was it given?" required error={errors.method?.message}>
            <NativeSelect {...fieldA11y("gift-method", errors.method?.message)} {...register("method")}>
              {OFFLINE_METHODS.map((value) => (
                <option key={value} value={value}>
                  {OFFLINE_METHOD_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField
            id="gift-amount"
            label="Amount (US dollars)"
            required
            hint={parsedAmount.ok ? `Recording ${formatCents(parsedAmount.cents)}` : "For example, 125 or 125.50"}
            error={errors.amount?.message}
          >
            <Input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              {...fieldA11y("gift-amount", errors.amount?.message, true)}
              {...register("amount")}
            />
          </FormField>
        </div>

        {method === "check" && (
          <FormField id="gift-check" label="Check number (optional)" error={errors.checkNumber?.message}>
            <Input type="text" autoComplete="off" {...fieldA11y("gift-check", errors.checkNumber?.message)} {...register("checkNumber")} />
          </FormField>
        )}

        {method === "stock" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id="gift-stock"
              label="What was given"
              required
              hint="For example, 20 shares of an index fund."
              error={errors.stockDescription?.message}
            >
              <Input type="text" autoComplete="off" {...fieldA11y("gift-stock", errors.stockDescription?.message, true)} {...register("stockDescription")} />
            </FormField>
            <FormField id="gift-shares" label="Number of shares (optional)" error={errors.stockQuantity?.message}>
              <Input type="text" inputMode="decimal" autoComplete="off" {...fieldA11y("gift-shares", errors.stockQuantity?.message)} {...register("stockQuantity")} />
            </FormField>
          </div>
        )}

        <FormField id="gift-memo" label="Note (optional)" hint="For your own records." error={errors.memo?.message}>
          <Textarea rows={2} {...fieldA11y("gift-memo", errors.memo?.message, true)} {...register("memo")} />
        </FormField>

        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}

        {warning?.kind === "duplicate_gift" && (
          <div role="alert" className="space-y-3 rounded-lg border border-border bg-muted p-4" data-testid="duplicate-gift-warning">
            <p className="text-sm font-medium">
              This looks like a gift you already recorded: same donor, date and amount.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="min-h-11">
                <Link href={`/o/${slug}/admin/giving/gifts/${warning.giftId}`} target="_blank" rel="noreferrer">
                  View the earlier gift
                </Link>
              </Button>
              <Button type="button" className="min-h-11" disabled={submitting} onClick={() => submit(true)}>
                This is a different gift. Record it anyway
              </Button>
            </div>
          </div>
        )}

        <Button type="submit" className="min-h-11" disabled={submitting}>
          {submitting ? "Recording…" : "Record gift"}
        </Button>
      </form>
    </HydrationGate>
  );
}
