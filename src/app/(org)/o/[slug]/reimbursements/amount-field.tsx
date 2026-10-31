"use client";

import type { ClipboardEvent, ChangeEvent, FocusEvent, MouseEvent, Ref } from "react";
import { Input } from "@/components/ui/input";
import { digitsToCents, formatMoney, pastedAmountToCents } from "@/lib/reimbursement/amount-input";
import { MAX_AMOUNT_CENTS } from "@/lib/reimbursement/limits";

/**
 * The amount control - docs/work-log/2026-10-25-treasury-inc1.md, P3-10 and EC3.
 *
 * A DIGIT-ENTRY control: typing 1, 2, 5, 0 reads $12.50 (the value the form holds
 * is the digit string "1250", i.e. integer cents). There is no decimal point to
 * mistype and nothing is ever rounded. A pasted value never goes through the
 * digit path (pasting "12.345" there would read $123.45): it is parsed strictly
 * by `pastedAmountToCents` and either read EXACTLY or refused, in which case the
 * field is left as it was and `onRejectedPaste` lets the form show the amount
 * error. More digits than any legal amount has are ignored, not wrapped.
 *
 * `value` is the digit string (no leading zeros) or "" for nothing entered. The
 * display is `formatMoney(cents)`. `inputMode="numeric"` raises the phone's digit
 * pad; the caret is kept at the end because the control is append-only in spirit.
 */

const MAX_DIGITS = String(MAX_AMOUNT_CENTS).length;

/** Digits from whatever the box holds now, leading zeros dropped; null when there are too many. */
export function normalizeDigits(text: string): string | null {
  const digits = text.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length > MAX_DIGITS) return null;
  return digits;
}

export function centsToDigits(cents: number | null | undefined): string {
  return cents === null || cents === undefined || cents <= 0 ? "" : String(cents);
}

export function AmountField({
  id,
  value,
  onChange,
  onBlur,
  onRejectedPaste,
  invalid,
  describedBy,
  inputRef,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (digits: string) => void;
  onBlur?: () => void;
  onRejectedPaste?: () => void;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
}) {
  const cents = digitsToCents(value);
  const shown = value === "" || cents === null ? "" : formatMoney(cents);

  function toEnd(el: HTMLInputElement) {
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = normalizeDigits(e.target.value);
    if (next === null) return; // too many digits: keep what was there
    onChange(next);
    toEnd(e.target);
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    const text = e.clipboardData.getData("text");
    const pasted = pastedAmountToCents(text);
    if (pasted === null || pasted > MAX_AMOUNT_CENTS) {
      onRejectedPaste?.();
      return;
    }
    onChange(pasted === 0 ? "" : String(pasted));
    toEnd(el);
  }

  return (
    <Input
      id={id}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={formatMoney(0)}
      className="min-h-11"
      value={shown}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={handleChange}
      onPaste={handlePaste}
      onFocus={(e: FocusEvent<HTMLInputElement>) => toEnd(e.currentTarget)}
      onClick={(e: MouseEvent<HTMLInputElement>) => toEnd(e.currentTarget)}
      onBlur={onBlur}
    />
  );
}
