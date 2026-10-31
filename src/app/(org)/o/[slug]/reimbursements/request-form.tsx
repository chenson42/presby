"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import { CHECKBOX_CLASSES, FormField, NativeSelect, fieldA11y } from "@/components/giving/form-field";
import type { ReimbursementActionFailure } from "@/lib/reimbursement/action-result";
import { COPY } from "@/lib/reimbursement/copy";
import { saveRequestAction, submitRequestAction } from "./actions";
import { AmountField } from "./amount-field";
import { BeneficiaryPicker } from "./beneficiary-picker";
import {
  FIELD_ORDER,
  buildSavePayload,
  mapServerFieldErrors,
  validateForDraft,
  validateForSend,
  type FormErrors,
  type PayMode,
  type RequestFormValues,
} from "./request-form-model";
import { RECEIPTS_AVAILABLE, ReceiptSlot, type ReceiptItem } from "./receipt-slot";

/**
 * The request form - `/o/<slug>/reimbursements/new` and `.../<id>/edit`.
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 "Component / Page Plan" and
 * Copy C3. One component for create and edit.
 *
 * ROOT IS `<HydrationGate>` (DECISION-159): a money form whose `defaultValues`
 * react-hook-form would otherwise write over anything typed before the page's
 * JavaScript ran (F116). Both buttons are `type="button"` and the `<form>`'s own
 * submit is swallowed, so pressing Enter in a text box can never Send a request.
 *
 * THE FORM KEEPS EVERYTHING ENTERED when a save fails, whatever the reason: a
 * thrown call, a refused field, a stale revision. Nothing here ever calls
 * `reset()` except after a SUCCESSFUL save (to mark the form clean), and a failure
 * shows its message next to the field it belongs to or in the banner, with the
 * promise in Copy: "Your entries are still here." (`request-form.test.tsx` pins
 * this.)
 *
 * Idempotency: `clientKey` is minted by the page (server) once per page load. The
 * first save creates-or-finds by it; every later save carries the `requestId`
 * and the `revision` the previous save returned, so a double tap or a lost reply
 * can never make a second request. A ref guards the tap itself (state updates are
 * not synchronous), and the buttons are disabled while a save or send is under
 * way.
 *
 * Send = save the entries, then submit on the revision that save returned. If the
 * submit is refused (the server's `incomplete` list) the draft exists and the
 * messages sit next to their fields; a retry edits the same draft.
 *
 * Kind, group and payee FREEZE at the first submission (the database enforces it),
 * so an edit of a sent-back request shows them as text, not controls.
 *
 * Receipts: the label, the "I can't attach a receipt" box and its hint, and the picker
 * (`receipt-slot.tsx`, Batch 2b). An upload or a removal moves the request's revision by
 * one and answers the new one; the slot reports it and this form carries it into the next
 * save. Save and Send are disabled while one is under way.
 */

export interface RequestFormExisting {
  requestId: string;
  revision: number;
  /** `firstSubmittedAt` is set: kind, group and payee are read-only. */
  frozen: boolean;
  groupName: string | null;
  payeeLabel: string | null;
  receipts: ReceiptItem[];
}

export interface RequestFormProps {
  slug: string;
  initialClientKey: string;
  /** The organization's local date, `YYYY-MM-DD`: the date box's latest value. */
  orgToday: string;
  groups: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  canRequestForOthers: boolean;
  initialValues: RequestFormValues;
  /** Present on the edit page. */
  existing?: RequestFormExisting;
  /** Tests turn the picker off; the page never passes it. */
  receiptsAvailable?: boolean;
}

const KIND_OPTIONS: { value: PayMode; label: string; othersOnly?: boolean }[] = [
  { value: "me", label: COPY.form.kindOptions.reimburse },
  { value: "other", label: COPY.form.kindOptions.reimburseOther, othersOnly: true },
  { value: "vendor", label: COPY.form.kindOptions.vendor },
];

