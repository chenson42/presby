import type { OfficerOffice } from "@/lib/officers";

/**
 * A UI-safe duplicate of `src/lib/officers.ts`'s `OFFICER_OFFICES`/
 * `OFFICE_LABELS`.
 *
 * `officers.ts` begins with `import "server-only"` (it reads through
 * `withOrgContext()`/the Neon pool). Importing a RUNTIME value from it — as
 * opposed to a `type`, which is erased at compile time — from a Client
 * Component (`add-officer-term-form.tsx`, `end-term-dialog.tsx`) would pull
 * that whole module, and its `server-only` guard, into the client bundle,
 * where the guard throws unconditionally. The same failure mode reproduces
 * in a plain Vitest/jsdom run of ANY component in this tree, server or
 * client, because Vitest resolves `server-only`'s package export without
 * Next's `react-server` condition either. This is exactly why
 * `roles-list.tsx`/`grant-role-form.tsx` (P9's equivalent surface) only ever
 * `import type` from `@/lib/role-grants.ts` and never a runtime export.
 *
 * This file is the one small, effectively-frozen exception every officers
 * UI file (client AND server component) should import display labels from,
 * instead of `@/lib/officers`'s own copy — a `Record<OfficerOffice, string>`
 * with nothing library-only about it. `src/lib/officers.ts` remains the
 * source of truth for `OfficerOffice` itself (imported here as a `type`
 * only) and for the values this array must match; a future new office added
 * to one and not the other is a TypeScript error, not a silent drift,
 * because `satisfies` below checks this array against that type.
 */
export const OFFICER_OFFICES = [
  "ruling_elder",
  "deacon",
  "clerk_of_session",
  "moderator",
  "treasurer",
  "trustee",
] as const satisfies readonly OfficerOffice[];

export const OFFICE_LABELS: Record<OfficerOffice, string> = {
  ruling_elder: "Ruling Elder",
  deacon: "Deacon",
  clerk_of_session: "Clerk of Session",
  moderator: "Moderator",
  treasurer: "Treasurer",
  trustee: "Trustee",
};
