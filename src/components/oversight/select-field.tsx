import { ChevronDown } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { FormField, fieldAria } from "./form-field";
import { SELECT_CLASSES } from "./select-classes";

/** A registered native `<select>` with a chevron and an empty first option ("Not recorded" for an optional fact). */
export function SelectField({
  id,
  label,
  hint,
  error,
  registration,
  options,
  emptyLabel,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: UseFormRegisterReturn;
  options: ReadonlyArray<{ value: string; label: string }>;
  emptyLabel: string;
  disabled?: boolean;
}) {
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <select id={id} className={SELECT_CLASSES} disabled={disabled} {...fieldAria(id, { hint: !!hint, error })} {...registration}>
          <option value="">{emptyLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
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
