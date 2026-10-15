import {
  Backpack,
  Baby,
  BookOpen,
  CalendarDays,
  Church,
  Coffee,
  Gavel,
  HandHeart,
  HandHelping,
  HeartHandshake,
  Mic,
  Music,
  Sparkles,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_EVENT_TYPE_ICON,
  isEventTypeIcon,
  type EventTypeIcon as EventTypeIconKey,
} from "@/lib/events/type-palette";

/**
 * A static import map, so a misspelled icon name fails `tsc` rather than
 * rendering nothing (DECISION-161). It takes the KEY and never a component:
 * icon components must not cross the server -> client boundary
 * (`portal-nav.tsx` records a real 500 from doing so).
 */
const ICONS: Record<EventTypeIconKey, LucideIcon> = {
  Church,
  Sparkles,
  Music,
  BookOpen,
  Backpack,
  Utensils,
  HeartHandshake,
  Gavel,
  CalendarDays,
  HandHeart,
  HandHelping,
  Users,
  Coffee,
  Baby,
  Mic,
};

/**
 * The glyph beside an event type's name. Always `aria-hidden`: the visible
 * (or screen-reader) type name carries the meaning, never the icon alone.
 * Unknown or missing keys degrade to the calendar icon.
 */
export function EventTypeIcon({
  iconKey,
  className,
}: {
  iconKey: string | null | undefined;
  className?: string;
}) {
  const Icon = isEventTypeIcon(iconKey) ? ICONS[iconKey] : ICONS[DEFAULT_EVENT_TYPE_ICON];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", className)} />;
}
