/**
 * A UI-safe re-export of the office vocabulary.
 *
 * `src/lib/officers.ts` begins with `import "server-only"`, so a Client
 * Component cannot import a RUNTIME value from it (the guard throws in the
 * client bundle, and in a plain Vitest/jsdom run of any component in this
 * tree). The vocabulary itself now lives in the pure
 * `src/lib/officer-offices.ts` (Increment 2, DECISION-206), which has no
 * server-only guard, so this file is a one-line re-export kept so the officers
 * UI files keep their existing import path. There is no second copy of the
 * list to drift.
 */
export {
  OFFICER_OFFICES,
  OFFICE_LABELS,
  PASTOR_OFFICES,
  SESSION_OFFICES,
  isPastorOffice,
  isSessionOffice,
} from "@/lib/officer-offices";
export type { OfficerOffice } from "@/lib/officer-offices";