export function RequestForm({
  slug,
  initialClientKey,
  orgToday,
  groups,
  categories,
  canRequestForOthers,
  initialValues,
  existing,
  receiptsAvailable = RECEIPTS_AVAILABLE,
}: RequestFormProps) {
  const router = useRouter();
  const form = useForm<RequestFormValues>({ defaultValues: initialValues });
  const {
    register,
    control,
    setValue,
    setError,
    clearErrors,
    getValues,
    reset,
    formState: { errors, isDirty },
  } = form;
  const guard = useUnsavedChangesGuard(isDirty);

  const [pending, setPending] = useState<"save" | "send" | null>(null);
  // True while the receipt slot is uploading or removing: Save and Send wait (an attach moves the revision).
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptItem[]>(existing?.receipts ?? []);
  // A mirror of `saved.current.requestId` for rendering (a ref may not be read during render).
  const [requestId, setRequestId] = useState<string | null>(existing?.requestId ?? null);
  const busy = useRef(false);
  const movedToEdit = useRef(false);
  const saved = useRef<{ requestId: string; revision: number } | null>(
    existing ? { requestId: existing.requestId, revision: existing.revision } : null,
  );

  const mode = useWatch({ control, name: "mode" });
  const beneficiaryId = useWatch({ control, name: "beneficiaryPersonId" });
  const beneficiaryName = useWatch({ control, name: "beneficiaryName" });
  const frozen = existing?.frozen === true;
  const hasCategories = categories.length > 0;
  const editing = existing !== undefined;
  const cancelHref = existing ? `/o/${slug}/reimbursements/${existing.requestId}` : `/o/${slug}/reimbursements`;

  // A field's message goes away the moment that field is touched.
  const reg = (name: keyof RequestFormValues) => register(name, { onChange: () => clearErrors(name) });

  function showErrors(next: FormErrors) {
    const names = FIELD_ORDER.filter((name) => next[name] !== undefined);
    names.forEach((name, index) => setError(name, { type: "server", message: next[name]! }, { shouldFocus: index === 0 }));
  }

  /** Puts a refused action where the person will see it; the entries are untouched. */
  function showFailure(failure: ReimbursementActionFailure) {
    if (failure.kind === "two_factor_required" && failure.redirectTo) {
      router.push(failure.redirectTo);
      return;
    }
    const { errors: fieldErrors, unmapped } = mapServerFieldErrors(failure.fieldErrors);
    if (Object.keys(fieldErrors).length > 0) showErrors(fieldErrors);
    setBanner(unmapped[0] ?? (Object.keys(fieldErrors).length > 0 ? null : failure.error));
  }

  /** Saves the current entries; true when the database now holds them. */
  async function persist(values: RequestFormValues): Promise<boolean> {
    let result: Awaited<ReturnType<typeof saveRequestAction>>;
    try {
      result = await saveRequestAction(
        slug,
        buildSavePayload(values, { clientKey: initialClientKey, saved: saved.current }),
      );
    } catch {
      setBanner(COPY.form.saveFailed);
      return false;
    }
    if (!result.ok) {
      showFailure(result);
      return false;
    }
    saved.current = { requestId: result.data.requestId, revision: result.data.revision };
    setRequestId(result.data.requestId);
    return true;
  }

  /** Runs `work` once at a time; a second tap while one is under way does nothing. */
  async function exclusive(kind: "save" | "send", work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(kind);
    setBanner(null);
    clearErrors();
    try {
      await work();
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function saveDraft() {
    return exclusive("save", async () => {
      const values = getValues();
      const invalid = validateForDraft(values);
      if (Object.keys(invalid).length > 0) return showErrors(invalid);
      if (!(await persist(values))) return;
      reset(values);
      toast.success(COPY.form.draftSaved);
      // A brand-new draft moves to its own address, so a reload edits it
      // instead of starting a second request. The draft may already exist because a
      // receipt was added first (the picker saves it), so this is "not moved yet", not
      // "just created". The move waits for a Save so it never interrupts an upload.
      if (!editing && saved.current && !movedToEdit.current) {
        movedToEdit.current = true;
        router.replace(`/o/${slug}/reimbursements/${saved.current.requestId}/edit`);
      }
    });
  }

  function send() {
    return exclusive("send", async () => {
      const values = getValues();
      const invalid = validateForSend(values, { hasCategories, receiptCount: receipts.length });
      if (Object.keys(invalid).length > 0) return showErrors(invalid);
      if (!(await persist(values))) return;
      const draft = saved.current!;
      let result: Awaited<ReturnType<typeof submitRequestAction>>;
      try {
        result = await submitRequestAction(slug, { requestId: draft.requestId, expectedRevision: draft.revision });
      } catch {
        setBanner(COPY.form.saveFailed);
        return;
      }
      if (!result.ok) {
        showFailure(result);
        return;
      }
      saved.current = { requestId: draft.requestId, revision: result.data.revision };
      reset(values);
      toast.success(result.data.message);
      router.push(`/o/${slug}/reimbursements/${draft.requestId}`);
    });
  }

  /** For the receipt slot: save if needed, hand back the request's id and revision. */
  async function ensureDraft(): Promise<{ requestId: string; revision: number } | null> {
    if (busy.current) return null;
    busy.current = true;
    setPending("save");
    setBanner(null);
    try {
      const values = getValues();
      const invalid = validateForDraft(values);
      if (Object.keys(invalid).length > 0) {
        showErrors(invalid);
        return null;
      }
      if (saved.current === null || isDirty) {
        if (!(await persist(values))) return null;
        reset(values);
      }
      return saved.current;
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  const id = (name: string) => `rf-${name}`;
  const disabled = pending !== null || receiptBusy;
  // No chargeable group (and a request still open to a choice): the select is replaced by a sentence
  // and Send waits for the treasurer to set a group up. Save draft stays available.
  const noChargeableGroup = !frozen && groups.length === 0;
  const modeError = errors.mode?.message;
  const groupError = errors.groupId?.message;
  const categoryError = errors.categoryId?.message;
  const beneficiaryError = errors.beneficiaryPersonId?.message;
  const vendorError = errors.vendorName?.message;
  const amountError = errors.amountDigits?.message;
  const dateError = errors.expenseDate?.message;
  const purposeError = errors.purpose?.message;
  const preApprovedError = errors.preApprovedBy?.message;
  const receiptsError = errors.noReceiptClaimed?.message;

  const kindOptions = KIND_OPTIONS.filter((option) => !option.othersOnly || canRequestForOthers);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{editing ? COPY.form.editHeading : COPY.form.createHeading}</h1>

      <HydrationGate>
        <form
          noValidate
          onSubmit={(e) => e.preventDefault()}
          className="space-y-6"
          aria-busy={pending ? true : undefined}
          data-testid="request-form"
        >
          {banner && (
            <p
              role="alert"
              data-testid="request-form-banner"
              className="rounded-lg border border-border bg-muted p-3 text-base text-foreground"
            >
              {banner}
            </p>
          )}

          {frozen ? (
            <dl className="space-y-3 text-base" data-testid="request-form-frozen">
              <div>
                <dt className="text-sm font-medium">{COPY.detail.labels.payTo}</dt>
                <dd className="[overflow-wrap:anywhere]">{existing?.payeeLabel}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium">{COPY.detail.labels.chargedTo}</dt>
                <dd className="[overflow-wrap:anywhere]">{existing?.groupName}</dd>
              </div>
            </dl>
          ) : (
            <>
              <div>
                <p id={id("mode-label")} className="text-sm font-medium">
                  {COPY.form.kindLabel}
                </p>
                <div role="radiogroup" aria-labelledby={id("mode-label")} className="mt-1 flex flex-col gap-1">
                  {kindOptions.map((option) => (
                    <label key={option.value} className="inline-flex min-h-11 items-center gap-2 text-base">
                      <input type="radio" value={option.value} className={CHECKBOX_CLASSES} {...reg("mode")} />
                      {option.label}
                    </label>
                  ))}
                </div>
                {modeError && (
                  <p role="alert" className="mt-1 text-sm text-destructive">
                    {modeError}
                  </p>
                )}
              </div>

              {noChargeableGroup ? (
                <p className="text-base" data-testid="no-chargeable-group">
                  {COPY.form.noChargeableGroup}
                </p>
              ) : (
                <FormField id={id("group")} label={COPY.form.groupLabel} error={groupError}>
                  <NativeSelect {...fieldA11y(id("group"), groupError)} {...reg("groupId")} className="min-h-11">
                    <option value="">{COPY.form.groupPlaceholder}</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              )}
            </>
          )}

          {hasCategories && (
            <FormField id={id("category")} label={COPY.form.categoryLabel} error={categoryError}>
              <NativeSelect {...fieldA11y(id("category"), categoryError)} {...reg("categoryId")} className="min-h-11">
                <option value="">{COPY.form.categoryPlaceholder}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}

          {!frozen && mode === "other" && (
            <FormField
              id={id("beneficiary")}
              label={COPY.form.beneficiaryLabel}
              hint={COPY.form.beneficiaryHint}
              error={beneficiaryError}
            >
              <Controller
                control={control}
                name="beneficiaryPersonId"
                render={({ field }) => (
                  <BeneficiaryPicker
                    slug={slug}
                    id={id("beneficiary")}
                    inputRef={field.ref}
                    value={beneficiaryId ? { personId: beneficiaryId, name: beneficiaryName } : null}
                    invalid={!!beneficiaryError}
                    describedBy={fieldA11y(id("beneficiary"), beneficiaryError, true)["aria-describedby"]}
                    disabled={disabled}
                    onChange={(next) => {
                      clearErrors("beneficiaryPersonId");
                      field.onChange(next?.personId ?? "");
                      setValue("beneficiaryName", next?.name ?? "", { shouldDirty: true });
                    }}
                  />
                )}
              />
            </FormField>
          )}

          {!frozen && mode === "vendor" && (
            <FormField id={id("vendor")} label={COPY.form.vendorLabel} error={vendorError}>
              <Input
                type="text"
                autoComplete="off"
                className="min-h-11"
                {...fieldA11y(id("vendor"), vendorError)}
                {...reg("vendorName")}
              />
            </FormField>
          )}

          <FormField id={id("amount")} label={COPY.form.amountLabel} error={amountError}>
            <Controller
              control={control}
              name="amountDigits"
              render={({ field }) => (
                <AmountField
                  id={id("amount")}
                  inputRef={field.ref}
                  value={field.value}
                  onChange={(digits) => {
                    clearErrors("amountDigits");
                    field.onChange(digits);
                  }}
                  onBlur={field.onBlur}
                  onRejectedPaste={() => setError("amountDigits", { type: "paste", message: COPY.fieldErrors.amount })}
                  invalid={!!amountError}
                  describedBy={fieldA11y(id("amount"), amountError)["aria-describedby"]}
                />
              )}
            />
          </FormField>

          <FormField id={id("date")} label={COPY.form.dateLabel} error={dateError}>
            <Input
              type="date"
              max={orgToday}
              className="min-h-11 w-full min-w-0"
              {...fieldA11y(id("date"), dateError)}
              {...reg("expenseDate")}
            />
          </FormField>

          <FormField id={id("purpose")} label={COPY.form.purposeLabel} error={purposeError}>
            <Textarea className="min-h-24" {...fieldA11y(id("purpose"), purposeError)} {...reg("purpose")} />
          </FormField>

          <FormField id={id("pre-approver")} label={COPY.form.preApproverLabel} error={preApprovedError}>
            <Input
              type="text"
              autoComplete="off"
              className="min-h-11"
              {...fieldA11y(id("pre-approver"), preApprovedError)}
              {...reg("preApprovedBy")}
            />
          </FormField>

          <section aria-labelledby={id("receipts-label")} data-testid="receipts-section">
            <p id={id("receipts-label")} className="text-sm font-medium">
              {COPY.form.receiptsLabel}
            </p>
            {receiptsAvailable && (
              <>
                <ReceiptSlot
                  slug={slug}
                  requestId={requestId}
                  receipts={receipts}
                  disabled={disabled}
                  error={receiptsError}
                  ensureDraft={ensureDraft}
                  onBusyChange={setReceiptBusy}
                  onChange={(next) => {
                    setReceipts(next.receipts);
                    if (saved.current) saved.current = { requestId: saved.current.requestId, revision: next.revision };
                    clearErrors("noReceiptClaimed");
                  }}
                />
                <p className="mt-1 text-sm text-muted-foreground">{COPY.form.receiptsHint}</p>
              </>
            )}
            <div className="mt-1">
              <label htmlFor={id("no-receipt")} className="inline-flex min-h-11 items-center gap-2 text-base">
                <input
                  type="checkbox"
                  className={`${CHECKBOX_CLASSES} shrink-0`}
                  {...fieldA11y(id("no-receipt"), receiptsError, true)}
                  {...reg("noReceiptClaimed")}
                />
                {COPY.form.noReceiptLabel}
              </label>
              <p id={id("no-receipt-hint")} className="text-sm text-muted-foreground">
                {COPY.form.noReceiptHint}
              </p>
              {receiptsError && (
                <p id={id("no-receipt-error")} role="alert" className="mt-1 text-sm text-destructive">
                  {receiptsError}
                </p>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" className="min-h-11" disabled={disabled || noChargeableGroup} onClick={send} data-testid="request-send">
              {pending === "send" ? COPY.form.sending : COPY.form.send}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={disabled}
              onClick={saveDraft}
              data-testid="request-save-draft"
            >
              {pending === "save" ? COPY.form.saving : COPY.form.saveDraft}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={disabled}
              onClick={() => guard.guardedNavigate(cancelHref)}
              data-testid="request-cancel"
            >
              {COPY.form.cancel}
            </Button>
          </div>
        </form>
      </HydrationGate>

      <UnsavedChangesDialog open={guard.discardOpen} onOpenChange={guard.setDiscardOpen} onConfirmDiscard={guard.confirmDiscard} />
    </div>
  );
}
