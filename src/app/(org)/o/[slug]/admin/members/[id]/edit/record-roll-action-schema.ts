import { z } from "zod";
import { EDIT_TIME_ROLL_ACTION_KINDS } from "@/lib/roll-action-kinds";

// EDIT_TIME_ROLL_ACTION_KINDS is `as const satisfies readonly RollActionKind[]`
// (src/lib/roll-action-kinds.ts) — already the `[string, ...string[]]` shape
// `z.enum` requires, so no cast is needed here.

/**
 * `RecordRollActionForm`'s own schema — a small, single-purpose form,
 * deliberately separate from `editPersonSchema` (Phase 2's placement
 * ruling: two forms, two independent submit/success/error states, not one
 * shared `<form>`). `kind` is constrained to `EDIT_TIME_ROLL_ACTION_KINDS`
 * client-side; `recordRollAction()` re-validates the same allow-list
 * server-side (Phase 1's adversarial pass — never trust the client
 * `<select>` alone).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const recordRollActionSchema = z.object({
  kind: z.enum(EDIT_TIME_ROLL_ACTION_KINDS, {
    message: "Choose a roll action",
  }),
  effectiveDate: z
    .string()
    .min(1, "Effective date is required")
    .regex(DATE_RE, "Enter a valid date"),
  minuteReference: z.string().optional(),
});

export type RecordRollActionValues = z.infer<typeof recordRollActionSchema>;

export const RECORD_ROLL_ACTION_DEFAULT_VALUES: RecordRollActionValues = {
  kind: EDIT_TIME_ROLL_ACTION_KINDS[0],
  effectiveDate: "",
  minuteReference: "",
};
