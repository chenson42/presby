import type { GroupRole, ManageableGroupTypeKey } from "@/lib/groups";

/**
 * A UI-safe duplicate of `src/lib/groups.ts`'s `MANAGEABLE_GROUP_TYPE_KEYS`/
 * `GROUP_ROLES`, for the identical reason `officers/office-labels.ts`
 * documents at its own header: `groups.ts` begins with `import "server-only"`
 * (it reads through `withOrgContext()`/the Neon pool). Importing a RUNTIME
 * value from it — as opposed to a `type`, erased at compile time — from a
 * Client Component (`new-group-form.tsx`, `edit-group-form.tsx`,
 * `add-group-member-form.tsx`) would pull that whole module, and its
 * `server-only` guard, into the client bundle, where the guard throws
 * unconditionally.
 *
 * `groups.ts` remains the source of truth for `ManageableGroupTypeKey`/
 * `GroupRole` themselves (imported here as types only); the `satisfies`
 * checks below tie this file's arrays to those types, so a future key added
 * to one and not the other is a TypeScript error, not a silent drift.
 */
export const MANAGEABLE_GROUP_TYPE_KEYS = [
  "committee",
  "small_group",
  "choir",
  "team",
] as const satisfies readonly ManageableGroupTypeKey[];

/**
 * Fallback labels only — the new/edit-group form's `<select>` renders
 * `getGroupFormOptions()`'s own DB-sourced `name` for each option whenever
 * it's present (the platform-seeded name IS the display label,
 * `scripts/seed.ts`'s `seedGroupTypes()`), so this map exists for the rare
 * "options list came back empty" / genuinely-offline copy, not as the
 * primary label source.
 */
export const GROUP_TYPE_LABELS: Record<ManageableGroupTypeKey, string> = {
  committee: "Committee",
  small_group: "Small Group",
  choir: "Choir",
  team: "Team",
};

export const GROUP_ROLES = [
  "chair",
  "leader",
  "member",
] as const satisfies readonly GroupRole[];

export const GROUP_ROLE_LABELS: Record<GroupRole, string> = {
  chair: "Chair",
  leader: "Leader",
  member: "Member",
};
