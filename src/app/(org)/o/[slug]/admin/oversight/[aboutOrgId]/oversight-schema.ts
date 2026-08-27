import { z } from "zod";

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
 */
const optionalFloatString = z
  .string()
  .refine((v) => v === "" || Number.isFinite(Number(v)), "Must be a number");

export const oversightSchema = z.object({
  viabilityScore: z.enum(["", "1", "2", "3"]),
  redevelopmentNotes: z.string().max(4000, "Must be 4000 characters or fewer"),
  buildingsNotes: z.string().max(4000, "Must be 4000 characters or fewer"),
  insuranceCarrier: z.string().max(255, "Must be 255 characters or fewer"),
  insuranceExpiresOn: z.string(),
  latitude: optionalFloatString.refine(
    (v) => v === "" || (Number(v) >= -90 && Number(v) <= 90),
    "Must be between -90 and 90",
  ),
  longitude: optionalFloatString.refine(
    (v) => v === "" || (Number(v) >= -180 && Number(v) <= 180),
    "Must be between -180 and 180",
  ),
});
export type OversightFormValues = z.infer<typeof oversightSchema>;
