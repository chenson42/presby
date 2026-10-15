import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { DEFAULT_ORG_TIME_ZONE, isValidTimeZone } from "@/lib/shared/org-time";

/**
 * Org-level settings readers (DECISION-160, R2).
 *
 * The organization's IANA time zone — the zone in which "now" is read (today's
 * highlight, the default calendar month, the Today link, the home card's
 * "upcoming" test). It is NEVER used to convert a stored `events.starts_at`.
 *
 * F132: most organizations have no `organization_settings` row, so the column
 * default never applies to them. A MISSING ROW therefore resolves to
 * `DEFAULT_ORG_TIME_ZONE` here — that fallback is the contract, not a stopgap.
 *
 * No permission check: org membership, already proven by the caller's
 * `withOrgContext`, is the gate. A zone name is not sensitive.
 *
 * Raw `tx.execute` rather than a Drizzle select, so a unit test can stub the
 * transaction with `{ rows: [...] }` and need no database.
 */
export async function orgTimeZoneInTx(
  tx: OrgTx,
  organizationId: string,
): Promise<string> {
  const result = await tx.execute(sql`
    select time_zone from organization_settings
     where organization_id = ${organizationId}::uuid
  `);
  const stored = (
    result as unknown as { rows?: Array<{ time_zone?: unknown }> }
  ).rows?.[0]?.time_zone;

  if (stored === undefined || stored === null) {
    return DEFAULT_ORG_TIME_ZONE;
  }
  if (isValidTimeZone(stored)) {
    return stored;
  }
  // Postgres's tzdata and Node's ICU can disagree about a rare zone. Fall back
  // so the calendar still renders, and log the org id ONLY — never the value
  // or an error message.
  console.error(
    `org-settings: stored time zone for organization ${organizationId} is not usable by this runtime; using the default`,
  );
  return DEFAULT_ORG_TIME_ZONE;
}
