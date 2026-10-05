import type { OrganizationType } from "@/lib/authz";
import type { RelationshipType } from "@/lib/db/domain/lifecycle";

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

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  member_congregation: "Member congregation",
  member_nwc: "Member new worshiping community",
  member_presbytery: "Member presbytery",
  member_synod: "Member synod",
};

/**
 * A human label for an affiliation's relationship type. One place, for the
 * same reason as `organizationTypeLabel()`; falls back to the raw value.
 */
export function relationshipTypeLabel(type: RelationshipType | string): string {
  return RELATIONSHIP_LABELS[type as RelationshipType] ?? type;
}

/**
 * The one relationship type a child of each organization type is recorded
 * under when it joins a parent council (drizzle/0044's `relationship_type`
 * enum). Shared by the create form (which derives the hidden field from it)
 * and `createOrganization()` (which refuses any other value): one table, so
 * the courtesy filter and the enforcement boundary cannot drift. A
 * `general_assembly` is absent — nothing is ever its parent.
 */
export const RELATIONSHIP_BY_CHILD_TYPE: Partial<
  Record<OrganizationType, RelationshipType>
> = {
  congregation: "member_congregation",
  new_worshiping_community: "member_nwc",
  presbytery: "member_presbytery",
  synod: "member_synod",
};
