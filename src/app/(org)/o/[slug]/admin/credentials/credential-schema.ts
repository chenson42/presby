import { z } from "zod";
import { APPOINTMENT_CALL_TYPES, ORDAINED_MINISTRIES } from "./credential-labels";

/**
 * Client-side validation for "Record an ordination" and "Record an
 * appointment" — presbytery-functionality Increment 2 Phase 3 design.
 *
 * NEITHER SCHEMA IS THE ONLY GATE (same discipline `../events/event-schema
 * .ts`/`../officers/officer-term-schema.ts` document) — every check
 * duplicated here (required fields, the length limit) is re-enforced
 * server-side in `src/lib/credentials.ts` (Phase 1's Adversarial Pass class
 * of gap) — this file's job is only to block an obviously-bad submit before
 * a round trip.
 */
const MINUTE_REFERENCE_MAX = 500;

export const recordOrdinationSchema = z.object({
  personId: z.string().min(1, "Choose a person"),
  ministry: z.enum(ORDAINED_MINISTRIES),
  /** 'YYYY-MM-DD'. */
  ordainedOn: z.string().min(1, "Ordination date is required"),
  minuteReference: z
    .string()
    .max(
      MINUTE_REFERENCE_MAX,
      `Minute reference must be ${MINUTE_REFERENCE_MAX} characters or fewer`,
    )
    .optional(),
});
export type RecordOrdinationFormValues = z.infer<typeof recordOrdinationSchema>;

export const recordAppointmentSchema = z.object({
  personId: z.string().min(1, "Choose a person"),
  servingOrgId: z.string().min(1, "Choose a congregation"),
  callType: z.enum(APPOINTMENT_CALL_TYPES),
  /** 'YYYY-MM-DD'. */
  startsOn: z.string().min(1, "Start date is required"),
  minuteReference: z
    .string()
    .max(
      MINUTE_REFERENCE_MAX,
      `Minute reference must be ${MINUTE_REFERENCE_MAX} characters or fewer`,
    )
    .optional(),
});
export type RecordAppointmentFormValues = z.infer<typeof recordAppointmentSchema>;
