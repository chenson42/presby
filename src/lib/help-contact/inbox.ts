import "server-only";
import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getPlatformDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  helpContactMessages as messages,
  type HelpContactStatus,
  type HelpContactTopicKey,
} from "@/lib/db/domain/help-contact";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";

/**
 * The /admin/messages data layer: the ONLY file under `src/lib/help-contact/`
 * that calls `getPlatformDb()` (CA1, CA9, DECISION-300). `help_contact_messages`
 * is deny-all to `presby_app` (FORCE RLS with no policy, no grant), so reads and
 * triage run on the platform connection, and the CALLER is the authorization:
 * every page and action that reaches this file has already checked
 * `FEATURES.ADMIN_TICKETS` (a permission is not a flag, and nothing here asks
 * either question).
 *
 * EVERY MUTATION is one transaction: `SELECT ... FOR UPDATE`, the UPDATE, and the
 * audit row from `insertAuditRow(tx, ...)` in the same commit, so a state change
 * cannot exist without its audit row (CA10). The audit `metadata` carries the
 * message id and the status words only. It NEVER carries the name, email,
 * congregation or message: `audit_events` is kept forever, and a "clear details"
 * whose audit row copied the details would defeat the clear (AF-5).
 * `check:audit` cannot see a write in a library file (AF-7), so
 * inbox.db.test.ts is the guard: one audit row per mutation, no personal field
 * in its metadata.
 *
 * The database guard (0083 `help_contact_guard_update`) is the second wall: it
 * refuses any rewrite of a stranger's words and stamps `status_changed_at` and
 * `cleared_at` itself. This file never writes a timestamp.
 *
 * `exec` is the transaction runner. The default is the platform connection's
 * `transaction` (the `DomainExec` precedent in domains/service.ts); a database
 * test passes a runner bound to a transaction it rolls back.
 */

export type MessageStatusFilter = HelpContactStatus | "all";

export type PlatformExec = <T>(fn: (tx: OrgTx) => Promise<T>) => Promise<T>;

const defaultExec: PlatformExec = (fn) =>
  getPlatformDb().transaction((tx) => fn(tx as unknown as OrgTx));

export const INBOX_PAGE_SIZE = 25;
export const EXCERPT_CHARS = 140;

/** The microsecond ISO shape `listMessages` hands out as a cursor: a Date would round to milliseconds and skip rows. */
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a string that can be a message id (the page maps anything else to a 404 before it touches the database). */
export function isMessageId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** A `?before=` value is trusted only in the exact shape this file produced; anything else is ignored. */
export function parseCursor(value: unknown): string | null {
  return typeof value === "string" && CURSOR_RE.test(value) ? value : null;
}

export interface InboxRow {
  id: string;
  createdAt: Date;
  topic: HelpContactTopicKey;
  status: HelpContactStatus;
  name: string | null;
  /** Plain text, whitespace collapsed, at most EXCERPT_CHARS characters; null once the details were cleared. */
  excerpt: string | null;
  cleared: boolean;
  /** Pass as `before` to read the page after this row. */
  cursor: string;
}

export interface InboxDetail {
  id: string;
  createdAt: Date;
  topic: HelpContactTopicKey;
  status: HelpContactStatus;
  name: string | null;
  email: string | null;
  congregation: string | null;
  message: string | null;
  statusChangedAt: Date | null;
  statusChangedByName: string | null;
  cleared: boolean;
  clearedAt: Date | null;
  clearedByName: string | null;
}

function excerptOf(raw: string | null): string | null {
  if (raw === null) return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > EXCERPT_CHARS ? `${chars.slice(0, EXCERPT_CHARS).join("")}…` : flat;
}

/**
 * One page of the inbox, newest first, keyset-paged on `created_at`. Reads
 * `limit + 1` rows so `hasMore` needs no count. The excerpt is cut in SQL
 * (`left(message, ...)`), so a 2,000-character message does not travel for a card.
 */
