import { ChevronDown } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { FormField, fieldAria } from "./form-field";
import { SELECT_CLASSES } from "./select-classes";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A registered native `<select>` with a chevron. `emptyLabel` adds a first option with the empty value. */
export function SelectField({
  id,
  label,
  hint,
  error,
  registration,
  options,
  emptyLabel,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: UseFormRegisterReturn;
  options: readonly SelectOption[];
  emptyLabel?: string;
}) {
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <select id={id} className={SELECT_CLASSES} {...fieldAria(id, { hint: !!hint, error })} {...registration}>
          {emptyLabel ? <option value="">{emptyLabel}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
    </FormField>
  );
}
