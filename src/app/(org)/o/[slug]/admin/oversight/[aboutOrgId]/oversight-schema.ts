import { z } from "zod";
import { COORDINATE_MESSAGES, parseCoordinateField, validateCoordinatePair } from "@/lib/coordinates";

/**
 * Client-side validation for the oversight edit form — same "not the only
 * gate" discipline `../../credentials/credential-schema.ts` documents; every
 * check here is re-enforced server-side in `src/lib/presbytery.ts`
 * (`setCongregationOversight`).
 *
 * EVERY FIELD IS A PLAIN STRING, not a coerced number — a native HTML form
 * always submits strings, and `edit-form.tsx`'s own `onSubmit` does the
 * string->number/null conversion right before calling the server action
 * (same division of labor `record-appointment-form.tsx` uses for its own
 * optional `minuteReference`), rather than asking zod to coerce an empty
 * string into a number here.
 *
 * COORDINATES go through `src/lib/coordinates.ts` (DECISION-343), the one rule
 * the server write and the map's reader also use: strict decimal text (so "1e5"
 * and "39,9" are "Must be a number"), the two range messages below, and an
 * object-level check for the two pair rules (both or neither; not exactly 0 and
 * 0). The field messages stay byte-identical (the golden test pins them); the
 * pair messages are `COORDINATE_MESSAGES`, the same strings the server returns.
 */
const coordinateText = (min: number, max: number, rangeMessage: string) =>
  z
    .string()
    .refine((v) => parseCoordinateField(v).kind !== "invalid", "Must be a number")
    .refine((v) => {
      const parsed = parseCoordinateField(v);
      return parsed.kind !== "number" || (parsed.value >= min && parsed.value <= max);
    }, rangeMessage);

export const oversightSchema = z
  .object({
    viabilityScore: z.enum(["", "1", "2", "3"]),
    redevelopmentNotes: z.string().max(4000, "Must be 4000 characters or fewer"),
    buildingsNotes: z.string().max(4000, "Must be 4000 characters or fewer"),
    insuranceCarrier: z.string().max(255, "Must be 255 characters or fewer"),
    insuranceExpiresOn: z.string(),
    latitude: coordinateText(-90, 90, "Must be between -90 and 90"),
    longitude: coordinateText(-180, 180, "Must be between -180 and 180"),
  })
  .superRefine((values, ctx) => {
    const lat = parseCoordinateField(values.latitude);
    const lng = parseCoordinateField(values.longitude);
    // A field that is not a number, or is out of range, already has its own
    // message; the pair rules apply only to two individually valid fields.
    if (lat.kind === "invalid" || lng.kind === "invalid") return;
    const result = validateCoordinatePair(
      lat.kind === "number" ? lat.value : null,
      lng.kind === "number" ? lng.value : null,
    );
    if (result.ok) return;
    if (result.message === COORDINATE_MESSAGES.halfSet || result.message === COORDINATE_MESSAGES.zeroZero) {
      ctx.addIssue({ code: "custom", path: [result.field], message: result.message });
    }
  });
export type OversightFormValues = z.infer<typeof oversightSchema>;