export async function listMessages(
  q: { status: MessageStatusFilter; before?: string | null; limit?: number },
  exec: PlatformExec = defaultExec,
): Promise<{ rows: InboxRow[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? INBOX_PAGE_SIZE), 1), 100);
  const conditions: SQL[] = [];
  if (q.status !== "all") conditions.push(eq(messages.status, q.status));
  const before = parseCursor(q.before);
  if (before) conditions.push(lt(messages.createdAt, sql`${before}::timestamptz`));

  const found = await exec((tx) =>
    tx
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
        topic: messages.topic,
        status: messages.status,
        name: messages.name,
        head: sql<string | null>`left(${messages.message}, ${EXCERPT_CHARS * 4})`,
        clearedAt: messages.clearedAt,
        cursor: sql<string>`to_char(${messages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(messages)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1),
  );

  const page = found.slice(0, limit);
  return {
    rows: page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      topic: r.topic,
      status: r.status,
      name: r.name,
      excerpt: excerptOf(r.head),
      cleared: r.clearedAt !== null,
      cursor: r.cursor,
    })),
    hasMore: found.length > limit,
  };
}

/** One message with the two operator names its stamps point at. `null` when there is no such message. */
export async function readMessage(
  id: string,
  exec: PlatformExec = defaultExec,
): Promise<InboxDetail | null> {
  if (!isMessageId(id)) return null;
  const changer = alias(users, "status_changer");
  const clearer = alias(users, "clearer");
  const [row] = await exec((tx) =>
    tx
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
        topic: messages.topic,
        status: messages.status,
        name: messages.name,
        email: messages.email,
        congregation: messages.congregation,
        message: messages.message,
        statusChangedAt: messages.statusChangedAt,
        statusChangedByName: changer.name,
        clearedAt: messages.clearedAt,
        clearedByName: clearer.name,
      })
      .from(messages)
      .leftJoin(changer, eq(changer.id, messages.statusChangedBy))
      .leftJoin(clearer, eq(clearer.id, messages.clearedBy))
      .where(eq(messages.id, id))
      .limit(1),
  );
  if (!row) return null;
  return { ...row, cleared: row.clearedAt !== null };
}

export interface InboxActor {
  userId: string;
  email: string | null;
}

export type SetStatusResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "cleared_cannot_be_new" };

export type ClearDetailsResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_cleared" | "needs_triage" };

/**
 * Changes a message's status and writes the audit row in the same transaction.
 * A change to the status it already has is a no-op that writes nothing (two
 * operators racing on one message leave one row, not two). Sets
 * `status_changed_by` itself; the guard stamps `status_changed_at`.
 */
export async function setMessageStatus(
  actor: InboxActor,
  id: string,
  to: HelpContactStatus,
  exec: PlatformExec = defaultExec,
): Promise<SetStatusResult> {
  if (!isMessageId(id)) return { ok: false, reason: "not_found" };
  return exec(async (tx): Promise<SetStatusResult> => {
    const [row] = await tx
      .select({ status: messages.status, clearedAt: messages.clearedAt })
      .from(messages)
      .where(eq(messages.id, id))
      .for("update");
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status === to) return { ok: true };
    if (to === "new" && row.clearedAt !== null) {
      return { ok: false, reason: "cleared_cannot_be_new" };
    }
    await tx.update(messages).set({ status: to, statusChangedBy: actor.userId }).where(eq(messages.id, id));
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.HELP_CONTACT_STATUS_CHANGED,
      actor,
      resourceType: "help_contact_message",
      resourceId: id,
      // Ids and statuses only. Never a personal field (AF-5).
      metadata: { messageId: id, from: row.status, to },
    });
    return { ok: true };
  });
}

/**
 * Blanks name, email, congregation and message, irreversibly, and writes the
 * audit row in the same transaction. Refused while the status is `new` and once
 * cleared; the guard enforces both again. Sets `cleared_by`; the guard stamps
 * `cleared_at`.
 */
export async function clearMessageDetails(
  actor: InboxActor,
  id: string,
  exec: PlatformExec = defaultExec,
): Promise<ClearDetailsResult> {
  if (!isMessageId(id)) return { ok: false, reason: "not_found" };
  return exec(async (tx): Promise<ClearDetailsResult> => {
    const [row] = await tx
      .select({ status: messages.status, clearedAt: messages.clearedAt })
      .from(messages)
      .where(eq(messages.id, id))
      .for("update");
    if (!row) return { ok: false, reason: "not_found" };
    if (row.clearedAt !== null) return { ok: false, reason: "already_cleared" };
    if (row.status === "new") return { ok: false, reason: "needs_triage" };
    await tx
      .update(messages)
      .set({ name: null, email: null, congregation: null, message: null, clearedBy: actor.userId })
      .where(eq(messages.id, id));
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.HELP_CONTACT_DETAILS_CLEARED,
      actor,
      resourceType: "help_contact_message",
      resourceId: id,
      metadata: { messageId: id, status: row.status },
    });
    return { ok: true };
  });
}
