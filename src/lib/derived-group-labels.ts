import type { DerivedFromKey } from "@/lib/groups";

/**
 * Plain-language labels for the derived groups, in one pure module (Community
 * Increment 3a, S15; docs/work-log/2026-10-22-founding-admin-directory-inc3.md,
 * Phase 3 Copy group H). No `server-only`, no database: the role-grant form
 * (client) and the Groups list (server) both read it, so the words that say WHO
 * a derived group reaches live in one place.
 *
 * Why the grant form labels who a group reaches. Binding a role to a derived
 * group grants it to everyone the group holds. Active Membership holds people
 * with member standing (listed or staff anchor); All Current Records holds every
 * live membership, a visitor or an inactive person included. An administrator
 * choosing the second for a role should read that in the option, because the
 * role will reach people the Directory never lists.
 */

/** The Groups list's "Managed from" text for a derived group that has no management surface of its own, or null when the officers page is the surface. */
export function derivedGroupManagedFromText(derivedFrom: DerivedFromKey): string | null {
  switch (derivedFrom) {
    case "active_membership":
      return "Members, regular attenders and staff";
    case "all_memberships":
      return "Everyone with a current record here";
    case "session":
    case "diaconate":
    case "deacons_moderator":
      return null;
  }
}

/** The grant form's option text for a group. */
export function grantFormGroupLabel(group: {
  name: string;
  derived: boolean;
  derivedFrom?: DerivedFromKey | null;
}): string {
  if (!group.derived) return group.name;
  if (group.derivedFrom === "all_memberships") {
    return `${group.name} (derived; includes visitors and inactive people)`;
  }
  return `${group.name} (derived)`;
}
