import Link from "next/link";
import { MapPin } from "lucide-react";
import { EventTypeIcon } from "@/components/org-portal/event-types/event-type-icon";
import type { CalendarEntry } from "@/lib/calendar";
import { formatTime, formatTimeRange } from "@/lib/calendar/wall-clock";
import { typeColorClasses } from "@/lib/events/type-palette";
import { cn } from "@/lib/utils";

/**
 * One event on the calendar - a link to its detail page, carrying `?from=` set
 * to the canonical href of the DISPLAYED month / filter / view so Back returns
 * to exactly where the member was. The type is shown as icon + a coloured
 * chip + a 4px ink rule, and always named (visibly in the list, for screen
 * readers in the grid) so colour never carries meaning alone.
 */
export function CalendarEntryLink({
  slug,
  entry,
  fromHref,
  variant,
}: {
  slug: string;
  entry: CalendarEntry;
  fromHref: string;
  variant: "grid" | "list";
}) {
  const classes = typeColorClasses(entry.eventType?.colorToken);
  const typeName = entry.eventType?.name ?? null;
  const href = `/o/${slug}/calendar/${entry.id}?from=${encodeURIComponent(fromHref)}`;
  const focus =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  if (variant === "grid") {
    return (
      <Link
        href={href}
        data-testid="calendar-entry"
        className={cn(
          "block rounded-md border border-transparent border-l-4 px-1.5 py-1 text-sm leading-snug hover:brightness-95",
          classes.chip,
          classes.rule,
          focus,
        )}
      >
        <span className="flex items-start gap-1">
          <EventTypeIcon iconKey={entry.eventType?.iconKey} className="mt-0.5 size-3.5" />
          <span className="min-w-0">
            <span className="whitespace-nowrap font-medium">{formatTime(entry.startsAtWallClock)}</span>{" "}
            <span className="break-words">{entry.title}</span>
            {typeName && <span className="sr-only">, {typeName}</span>}
          </span>
        </span>
        {entry.location && <span className="block break-words text-sm">{entry.location}</span>}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      data-testid="calendar-entry"
      className={cn(
        "block min-h-11 rounded-md border border-transparent border-l-4 px-3 py-2 text-base hover:brightness-95",
        classes.chip,
        classes.rule,
        focus,
      )}
    >
      <span className="flex items-start gap-2">
        <EventTypeIcon iconKey={entry.eventType?.iconKey} className="mt-1" />
        <span className="min-w-0">
          <span className="block">
            <span className="font-medium">
              {formatTimeRange(entry.startsAtWallClock, entry.endsAtWallClock)}
            </span>{" "}
            <span className="break-words">{entry.title}</span>
          </span>
          {entry.location && (
            <span className="mt-0.5 flex items-center gap-1 text-sm">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="break-words">{entry.location}</span>
            </span>
          )}
          {typeName && <span className="mt-0.5 block text-sm">{typeName}</span>}
        </span>
      </span>
    </Link>
  );
}
