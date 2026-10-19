import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { rowsOf } from "./db-util";
import { DUPLICATE_PAIRS } from "./donors";
import { countLinkProposals } from "./link-proposals";
import { statementIsLatest, statementIsStale } from "./statement-staleness";
import type { Attention, AttentionConnection, AttentionConnectionState, AttentionContext } from "./attention-pure";

/**
 * "Needs attention" - docs/work-log/2026-10-15-online-giving.md, S5 / P3-5.
 * THE ONLY DEFINITION of what the overview's attention list counts: the page
 * and any future widget call `loadAttention()`, and a test pins that what the
 * page renders is what this returns.
 *
 * Counts only - no donor, no amount, no contact detail. A recorder
 * (`giving.record` alone) sees ONE number, `linkProposals`; everything else is
 * `null` for them (S4: a recorder reads the donor picker, their own entries and
 * the link proposals, nothing about the ledger or the provider).
 *
 * What each count means:
 *   failedGifts             live-mode gifts that failed (a first ACH that
 *                           bounced), in the last 90 days
 *   stuckPending            live-mode gifts still pending after 7 days (an ACH
 *                           normally settles in about five business days)
 *   monthlyPaymentFailures  active monthly gifts whose last renewal failed - a
 *                           flag on the schedule, never a gift row (P3-16)
 *   connection              the open (or latest) provider connection's state
 *   parkedEvents/deadLetters provider events waiting on something / given up
 *                           on (`presby_giving_attention_events()`, counts only)
 *   staleStatements         latest statements a later gift or reversal has made out
 *                           of date - the derived fragments of statement-staleness.ts,
 *                           the same ones the statements page and getStale() read
 *   possibleDuplicateDonors pairs of donors that look like one giver
 *   linkProposals           donors with a waiting member-link proposal
 *
 * Test-mode (`g.livemode = false`) gifts are never counted: they are rehearsal.
 * Runs inside the caller's `withOrgContext` transaction on the RLS connection.
 */

export {
  attentionIsClear,
  type Attention,
  type AttentionConnection,
  type AttentionConnectionState,
  type AttentionContext,
} from "./attention-pure";

export async function loadAttention(tx: OrgTx, ctx: AttentionContext): Promise<Attention> {
  const { organizationId, has } = ctx;
  const linkProposals = await countLinkProposals(tx, organizationId);

  if (!has.view && !has.manage) {
    return {
      scope: "recorder",
      failedGifts: null,
      stuckPending: null,
      monthlyPaymentFailures: null,
      connection: null,
      parkedEvents: null,
      deadLetters: null,
      staleStatements: null,
      possibleDuplicateDonors: null,
      linkProposals,
    };
  }

  const gifts = rowsOf(
    await tx.execute(sql`
      select count(*) filter (where g.status = 'failed' and g.status_changed_at > now() - interval '90 days')::int as failed,
             count(*) filter (where g.status = 'pending' and g.status_changed_at < now() - interval '7 days')::int as stuck
        from giving_gifts g
       where g.organization_id = ${organizationId}::uuid and g.livemode and g.status in ('failed', 'pending')
    `),
  )[0];

  const schedules = rowsOf(
    await tx.execute(sql`
      select count(*)::int as n from giving_checkout_intents i
       where i.organization_id = ${organizationId}::uuid and i.livemode and i.frequency = 'monthly'
         and i.subscription_id is not null and i.subscription_ended_at is null
         and i.last_payment_failed_at is not null
    `),
  )[0];

  const connectionRow = rowsOf(
    await tx.execute(sql`
      select status, livemode, requirements_due, (public_enabled_at is not null) as public_on
        from giving_provider_connections
       where organization_id = ${organizationId}::uuid
       order by (status <> 'disconnected') desc, created_at desc
       limit 1
    `),
  )[0];
  const connection: AttentionConnection = connectionRow
    ? {
        state: connectionRow.status as AttentionConnectionState,
        testMode: connectionRow.livemode !== true,
        requirementsDue: connectionRow.requirements_due === true,
        publicPageOn: connectionRow.public_on === true && connectionRow.status !== "disconnected",
      }
    : { state: "none", testMode: false, requirementsDue: false, publicPageOn: false };

  const events = rowsOf(await tx.execute(sql`select * from presby_giving_attention_events()`))[0];

  const stale = rowsOf(
    await tx.execute(sql`
      select count(*)::int as n from giving_statements s
       where s.organization_id = ${organizationId}::uuid and ${statementIsLatest} and ${statementIsStale}
    `),
  )[0];

  const duplicates = rowsOf(
    await tx.execute(sql`select count(*)::int as n from (${DUPLICATE_PAIRS(organizationId)}) x`),
  )[0];

  return {
    scope: "full",
    failedGifts: Number(gifts?.failed ?? 0),
    stuckPending: Number(gifts?.stuck ?? 0),
    monthlyPaymentFailures: Number(schedules?.n ?? 0),
    connection,
    parkedEvents: Number(events?.parked_count ?? 0),
    deadLetters: Number(events?.dead_letter_count ?? 0),
    staleStatements: Number(stale?.n ?? 0),
    possibleDuplicateDonors: Number(duplicates?.n ?? 0),
    linkProposals,
  };
}
