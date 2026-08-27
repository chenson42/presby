import type {
  AppointmentCallType,
  CredentialStatusValue,
  OrdainedMinistry,
} from "@/lib/credentials";

/**
 * A UI-safe duplicate of `src/lib/credentials.ts`'s vocabulary constants —
 * same rationale as `../officers/office-labels.ts`: `credentials.ts` begins
 * with `import "server-only"` (it reads through `withOrgContext()`/the Neon
 * pool), so importing a RUNTIME value from it into a Client Component would
 * pull that whole module, and its `server-only` guard, into the client
 * bundle (and reproduce identically in a plain Vitest/jsdom run of ANY
 * component in this tree, server or client — the same failure mode that
 * file documents). This is the one small, effectively-frozen file every
 * credentials UI component (client AND server) should import display
 * labels/option lists from, instead of `@/lib/credentials`'s own copy.
 * `src/lib/credentials.ts` remains the source of truth for the TYPES
 * (imported here as `type` only) and for the values these arrays must
 * match — a future new value added to one and not the other is a
 * TypeScript error, not a silent drift, via the `satisfies` checks below.
 */
export const ORDAINED_MINISTRIES = [
  "ruling_elder",
  "deacon",
  "minister_of_word_and_sacrament",
] as const satisfies readonly OrdainedMinistry[];

export const MINISTRY_LABELS: Record<OrdainedMinistry, string> = {
  ruling_elder: "Ruling Elder",
  deacon: "Deacon",
  minister_of_word_and_sacrament: "Minister of Word and Sacrament",
};

export const CREDENTIAL_STATUSES = [
  "active",
  "honorably_retired",
  "on_leave",
  "exempt_from_active_service",
  "disciplined",
  "removed",
  "deceased",
] as const satisfies readonly CredentialStatusValue[];

export const CREDENTIAL_STATUS_LABELS: Record<CredentialStatusValue, string> = {
  active: "Active",
  honorably_retired: "Honorably Retired",
  on_leave: "On Leave",
  exempt_from_active_service: "Exempt from Active Service",
  disciplined: "Under Discipline",
  removed: "Removed from Ordered Ministry",
  deceased: "Deceased",
};

/**
 * The "Change status" picker's own option set — every status EXCEPT
 * `"removed"`. `"removed"` is reachable only through the separate "End
 * ordination" confirm dialog, which submits it directly — see
 * `src/lib/credentials.ts`'s header for why both controls call the same
 * `changeOrdinationStatus()` function. Keeping "removed" out of this list
 * is what makes the two controls read as genuinely different actions,
 * never one dropdown mixing both action classes (Phase 3 Edge Cases).
 */
export const CHANGEABLE_CREDENTIAL_STATUSES = CREDENTIAL_STATUSES.filter(
  (status) => status !== "removed",
) as readonly Exclude<CredentialStatusValue, "removed">[];

export const APPOINTMENT_CALL_TYPES = [
  "installed_pastor",
  "designated_pastor",
  "stated_supply",
  "interim_pastor",
  "temporary_supply",
  "parish_associate",
] as const satisfies readonly AppointmentCallType[];

export const CALL_TYPE_LABELS: Record<AppointmentCallType, string> = {
  installed_pastor: "Installed Pastor",
  designated_pastor: "Designated Pastor",
  stated_supply: "Stated Supply",
  interim_pastor: "Interim Pastor",
  temporary_supply: "Temporary Supply",
  parish_associate: "Parish Associate",
};
