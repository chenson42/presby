"use client";

import { useState } from "react";
import { useFieldArray, useWatch, type FieldValues, type UseFormReturn } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EMAIL_SUBTYPE_LABELS,
  EMAIL_SUBTYPES,
  MAX_ACTIVE_EMAILS,
} from "@/lib/contact-methods/normalize";
import type { ActiveEmailRow } from "@/lib/contact-methods/types";
import {
  blankEmailRow,
  describeRemoval,
  effectiveMainIndex,
  type EmailsFormShape,
} from "./email-addresses-form";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";
const CHOICE_CLASSES =
  "h-4 w-4 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The address list editor (DECISION-216, Batch 3): ONE `useFieldArray` over
 * `contact.emails`, hosted INSIDE the host form's own gated root (the edit
 * page, the Add person wizard, the staff quick-add). It owns no `<form>`, no
 * `useForm` and no second `HydrationGate`, so the host's gate covers it, and it
 * renders no `<legend>` (a disabled fieldset's first legend is not disabled).
 *
 * Each address is a stacked card, single column at every width: a heading with
 * its badges and Remove, the address, a label select, the Main radio and the
 * "Don't send" box, every control at least 44px tall.
 *
 * Which row is Main is derived (`effectiveMainIndex`), because when the Main
 * row is removed the form deliberately sends NO main and the server promotes
 * the oldest remaining address and reports it ("Now the main address"). The
 * Remove dialog tells the administrator which address that will be.
 *
 * Removing a SAVED address opens an AlertDialog (Rule 2); removing one that
 * was only typed in this session just drops the row.
 */
export function EmailAddressesEditor<TForm extends FieldValues & EmailsFormShape>({
  form,
  idPrefix,
  personName = "this person",
  savedRows = [],
}: {
  form: UseFormReturn<TForm>;
  /** Unique per host form, so two editors on a page never share ids. */
  idPrefix: string;
  /** For the Remove dialog's sentences. */
  personName?: string;
  /** The rows the page loaded, in canonical order (empty for a new person). */
  savedRows?: readonly ActiveEmailRow[];
}) {
  // The generic only proves the host form contains `contact.emails`; the
  // path-typed helpers need the concrete shape.
  const f = form as unknown as UseFormReturn<EmailsFormShape>;
  const { control, register, setValue } = f;
  const { fields, append, remove } = useFieldArray({
    control,
    name: "contact.emails",
    keyName: "fieldKey",
  });
  const watched = useWatch({ control, name: "contact.emails" });
  // `useWatch` is undefined for a render before registration; `fields` has the same length.
  const rows = fields.map((field, index) => ({ ...field, ...(watched?.[index] ?? {}) }));
  const mainIndex = effectiveMainIndex(rows);
  const errors = f.formState.errors.contact?.emails;

  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  const atCap = rows.length >= MAX_ACTIVE_EMAILS;
  const groupId = `${idPrefix}-emails`;

  function setMain(index: number) {
    rows.forEach((_, i) =>
      setValue(`contact.emails.${i}.isPrimary`, i === index, { shouldDirty: true }),
    );
  }

  function requestRemove(index: number) {
    if (rows[index]?.id) setRemoveIndex(index);
    else remove(index);
  }

  const removal =
    removeIndex !== null && rows[removeIndex]
      ? describeRemoval(rows, removeIndex, savedRows, personName)
      : null;

  return (
    <div role="group" aria-labelledby={`${groupId}-heading`} className="space-y-3">
      <div>
        <h3 id={`${groupId}-heading`} className="text-base font-medium">
          Email addresses
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Members see the main address in the directory, plus the Work address of a staff member who is
          listed there. Both are hidden if this person hides their email.
        </p>
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No email address on file.</p>
      )}

      <ul className="space-y-3">
        {fields.map((field, index) => {
          const row = rows[index]!;
          const rowId = `${groupId}-${index}`;
          const error = errors?.[index]?.value?.message;
          const isMain = index === mainIndex;
          return (
            <li key={field.fieldKey} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{`Address ${index + 1}`}</span>
                  {isMain && <Badge variant="secondary">Main</Badge>}
                  {row.doNotContact && <Badge variant="outline">Don&apos;t send</Badge>}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 min-w-11"
                  aria-label={`Remove email address ${index + 1}`}
                  onClick={() => requestRemove(index)}
                >
                  Remove
                </Button>
              </div>

              <div>
                <Label htmlFor={`${rowId}-value`}>Email address</Label>
                <Input
                  id={`${rowId}-value`}
                  // type="text" + inputMode, not type="email": the browser's own
                  // validation would pre-empt the inline messages (and trim silently).
                  type="text"
                  inputMode="email"
                  autoComplete="off"
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={error ? `${rowId}-error` : undefined}
                  className="mt-1 min-h-11"
                  {...register(`contact.emails.${index}.value`)}
                />
                {error && (
                  <p id={`${rowId}-error`} className="mt-1 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor={`${rowId}-subtype`}>Label</Label>
                <div className="relative mt-1">
                  <select
                    id={`${rowId}-subtype`}
                    className={SELECT_CLASSES}
                    {...register(`contact.emails.${index}.subtype`)}
                  >
                    <option value="">No label</option>
                    {EMAIL_SUBTYPES.map((subtype) => (
                      <option key={subtype} value={subtype}>
                        {EMAIL_SUBTYPE_LABELS[subtype]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                </div>
              </div>

              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${groupId}-main`}
                  className={CHOICE_CLASSES}
                  checked={isMain}
                  onChange={() => setMain(index)}
                />
                Main address
              </label>

              <div>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className={CHOICE_CLASSES}
                    aria-describedby={`${rowId}-dnc-hint`}
                    {...register(`contact.emails.${index}.doNotContact`)}
                  />
                  Don&apos;t send mail to this address
                </label>
                <p id={`${rowId}-dnc-hint`} className="pl-6 text-sm text-muted-foreground">
                  Routine mail skips this address. An invitation to it asks for an extra confirmation.
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={atCap}
          onClick={() => append(blankEmailRow(rows.length === 0 || mainIndex === -1))}
        >
          {rows.length === 0 ? "Add an email address" : "Add another email address"}
        </Button>
        {atCap && (
          <p className="mt-1 text-sm text-muted-foreground">
            A person can have up to {MAX_ACTIVE_EMAILS} email addresses.
          </p>
        )}
      </div>

      <AlertDialog
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveIndex(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this email address?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {removal?.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              onClick={() => {
                if (removeIndex !== null) remove(removeIndex);
                setRemoveIndex(null);
              }}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
