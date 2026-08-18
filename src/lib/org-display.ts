import type { OrganizationType } from "@/lib/authz";

/**
 * Display labels for the five organization types.
 *
 * Deliberately in one place rather than inline at each render site: the chooser,
 * the access-denied page and the portal stub all name the same thing, and three
 * copies of a five-way switch is how a presbytery becomes "Presbytery" on one
 * page and "presbytery" on the next.
 *
 * NOT `server-only` and no database import — it is a lookup table, usable from
 * either side of the boundary.
 *
 * These are the PC(USA) council names as the Book of Order uses them. A fork's
 * branding pass should not translate them casually: "session", "presbytery" and
 * "synod" are polity terms, not product vocabulary.
 */
const LABELS: Record<OrganizationType, string> = {
  general_assembly: "General Assembly",
  synod: "Synod",
  presbytery: "Presbytery",
  congregation: "Congregation",
  new_worshiping_community: "New Worshiping Community",
};

/**
 * A human label for an organization type.
 *
 * Falls back to the raw value rather than throwing or rendering nothing: a type
 * added to the enum before this table is updated should read slightly wrong on
 * a card, not blank one out or take the page down.
 */
export function organizationTypeLabel(type: OrganizationType | string): string {
  return LABELS[type as OrganizationType] ?? type;
}
