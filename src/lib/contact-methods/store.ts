import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { contactMethods } from "@/lib/db/domain/people";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import { planEmailSave, primaryChanged, type EmailPlan } from "./email-plan";
import type {
  ActiveEmailRow,
  EmailRefusal,
  EmailRowInput,
  EmailSubtype,
  SharedAddressNote,
} from "./types";

/**
 * THE ONLY WRITER of `contact_methods` in `src/` (DECISION-215/216), for both
 * kinds: add, end, replace, set the main address, relabel, set
 * `do_not_contact`. A source scan (`scan.test.ts`) fails on any other writer.
 * A future importer must call these functions, not write the table.
 *
 * Everything runs inside the caller's `withOrgContext()` transaction and writes
 * its audit rows with `insertAuditRow()` in that same transaction, so a change
 * and its record commit or roll back together. Nothing here deletes: removal is
 * `ended_at`, and the database revoked DELETE from `presby_app` (0064). An
 * edited address is ended and replaced, never changed in place, so
 * `verified_at` (which only `presby_accept_invitation` may set) never travels
 * to a different mailbox (F214). This module never writes `verified_at`,
 * `created_at` or `ended_at` on insert: the database owns them.
 *
 * AUDIT METADATA NEVER CARRIES AN ADDRESS, a fragment of one, or a domain: the
 * contact row id and the label identify the row, and the ended row keeps its
 * value for anyone entitled to read it.
 *
 * TWO ENTRY POINTS, because of the create-time RLS window (D11):
 * `contact_methods` and `people` SELECT policies need a membership in the
 * current organization, and `createPerson()` inserts contact rows BEFORE the
 * membership row. In that window the person cannot be `SELECT ... FOR UPDATE`d
 * and an `INSERT ... RETURNING` would fail, so `createContactsForNewPerson`
 * takes no lock (nobody else can see the person yet), uses client-generated
 * ids and returns nothing from the insert.
 */

export interface StoreContext {
  organizationId: string;
  actor: { userId: string; email: string | null };
}

