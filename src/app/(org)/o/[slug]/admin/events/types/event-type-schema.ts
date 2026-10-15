import { z } from "zod";
import { isEventTypeColor, isEventTypeIcon } from "@/lib/events/type-palette";

/**
 * Client-side validation for the event-type manager's add / edit form. NOT the
 * only gate: the same rules are re-enforced in `src/lib/event-types.ts`, which
 * also owns the checks a form cannot make (duplicate names, the default type's
 * neutral colour). This only blocks an obviously-bad submit before a round trip.
 */
export const EVENT_TYPE_NAME_MAX = 60;

export const eventTypeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(EVENT_TYPE_NAME_MAX, `Use ${EVENT_TYPE_NAME_MAX} characters or fewer`),
  color: z.string().refine((value): boolean => isEventTypeColor(value), "Choose a color."),
  icon: z.string().refine((value): boolean => isEventTypeIcon(value), "Choose an icon."),
});
export type EventTypeFormValues = z.infer<typeof eventTypeFormSchema>;
