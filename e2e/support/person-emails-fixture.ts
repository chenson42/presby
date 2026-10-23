/**
 * person-emails-fixture.ts - rows for the person-emails specs
 * (2026-10-23-person-emails, Batch 3). Built on community-fixture.ts: the people
 * are `E2ECommunity ...` participants (swept by name), and these helpers add
 * what a participant does not have: addresses and a staff position.
 *
 * Written on the owner connection (fixture plumbing, never application code).
 * The owner path keeps DELETE on `contact_methods`; the application's roles do
 * not (0064). Addresses are synthetic `example.invalid`.
 */

import type { Sql } from "./db";
import { COMMUNITY_ORG } from "./community-fixture";

export interface FixtureEmail {
  value: string;
  subtype?: "personal" | "work" | "other" | null;
  isPrimary?: boolean;
  doNotContact?: boolean;
}

/** One normalized address for a person. Exactly one row per person may be the main. */
export async function addContactEmail(sql: Sql, personId: string, email: FixtureEmail): Promise<void> {
  await sql`
    insert into contact_methods (person_id, kind, subtype, value, is_primary, do_not_contact)
    values (${personId}::uuid, 'email', ${email.subtype ?? null}, ${email.value.trim().toLowerCase()},
            ${email.isPrimary ?? false}, ${email.doNotContact ?? false})
  `;
}

/** An open staff position at the community org, so the directory shows the person's Work address. */
export async function addOpenStaffPosition(sql: Sql, personId: string, position = "E2E Office Coordinator"): Promise<void> {
  await sql`
    insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
    values (${COMMUNITY_ORG.id}::uuid, ${personId}::uuid, ${position}, ${position.trim().toLowerCase()}, date '2020-01-01')
  `;
}

export interface EmailRow {
  value: string;
  subtype: string | null;
  is_primary: boolean;
  do_not_contact: boolean;
  ended: boolean;
}

/** Every address row for a person, oldest first, active and ended. */
export async function emailRows(sql: Sql, personId: string): Promise<EmailRow[]> {
  return (await sql`
    select value, subtype, is_primary, do_not_contact, ended_at is not null as ended
      from contact_methods
     where person_id = ${personId}::uuid and kind = 'email'
     order by created_at, id`) as EmailRow[];
}

/** The audit rows this person's address changes wrote, by action, oldest first. */
export async function emailAudit(
  sql: Sql,
  personId: string,
): Promise<{ action: string; metadata: Record<string, unknown> }[]> {
  return (await sql`
    select action, metadata from audit_events
     where resource_id = ${personId} and action like 'tenant.person_email.%'
     order by created_at, id`) as { action: string; metadata: Record<string, unknown> }[];
}

/** Removes what this file added for the given people: staff positions and the address audit rows. */
export async function removeEmailExtras(sql: Sql, personIds: string[]): Promise<void> {
  if (personIds.length === 0) return;
  await sql`delete from staff_positions where person_id = any(${personIds}::uuid[])`;
  await sql`delete from audit_events
             where resource_id = any(${personIds}) and (action like 'tenant.person_email.%' or action = 'tenant.person.updated')`;
}
