import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { getPersonEmail } from "@/lib/contact-methods/reader";
import { platformOrigin } from "@/lib/domains/host";
import { attemptQueuedSend, insertQueueRowInTx } from "@/lib/email/queue";
import { rowsOf } from "./db-util";
import { buildNotice, noticeLink, noticeSurface, type NoticeSpec } from "./notices";

/**
 * Who is told, and how - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * file plan (`notify.ts`), P3-11, EC22. The recipients are ALWAYS the definer's
 * return values (the eligible approvers computed in the submit definer, the pay
 * holders and the creator computed in the approve and return definers): this
 * file never decides who should be told, it only delivers.
 *
 * THE TWO HALVES (the invitation shape, `onboarding/issue.ts`):
 *   queueNotices(tx, ...)   inside the transition's own transaction. One
 *                           `email_queue` row per recipient, committed or rolled
 *                           back WITH the state change, so a request can never
 *                           have moved with its notice lost nor a notice exist
 *                           for a move that was rolled back.
 *   sendQueuedNotices(ids)  AFTER the commit. Attempts the inline send for each
 *                           row; never throws. A failed send leaves the row
 *                           `queued` for the worker's retry.
 *
 * ADDRESS: `getPersonEmail(tx, id, "role")` - the person's Work address first,
 * never one marked do-not-contact (`email-audience.ts`: `person:role`). A
 * recipient with no deliverable address gets NO row and NO error: the in-app
 * queue and the request page are the fallback, and the transition is never
 * held hostage to an inbox.
 *
 * ORIGIN: `platformOrigin()`, never the request host. When it is null (a
 * misconfigured production) NO notice is written and the transition still
 * commits (EC22).
 *
 * CONTENT: none. `buildNotice(spec, link)` takes a closed spec and a link; the
 * message carries nothing about the request (see `notices.ts`).
 */

export interface NoticeBatch {
  spec: NoticeSpec;
  /** Person ids from a definer's return value. Duplicates and blanks are tolerated. */
  personIds: ReadonlyArray<string | null | undefined>;
}

async function organizationSlug(tx: OrgTx, organizationId: string): Promise<string | null> {
  const rows = rowsOf(await tx.execute(sql`select slug from organizations where id = ${organizationId}::uuid`));
  const slug = rows[0]?.slug;
  return typeof slug === "string" ? slug : null;
}

/**
 * Queue the notices for one transition inside `tx`. Returns the ids of the
 * `email_queue` rows written, for `sendQueuedNotices` after the commit. Empty
 * (and writes nothing) when there is no safe origin, no organization slug, or no
 * recipient with a deliverable address.
 */
export async function queueNotices(
  tx: OrgTx,
  input: { organizationId: string; requestId: string; batches: ReadonlyArray<NoticeBatch> },
): Promise<string[]> {
  const origin = platformOrigin();
  if (origin === null) return [];
  const live = input.batches.filter((b) => b.personIds.some((id) => typeof id === "string" && id !== ""));
  if (live.length === 0) return [];
  const slug = await organizationSlug(tx, input.organizationId);
  if (slug === null) return [];

  const queued: string[] = [];
  for (const batch of live) {
    const link = noticeLink(origin, slug, input.requestId, noticeSurface(batch.spec));
    const built = buildNotice(batch.spec, link);
    const addressed = new Set<string>();
    const people = [...new Set(batch.personIds.filter((id): id is string => typeof id === "string" && id !== ""))];
    for (const personId of people) {
      const email = await getPersonEmail(tx, personId, "role");
      if (!email || email.doNotContact) continue;
      const key = email.address.toLowerCase();
      // Two people who share one inbox are told once per notice.
      if (addressed.has(key)) continue;
      addressed.add(key);
      const row = await insertQueueRowInTx(tx, {
        to: email.address,
        message: built.message,
        templateKey: built.templateKey,
      });
      queued.push(row.id);
    }
  }
  return queued;
}

/**
 * The post-commit inline send for rows `queueNotices` wrote. Never throws: a
 * failed attempt (and one that throws) leaves the row `queued` for the queue
 * worker, and nothing the requester or approver did is undone.
 */
export async function sendQueuedNotices(queueIds: ReadonlyArray<string>): Promise<void> {
  await Promise.allSettled(queueIds.map((id) => attemptQueuedSend(id)));
}
