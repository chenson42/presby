import { cn } from "@/lib/utils";
import { typeColorClasses } from "@/lib/events/type-palette";
import { EventTypeIcon } from "./event-type-icon";

/**
 * An inline pill naming an event type: its icon and its visible name on the
 * category tint, with an ink border. Colour never carries the meaning alone.
 */
export function EventTypeChip({
  name,
  colorToken,
  iconKey,
  className,
}: {
  name: string;
  colorToken: string | null | undefined;
  iconKey: string | null | undefined;
  className?: string;
}) {
  const classes = typeColorClasses(colorToken);
  return (
    <span
      className={cn(
        // ui-ok: a static, non-interactive type label whose colours come from the category tokens, not a Badge variant
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium",
        classes.chip,
        classes.border,
        className,
      )}
    >
      <EventTypeIcon iconKey={iconKey} />
      <span>{name}</span>
    </span>
  );
}
