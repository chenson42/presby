import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { getPersonEmail } from "@/lib/contact-methods/reader";
import { platformOrigin } from "@/lib/domains/host";
import { attemptQueuedSend, insertQueueRowInTx } from "@/lib/email/queue";
import {
  buildCancelledMessage,
  buildDeclinedMessage,
  buildRequestMessage,
  worshipLinks,
  type RequestLine,
} from "./messages";
import { rowsOf } from "./sql-util";
import type { NoticeOutcome } from "./vocab";

/**
 * Who is told, and how - docs/work-log/2026-11-04-worship-inc1.md, Phase 3
 * "Email (R10)" and DECISION-320. The senders: the request (one per person per
 * Send), the cancel notice and the decline notice. The reminder is `sweep.ts`'s.
 *
 * THE TWO HALVES (the invitation and reimbursement shape):
 *   queue*(tx, ...)    inside the causing transaction. One `email_queue` row
 *                      per person, committed or rolled back WITH the state
 *                      change, so a request can never have been marked sent
 *                      with its email lost nor an email exist for a rolled-back
 *                      change. A queue write that fails throws and rolls the
 *                      transaction back (stated behaviour).
 *   sendQueued(ids)    AFTER the commit. Attempts the inline send; never
 *                      throws. A failed send leaves the row `queued` for the
 *                      five-minute worker. The cancel path never sends inline
 *                      (it runs inside another module's transaction).
 *
 * ADDRESS. `getPersonEmail(tx, id, "role")`: the person's Work address first,
 * never one marked do-not-contact (the `person:role` audience of
 * `email-audience.ts`). A Work-labelled address receives scheduling mail
 * (accepted residual: the volunteer can mark it do not contact, or an
 * administrator can relabel it).
 *
 * NO NOTICE OF ANY KIND to a presumed minor (R9, DECISION-322): the one shared
 * predicate `presby_photo_subject_is_minor`, never a second definition. The
 * leader sees `guardian` and records the answer.
 *
 * ORIGIN. `platformOrigin()`, never the request host. When it is null NO notice
 * is written here; `store.sendRequests` refuses a Send up front
 * (`mail_unavailable`), and the cancel and decline notices simply write
 * nothing while the change still commits.
 *
 * CONTENT. None that is a person's: see `messages.ts`.
 */

export interface ReachDecision {
  outcome: NoticeOutcome;
  /** Set only when `outcome` is `emailed`. */
  address: string | null;
}

/** True when the person is presumed under 18 at this organization (the one shared predicate). */
export async function isPresumedMinor(tx: OrgTx, organizationId: string, personId: string): Promise<boolean> {
  const row = rowsOf(
    await tx.execute(
      sql`select presby_photo_subject_is_minor(${organizationId}::uuid, ${personId}::uuid) as minor`,
    ),
  )[0];
  return row?.minor === true;
}

/**
 * What a request to this person will do. A presumed minor first (`guardian`,
 * regardless of any address), then the address: a Work-first, not-do-not-contact
 * address is `emailed`; otherwise `do_not_contact` when the person's main
 * address exists and is marked so, else `no_address`.
 *
 * `role` never returns a do-not-contact address, so the two refusals are told
 * apart with the main (`credential`) row: with no usable address, a main row
 * that exists must be the do-not-contact one (every active address is).
 */
export async function decideReach(tx: OrgTx, organizationId: string, personId: string): Promise<ReachDecision> {
  if (await isPresumedMinor(tx, organizationId, personId)) return { outcome: "guardian", address: null };
  const role = await getPersonEmail(tx, personId, "role");
  if (role && !role.doNotContact) return { outcome: "emailed", address: role.address };
  const main = await getPersonEmail(tx, personId, "credential");
  return { outcome: main ? "do_not_contact" : "no_address", address: null };
}

/** The organization's name and slug, for a notice. */
export async function organizationFacts(
  tx: OrgTx,
  organizationId: string,
): Promise<{ name: string; slug: string } | null> {
  const row = rowsOf(
    await tx.execute(sql`select name, slug from organizations where id = ${organizationId}::uuid`),
  )[0];
  return row ? { name: String(row.name), slug: String(row.slug) } : null;
}

