import { z } from "zod";

/**
 * Client-side validation for the "Record statistics" entry form
 * (Increment 3b) — same "not the only gate" discipline every other schema
 * file under `(org)` documents; every check here is re-enforced
 * server-side in `src/lib/presbytery.ts` (`setCongregationStatistics`).
 *
 * Every numeric field is a plain string (a native `<input type="number">`
 * always submits one) — `statistics-form.tsx`'s own `onSubmit` converts
 * empty strings to `undefined` and numeric strings to numbers right before
 * calling the server action, same division of labor
 * `../oversight/[aboutOrgId]/oversight-schema.ts` uses.
 */
const optionalNonnegIntString = z
  .string()
  .refine((v) => v === "" || /^\d+$/.test(v), "Must be a non-negative whole number");

export const statisticsSchema = z.object({
  aboutOrgId: z.string().min(1, "Choose a congregation"),
  year: z.string().refine((v) => /^\d{4}$/.test(v), "Enter a 4-digit year"),
  minuteReference: z.string().max(500, "Must be 500 characters or fewer"),
  endingActive: optionalNonnegIntString,
  endingBaptized: optionalNonnegIntString,
  endingAffiliate: optionalNonnegIntString,
  endingOtherParticipants: optionalNonnegIntString,
  gainsProfessionsUnder18: optionalNonnegIntString,
  gainsProfessions18Plus: optionalNonnegIntString,
  gainsCertificate: optionalNonnegIntString,
  gainsOther: optionalNonnegIntString,
  lossesCertificate: optionalNonnegIntString,
  lossesDeaths: optionalNonnegIntString,
  lossesOther: optionalNonnegIntString,
  avgWeeklyWorshipAttendance: optionalNonnegIntString,
  potentialGivingUnits: optionalNonnegIntString,
  baptismsChildren: optionalNonnegIntString,
  baptismsAdults: optionalNonnegIntString,
  officersRulingElderCount: optionalNonnegIntString,
  officersDeaconCount: optionalNonnegIntString,
});
export type StatisticsFormValues = z.infer<typeof statisticsSchema>;

export const NUMERIC_STAT_FIELDS = [
  "endingActive",
  "endingBaptized",
  "endingAffiliate",
  "endingOtherParticipants",
  "gainsProfessionsUnder18",
  "gainsProfessions18Plus",
  "gainsCertificate",
  "gainsOther",
  "lossesCertificate",
  "lossesDeaths",
  "lossesOther",
  "avgWeeklyWorshipAttendance",
  "potentialGivingUnits",
  "baptismsChildren",
  "baptismsAdults",
  "officersRulingElderCount",
  "officersDeaconCount",
] as const satisfies readonly (keyof StatisticsFormValues)[];
