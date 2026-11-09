import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The few form pieces every worship form repeats: a labelled field with its hint
 * and error wired together (`aria-describedby`), the native `<select>` recipe from
 * docs/ui-standards.md (appearance-none plus a manual chevron, 16px text, the
 * disabled style a `<HydrationGate>` relies on), and the one inline error line.
 * Presentation only - no state, no server import.
 */

export const SELECT_CLASSES =
  "min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

export const INPUT_CLASSES = "min-h-11";

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  /** The control. It should carry `id`, and `aria-describedby` from `describedBy(id, …)`. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The `aria-describedby` value for a `Field` with a hint and/or an error. */
export function describedBy(id: string, parts: { hint?: boolean; error?: boolean }): string | undefined {
  const ids = [parts.hint ? `${id}-hint` : null, parts.error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function SelectBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      {children}
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  );
}

/** A form-level refusal, announced. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-base font-medium text-destructive [overflow-wrap:anywhere]">
      {message}
    </p>
  );
}