export interface PersonRequestNotice {
  personId: string;
  address: string;
  /** Their assignments in this Send, in display order. */
  lines: RequestLine[];
  assignmentIds: string[];
}

/**
 * One request email per person (people who share an inbox each get their own).
 * Returns the queue ids. Writes nothing when there is no safe origin or no
 * organization row.
 */
export async function queueRequestNotices(
  tx: OrgTx,
  input: { organizationId: string; notices: readonly PersonRequestNotice[] },
): Promise<string[]> {
  const origin = platformOrigin();
  if (origin === null || input.notices.length === 0) return [];
  const org = await organizationFacts(tx, input.organizationId);
  if (org === null) return [];
  const queued: string[] = [];
  for (const notice of input.notices) {
    const link =
      notice.assignmentIds.length === 1
        ? worshipLinks.request(origin, org.slug, notice.assignmentIds[0]!)
        : worshipLinks.home(origin, org.slug);
    const worshipMessage = buildRequestMessage({ organizationName: org.name, lines: notice.lines, link });
    const row = await insertQueueRowInTx(tx, {
      to: notice.address,
      message: worshipMessage.message,
      templateKey: worshipMessage.templateKey,
    });
    queued.push(row.id);
  }
  return queued;
}

/**
 * The cancel notice to each of `personIds` (distinct), skipping presumed minors
 * and people with no deliverable address. Returns the queue ids. The caller
 * has already checked the toggle.
 */
export async function queueCancelledNotices(
  tx: OrgTx,
  input: { organizationId: string; startsAt: string; personIds: readonly string[] },
): Promise<string[]> {
  const origin = platformOrigin();
  if (origin === null || input.personIds.length === 0) return [];
  const org = await organizationFacts(tx, input.organizationId);
  if (org === null) return [];
  const queued: string[] = [];
  for (const personId of [...new Set(input.personIds)]) {
    const reach = await decideReach(tx, input.organizationId, personId);
    if (reach.outcome !== "emailed" || reach.address === null) continue;
    const worshipMessage = buildCancelledMessage({
      organizationName: org.name,
      startsAt: input.startsAt,
      link: worshipLinks.home(origin, org.slug),
    });
    const row = await insertQueueRowInTx(tx, {
      to: reach.address,
      message: worshipMessage.message,
      templateKey: worshipMessage.templateKey,
    });
    queued.push(row.id);
  }
  return queued;
}

/**
 * The decline notice to the person who placed the decliner, when they have a
 * deliverable address and are not themselves the decliner. Never names the
 * decliner. Returns the queue ids (zero or one).
 */
export async function queueDeclinedNotice(
  tx: OrgTx,
  input: {
    organizationId: string;
    toPersonId: string;
    groupId: string;
    eventId: string;
    positionName: string;
    startsAt: string;
  },
): Promise<string[]> {
  const origin = platformOrigin();
  if (origin === null) return [];
  const org = await organizationFacts(tx, input.organizationId);
  if (org === null) return [];
  const reach = await decideReach(tx, input.organizationId, input.toPersonId);
  if (reach.outcome !== "emailed" || reach.address === null) return [];
  const worshipMessage = buildDeclinedMessage({
    organizationName: org.name,
    positionName: input.positionName,
    startsAt: input.startsAt,
    link: worshipLinks.board(origin, org.slug, input.groupId, input.eventId),
  });
  const row = await insertQueueRowInTx(tx, {
    to: reach.address,
    message: worshipMessage.message,
    templateKey: worshipMessage.templateKey,
  });
  return [row.id];
}

/**
 * The post-commit inline send for rows the `queue*` functions wrote. Never
 * throws: a failed attempt (and one that throws) leaves the row `queued` for
 * the worker, and nothing the leader or the volunteer did is undone.
 */
export async function sendQueued(queueIds: ReadonlyArray<string>): Promise<void> {
  await Promise.allSettled(queueIds.map((id) => attemptQueuedSend(id)));
}
