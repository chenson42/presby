import type { UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldAria } from "./form-field";

/**
 * A labelled text control. Always `type="text"` (or a textarea): a number input
 * drops pasted text and rounds money, so money and years are text with an
 * `inputMode` (pinned by `boundaries.test.ts`).
 */
export function TextField({
  id,
  label,
  hint,
  error,
  registration,
  inputMode,
  autoComplete = "off",
  rows,
  type = "text",
  readOnly,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: UseFormRegisterReturn;
  inputMode?: "text" | "numeric" | "decimal" | "tel";
  autoComplete?: string;
  /** Set to render a textarea of this many rows. */
  rows?: number;
  /** "date" for a native date picker (the value is still the `YYYY-MM-DD` text). */
  type?: "text" | "date";
  readOnly?: boolean;
}) {
  const aria = fieldAria(id, { hint: !!hint, error });
  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      {rows ? (
        <Textarea id={id} rows={rows} autoComplete={autoComplete} {...aria} {...registration} />
      ) : (
        <Input
          id={id}
          type={type}
          readOnly={readOnly}
          inputMode={inputMode}
          autoComplete={autoComplete}
          spellCheck={inputMode === "text" || inputMode === undefined ? undefined : false}
          className={readOnly ? "min-h-11 bg-muted" : "min-h-11"}
          {...aria}
          {...registration}
        />
      )}
    </FormField>
  );
}
