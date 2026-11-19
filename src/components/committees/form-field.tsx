import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** `aria-invalid` and `aria-describedby` for a control: its hint and its error, by the ids `FormField` gives them. */
export function fieldAria(id: string, parts: { hint?: boolean; error?: string }) {
  const describedBy = [parts.hint ? `${id}-hint` : null, parts.error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    "aria-invalid": parts.error ? (true as const) : undefined,
    "aria-describedby": describedBy || undefined,
  };
}

/** A label, the control, an optional hint under it and the field's own error under that. */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1">{children}</div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