const CREATED_AT_ISO = sql<string>`to_char(${contactMethods.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The person's active email rows in the canonical order (ER1a): main first, then oldest. */
export async function listActiveEmails(tx: OrgTx, personId: string): Promise<ActiveEmailRow[]> {
  const rows = await tx
    .select({
      id: contactMethods.id,
      value: contactMethods.value,
      subtype: contactMethods.subtype,
      isPrimary: contactMethods.isPrimary,
      doNotContact: contactMethods.doNotContact,
      createdAt: CREATED_AT_ISO,
    })
    .from(contactMethods)
    .where(
      and(
        eq(contactMethods.personId, personId),
        eq(contactMethods.kind, "email"),
        isNull(contactMethods.endedAt),
      ),
    )
    .orderBy(desc(contactMethods.isPrimary), asc(contactMethods.createdAt), asc(contactMethods.id));
  return rows.map((row) => ({ ...row, subtype: row.subtype as EmailSubtype | null }));
}

/** The person's active primary phone number, or null. */
export async function getPrimaryPhone(tx: OrgTx, personId: string): Promise<string | null> {
  const [row] = await tx
    .select({ value: contactMethods.value })
    .from(contactMethods)
    .where(
      and(
        eq(contactMethods.personId, personId),
        eq(contactMethods.kind, "phone"),
        eq(contactMethods.isPrimary, true),
        isNull(contactMethods.endedAt),
      ),
    )
    .limit(1);
  return row?.value ?? null;
}

/**
 * Serializes concurrent saves for one person and keeps R27's lock order
 * (person before contact rows). Only for a person already visible through the
 * current organization's RLS (everything except the create-time window).
 */
async function lockPerson(tx: OrgTx, personId: string): Promise<void> {
  await tx.execute(sql`select id from people where id = ${personId}::uuid for update`);
}

async function auditEmail(
  tx: OrgTx,
  ctx: StoreContext,
  personId: string,
  action:
    | typeof AUDIT_ACTIONS.TENANT_PERSON_EMAIL_ADDED
    | typeof AUDIT_ACTIONS.TENANT_PERSON_EMAIL_ENDED
    | typeof AUDIT_ACTIONS.TENANT_PERSON_EMAIL_PRIMARY_CHANGED
    | typeof AUDIT_ACTIONS.TENANT_PERSON_EMAIL_UPDATED,
  metadata: Record<string, unknown>,
): Promise<void> {
  await insertAuditRow(tx, {
    action,
    actor: ctx.actor,
    resourceType: "person",
    resourceId: personId,
    metadata: { organizationId: ctx.organizationId, ...metadata },
  });
}

export type SaveEmailsResult =
  | {
      kind: "ok";
      changed: boolean;
      /** Set when the main address was removed or replaced and another became the main (Q3). */
      promoted?: { address: string };
      /** The normalized addresses inserted by this save (new or replacement), for the shared-address note. */
      insertedAddresses: string[];
    }
  | { kind: "refused"; refusal: EmailRefusal };

/**
 * Executes one plan. Order matters because the partial unique index (one
 * active main per person and kind) cannot be deferred: end rows (clearing
 * `is_primary` in the same statement, ER1d), demote kept rows, relabel in
 * place, insert new rows, THEN promote the chosen existing row, then audit.
 * Returns the id assigned to each planned insert (in plan order).
 */
async function executePlan(
  tx: OrgTx,
  ctx: StoreContext,
  personId: string,
  plan: EmailPlan,
): Promise<string[]> {
  const insertIds = plan.insert.map(() => randomUUID());

  if (plan.end.length > 0) {
    await tx
      .update(contactMethods)
      .set({ isPrimary: false, endedAt: sql`now()` })
      .where(
        and(
          eq(contactMethods.personId, personId),
          inArray(contactMethods.id, plan.end.map((e) => e.id)),
          isNull(contactMethods.endedAt),
        ),
      );
  }
  if (plan.demote.length > 0) {
    await tx
      .update(contactMethods)
      .set({ isPrimary: false })
      .where(and(eq(contactMethods.personId, personId), inArray(contactMethods.id, plan.demote)));
  }
  for (const change of plan.relabel) {
    await tx
      .update(contactMethods)
      .set({ subtype: change.subtype, doNotContact: change.doNotContact })
      .where(and(eq(contactMethods.personId, personId), eq(contactMethods.id, change.id)));
  }
  if (plan.insert.length > 0) {
    await tx.insert(contactMethods).values(
      plan.insert.map((row, i) => ({
        id: insertIds[i]!,
        personId,
        kind: "email",
        subtype: row.subtype,
        value: row.value,
        isPrimary: row.isPrimary,
        doNotContact: row.doNotContact,
      })),
    );
  }
  for (const id of plan.promote) {
    await tx
      .update(contactMethods)
      .set({ isPrimary: true })
      .where(and(eq(contactMethods.personId, personId), eq(contactMethods.id, id)));
  }

  // --- audit, in this transaction ------------------------------------------
  for (const ended of plan.end) {
    await auditEmail(tx, ctx, personId, AUDIT_ACTIONS.TENANT_PERSON_EMAIL_ENDED, {
      contactMethodId: ended.id,
      subtype: ended.subtype,
      wasPrimary: ended.wasPrimary,
      ...(ended.replacedByInsert !== undefined ? { replacedById: insertIds[ended.replacedByInsert] } : {}),
    });
  }
  for (let i = 0; i < plan.insert.length; i += 1) {
    const row = plan.insert[i]!;
    await auditEmail(tx, ctx, personId, AUDIT_ACTIONS.TENANT_PERSON_EMAIL_ADDED, {
      contactMethodId: insertIds[i],
      subtype: row.subtype,
      isPrimary: row.isPrimary,
      ...(row.replacesId ? { replacesId: row.replacesId } : {}),
    });
  }
  if (primaryChanged(plan)) {
    const p = plan.primary!;
    await auditEmail(tx, ctx, personId, AUDIT_ACTIONS.TENANT_PERSON_EMAIL_PRIMARY_CHANGED, {
      fromContactMethodId: p.fromId,
      toContactMethodId: p.toInsertIndex !== null ? insertIds[p.toInsertIndex] : p.toExistingId,
      automatic: p.automatic,
    });
  }
  for (const change of plan.relabel) {
    await auditEmail(tx, ctx, personId, AUDIT_ACTIONS.TENANT_PERSON_EMAIL_UPDATED, {
      contactMethodId: change.id,
      fields: change.fields,
    });
  }
  return insertIds;
}

/**
 * Saves the full set of a person's email addresses (declarative: the list the
 * administrator submitted IS the result). `knownIds` is the active ids the form
 * loaded; under the person lock, if that set differs from the live active set,
 * nothing is written and the save refuses with `emails_changed` (D4), so a
 * second administrator's concurrent addition is never silently ended.
 */
export async function saveEmails(
  tx: OrgTx,
  ctx: StoreContext,
  personId: string,
  input: { rows: readonly EmailRowInput[]; knownIds: readonly string[] },
): Promise<SaveEmailsResult> {
  await lockPerson(tx, personId);
  const active = await listActiveEmails(tx, personId);

  const known = new Set(input.knownIds);
  const live = new Set(active.map((row) => row.id));
  if (known.size !== input.knownIds.length || known.size !== live.size || [...live].some((id) => !known.has(id))) {
    return { kind: "refused", refusal: { reason: "emails_changed" } };
  }

  const planned = planEmailSave(active, input.rows);
  if (planned.kind === "refused") return { kind: "refused", refusal: planned.refusal };
  const { plan } = planned;
  if (!plan.changed) return { kind: "ok", changed: false, insertedAddresses: [] };

  await executePlan(tx, ctx, personId, plan);

  let promoted: { address: string } | undefined;
  if (primaryChanged(plan) && plan.primary!.automatic) {
    const p = plan.primary!;
    const address =
      p.toInsertIndex !== null
        ? plan.insert[p.toInsertIndex]!.value
        : active.find((row) => row.id === p.toExistingId)!.value;
    promoted = { address };
  }
  return {
    kind: "ok",
    changed: true,
    ...(promoted ? { promoted } : {}),
    insertedAddresses: plan.insert.map((row) => row.value),
  };
}

export type CreateContactsResult =
  | { kind: "ok"; insertedAddresses: string[] }
  | { kind: "refused"; refusal: EmailRefusal };

/**
 * `createPerson()`'s contact rows, written BEFORE the membership exists (D11):
 * no lock, client-generated ids, no RETURNING. The first address becomes the
 * main one when none is flagged (the planner's rule). Phone: one primary row.
 */
export async function createContactsForNewPerson(
  tx: OrgTx,
  ctx: StoreContext,
  personId: string,
  input: { emails?: readonly EmailRowInput[]; phone?: string },
): Promise<CreateContactsResult> {
  const emails = (input.emails ?? []).map((row) => ({ ...row, id: undefined }));
  const planned = planEmailSave([], emails);
  if (planned.kind === "refused") return { kind: "refused", refusal: planned.refusal };
  await executePlan(tx, ctx, personId, planned.plan);

  const phone = input.phone?.trim();
  if (phone) {
    await tx.insert(contactMethods).values({
      id: randomUUID(),
      personId,
      kind: "phone",
      value: phone,
      isPrimary: true,
    });
  }
  return { kind: "ok", insertedAddresses: planned.plan.insert.map((row) => row.value) };
}

/**
 * The person's one editable primary phone. Same value: nothing. A different
 * value: end the old row (its label carries to the replacement) and insert a
 * new primary. Blank: end it. No audit key of its own: a phone change rides
 * `tenant.person.updated` as `phoneChanged`.
 */
export async function savePrimaryPhone(
  tx: OrgTx,
  personId: string,
  value: string | undefined,
): Promise<{ changed: boolean }> {
  await lockPerson(tx, personId);
  const next = (value ?? "").trim();
  const [current] = await tx
    .select({ id: contactMethods.id, value: contactMethods.value, subtype: contactMethods.subtype })
    .from(contactMethods)
    .where(
      and(
        eq(contactMethods.personId, personId),
        eq(contactMethods.kind, "phone"),
        eq(contactMethods.isPrimary, true),
        isNull(contactMethods.endedAt),
      ),
    )
    .limit(1);

  if (!next && !current) return { changed: false };
  if (next && current && current.value === next) return { changed: false };

  if (current) {
    await tx
      .update(contactMethods)
      .set({ isPrimary: false, endedAt: sql`now()` })
      .where(eq(contactMethods.id, current.id));
  }
  if (next) {
    await tx.insert(contactMethods).values({
      id: randomUUID(),
      personId,
      kind: "phone",
      subtype: current?.subtype ?? null,
      value: next,
      isPrimary: true,
    });
  }
  return { changed: true };
}

/**
 * "Also on file for {Name}" (ER23b): for each address, the OTHER live,
 * unmerged, living people (`date_of_death is null`, Community Increment 2b:
 * a deceased relative's old shared address must not block anyone) at the
 * CURRENT organization (a membership with `ended_on is null`) who hold it as an
 * active email. R29's predicate (2b's `address_shared`),
 * on the RLS connection only: never the platform connection and never across
 * organizations, so the note can only name people this administrator can
 * already see. Names are `preferred or first, last`, ordered by last then
 * first name, capped at three with a count of the rest.
 */
export async function findSharedAddressNotes(
  tx: OrgTx,
  personId: string,
  addresses: readonly string[],
): Promise<SharedAddressNote[]> {
  const unique = [...new Set(addresses)];
  if (unique.length === 0) return [];
  const result = await tx.execute(sql`
    select cm.value as address,
           coalesce(p2.preferred_name, p2.first_name) || ' ' || p2.last_name as name
      from contact_methods cm
      join people p2 on p2.id = cm.person_id and p2.merged_into_id is null
                    and p2.date_of_death is null
      join memberships m2 on m2.person_id = p2.id
                         and m2.organization_id = presby_current_org()
                         and m2.ended_on is null
     where cm.kind = 'email'
       and cm.ended_at is null
       and cm.person_id <> ${personId}::uuid
       and cm.value in (${sql.join(unique.map((a) => sql`${a}`), sql`, `)})
     order by cm.value, p2.last_name, p2.first_name, p2.id
  `);
  const rows = ((result as unknown as { rows?: Array<{ address: string; name: string }> }).rows ?? []);
  const notes: SharedAddressNote[] = [];
  for (const address of unique) {
    const names = rows.filter((row) => row.address === address).map((row) => row.name);
    if (names.length === 0) continue;
    notes.push({ address, names: names.slice(0, 3), more: Math.max(0, names.length - 3) });
  }
  return notes;
}
