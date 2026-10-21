"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useHydrated } from "./use-hydrated";

/**
 * One box per digit for a short numeric code (a TOTP code). UI only (Phase 2
 * R1): no server action, no auth import, no recovery-code mode. The caller owns
 * the value, the submit button and the error text.
 *
 * Contract (Phase 2 R2, DECISION-192/193):
 *  - ONE source of truth: the joined value travels in exactly one hidden
 *    `<input name={name}>`. The visible boxes carry no `name`, so neither a
 *    native submit nor a browser's form autosave ever sees six fields or a
 *    partial code.
 *  - `autoFocus` (default false) focuses box 1 in an effect once the page has
 *    hydrated, never through the HTML `autoFocus` attribute: a disabled
 *    HydrationGate fieldset cannot take focus.
 *  - Every consumer renders `<HydrationGate>` (rule H3 of
 *    `npm run check:hydration-gate`).
 *  - Boxes are `type="text"` (not `number`: that strips leading zeros and adds
 *    spinners) with `inputMode="numeric"` and `autoComplete="one-time-code"` on
 *    box 1, and no `maxLength`, so an autofill or paste that delivers several
 *    characters can land in the first box and be spread across the rest.
 *  - Nothing is validated only here. The server action stays the authority.
 *
 * The group is a `role="group"` named by the visible label, never a
 * `<fieldset>`/`<legend>` (HydrationGate forbids a legend).
 */
export interface OneTimeCodeInputProps {
  /** `name` of the ONE hidden input carrying the joined value. The boxes carry no `name`. */
  name: string;
  /** Visible label; also names the `role="group"` through `aria-labelledby`. */
  label: string;
  /** Controlled. Digits only, length <= `length`. A cleared middle box yields a value shorter than `length`. */
  value: string;
  onValueChange: (next: string) => void;
  length?: number;
  /** Focus box 1 after hydration. Off by default (a form below other content must not scroll the page). */
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Id of the error or hint element, set as `aria-describedby` on every box. */
  describedBy?: string;
  /** Fires on a user edit that leaves the code complete and changed. Never on mount; never submits. */
  onComplete?: (code: string) => void;
  /** Base id; defaults to a generated one. */
  id?: string;
  className?: string;
}

/** ASCII digits only, after NFKC so full-width digits (as some IMEs and autofill emit) count. */
function toDigits(raw: string): string {
  return raw.normalize("NFKC").replace(/[^0-9]/g, "");
}

function toSlots(value: string, length: number): string[] {
  const digits = toDigits(value).slice(0, length);
  return Array.from({ length }, (_, i) => digits[i] ?? "");
}

