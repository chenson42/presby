import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Layout helpers shared by the giving admin forms (docs/ui-standards.md: every
 * input has a real <label>; an error carries `aria-invalid` on the control and
 * an `id`'d message the control points at with `aria-describedby`).
 *
 * `FormField` renders the label, an optional hint, the control and the error.
 * The caller passes the control's `aria-*` props from `fieldA11y()` so the
 * wiring lives in one place. Server-renderable (no hooks).
 */

export function fieldA11y(id: string, error: string | undefined, hasHint = false) {
  const describedBy = [error ? `${id}-error` : null, hasHint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": describedBy || undefined,
  };
}

export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}
        {required && <span aria-hidden> *</span>}
      </Label>
      <div className="mt-1">{children}</div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The native `<select>` pattern from docs/ui-standards.md (Select & Combobox
 * Patterns): `appearance-none` plus a manual chevron, `border-input`, 16 px
 * text, `disabled:` styles for the HydrationGate. Registered with
 * react-hook-form (`{...register("x")}`), never controlled.
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(SELECT_CLASSES, className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

/** A checkbox with its label, 44 px tall (touch target), for forms under HydrationGate. */
export function CheckboxField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
        {children}
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export const CHECKBOX_CLASSES =
  "size-5 rounded border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
