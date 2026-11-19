import type { UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldAria } from "./form-field";

/**
 * A labelled text control: a one-line input, a textarea (`rows`) or a native date
 * picker (`type="date"`, whose value is still the `YYYY-MM-DD` text). Never a
 * number input (`boundaries.test.ts`).
 */
export function TextField({
  id,
  label,
  hint,
  error,
  registration,
  rows,
  type = "text",
  min,
  max,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: UseFormRegisterReturn;
  rows?: number;
  type?: "text" | "date";
  min?: string;
  max?: string;
}) {
  const aria = fieldAria(id, { hint: !!hint, error });
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      {rows ? (
        <Textarea id={id} rows={rows} autoComplete="off" {...aria} {...registration} />
      ) : (
        <Input id={id} type={type} min={min} max={max} autoComplete="off" className="min-h-11" {...aria} {...registration} />
      )}
    </FormField>
  );
}