export function OneTimeCodeInput({
  name,
  label,
  value,
  onValueChange,
  length = 6,
  autoFocus = false,
  disabled = false,
  invalid = false,
  describedBy,
  onComplete,
  id,
  className,
}: OneTimeCodeInputProps) {
  const generatedId = useId();
  const baseId = id ?? `otc-${generatedId.replace(/:/g, "")}`;
  const labelId = `${baseId}-label`;
  const boxId = (i: number) => `${baseId}-${i + 1}`;

  const hydrated = useHydrated();
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const didAutoFocus = useRef(false);

  // The boxes hold per-slot state because a cleared middle box is a hole that
  // the joined `value` cannot represent. A change of `value` that did not come
  // from here (the parent clearing the field) resets the slots (derived state,
  // set during render rather than in an effect).
  const [slots, setSlots] = useState<string[]>(() => toSlots(value, length));
  if (slots.join("") !== toSlots(value, length).join("")) {
    setSlots(toSlots(value, length));
  }

  useEffect(() => {
    if (autoFocus && hydrated && !didAutoFocus.current) {
      didAutoFocus.current = true;
      boxes.current[0]?.focus();
    }
  }, [autoFocus, hydrated]);

  function focusBox(i: number) {
    const clamped = Math.max(0, Math.min(length - 1, i));
    boxes.current[clamped]?.focus();
  }

  /** Applies an edit: stores the slots, reports the joined value, reports completion. */
  function commit(next: string[]) {
    const before = slots.join("");
    const joined = next.join("");
    setSlots(next);
    if (joined === before) return;
    onValueChange(joined);
    if (joined.length === length) onComplete?.(joined);
  }

  /** Writes `digits` from box `start`, advancing; a full-length run always starts at box 1. */
  function spread(digits: string, start: number) {
    const next = [...slots];
    let from = start;
    let run = digits;
    if (run.length >= length) {
      run = run.slice(0, length);
      from = 0;
    }
    for (let k = 0; k < run.length && from + k < length; k++) {
      next[from + k] = run[k]!;
    }
    commit(next);
    const firstEmpty = next.findIndex((s) => s === "");
    focusBox(firstEmpty === -1 ? length - 1 : firstEmpty);
  }

  function handleChange(i: number, raw: string) {
    // Cleared by select-all-and-delete, a cut, or a keyboard that reports the
    // delete only as an input event.
    if (raw === "") {
      const next = [...slots];
      next[i] = "";
      commit(next);
      return;
    }
    const digits = toDigits(raw);
    // Not a digit: ignore. The state is unchanged, so React restores the box.
    if (digits.length === 0) return;

    const prev = slots[i] ?? "";
    // Overtype: the box held a digit and the keystroke landed beside it. The
    // newly typed digit wins.
    if (prev !== "" && digits.length === 2) {
      const typed = digits.replace(prev, "")[0] ?? prev;
      const next = [...slots];
      next[i] = typed;
      commit(next);
      if (i < length - 1) focusBox(i + 1);
      return;
    }
    if (digits.length === 1) {
      const next = [...slots];
      next[i] = digits;
      commit(next);
      if (i < length - 1) focusBox(i + 1);
      return;
    }
    // Several characters: iOS or Android one-time-code autofill, a keyboard
    // suggestion, or a drop.
    spread(digits, i);
  }

  function handlePaste(i: number, e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const digits = toDigits(e.clipboardData.getData("text"));
    if (digits.length === 0) return;
    spread(digits, i);
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "Backspace":
      case "Delete": {
        // Delete mirrors Backspace on purpose (operator: "delete key should
        // work across boxes"): a filled box is cleared in place, an empty box
        // steps back and clears the previous one.
        e.preventDefault();
        const next = [...slots];
        if (next[i] !== "") {
          next[i] = "";
          commit(next);
        } else if (i > 0) {
          next[i - 1] = "";
          commit(next);
          focusBox(i - 1);
        }
        return;
      }
      case "ArrowLeft":
        e.preventDefault();
        focusBox(i - 1);
        return;
      case "ArrowRight":
        e.preventDefault();
        focusBox(i + 1);
        return;
      case "Home":
        e.preventDefault();
        focusBox(0);
        return;
      case "End":
        e.preventDefault();
        focusBox(length - 1);
        return;
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Label id={labelId} htmlFor={boxId(0)}>
        {label}
      </Label>
      <div
        role="group"
        aria-labelledby={labelId}
        // The boxes grow from 44px to 48px to fill the row, and never shrink
        // below 44px: 6 x 44px + 5 x 6px = 294px fits both /totp's 312px content
        // width at 360px and /account/2fa's 296px (page padding p-8). Below that
        // (200% zoom) the row wraps rather than shrinking the boxes.
        className="flex flex-wrap gap-1.5"
      >
        {slots.map((digit, i) => (
          <Input
            key={i}
            id={boxId(i)}
            ref={(el) => {
              boxes.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={`Digit ${i + 1} of ${length}`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.currentTarget.select()}
            // Size lives here, once (Phase 2 R3), not at each call site. `text-xl`
            // is the `section` type-scale role: the largest that fits a 44px box
            // without crowding the glyph. `px-0` because the box is narrower than
            // the primitive's `px-3`.
            className="h-12 min-w-11 max-w-12 flex-1 px-0 text-center text-xl font-medium tabular-nums"
          />
        ))}
      </div>
      <input type="hidden" name={name} value={slots.join("")} />
    </div>
  );
}
