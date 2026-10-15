import { ChevronDown } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import type { EventTypePickerOption } from "@/lib/events";

// Type-only import above: `@/lib/events` is server-only and must never be
// bundled into the client forms that render this picker.

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The event forms' type picker: a native `<select>` (ui-standards) whose first
 * option, `"none"`, means "no type" - the event then shows as the
 * organization's default type. `selectProps` is the `register("eventTypeId")`
 * spread, so the form stays inside its HydrationGate.
 *
 * Renders nothing when there is nothing to choose (a congregation that has
 * only the default type).
 */
export function EventTypePicker({
  id,
  selectProps,
  options,
  fallbackName,
}: {
  id: string;
  selectProps: UseFormRegisterReturn;
  options: readonly EventTypePickerOption[];
  fallbackName: string | null;
}) {
  if (options.length === 0) return null;

  return (
    <div>
      <Label htmlFor={id}>Event type (optional)</Label>
      <div className="relative mt-1">
        <select id={id} aria-describedby={`${id}-hint`} className={SELECT_CLASSES} {...selectProps}>
          <option value="none">
            {fallbackName ? `No type (shown as ${fallbackName})` : "No type"}
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.isRetired ? `${option.name} (retired)` : option.name}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
      <p id={`${id}-hint`} className="mt-1 text-sm text-muted-foreground">
        Colors the event on the calendar.
      </p>
    </div>
  );
}
