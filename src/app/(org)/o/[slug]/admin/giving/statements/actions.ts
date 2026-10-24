"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { gateGivingAction, invalidInput, type GivingActionResult } from "@/lib/giving/action-gate";
import {
  issueStatementBatch,
  recordDelivery,
  reissueStatement,
  sendStatementNotices,
  type IssueFailureReason,
  type StatementBlocker,
} from "@/lib/giving/statements";

/**
 * Server Actions for `/o/<slug>/admin/giving/statements` - docs/work-log/
 * 2026-10-15-online-giving.md, Batch 5b. Shared gate first (sign-in -> Node-side
 * 2FA -> org resolve -> toggle -> key), then validation, then ONE library call,
 * then the audit write AFTER the commit and only for what actually happened.
 *
 * `giving.manage` is the gate here; issue and re-issue additionally need
 * `giving.view` - the library re-checks both inside its own transaction and the
 * database's insert guard refuses an issuer without both (0056 S1).
 *
 * Audit metadata is ids, the year and counts - never a donor's name, address or
 * email, and never an amount (a statement's contents stay out of every log).
 */

const uuid = z.guid();
const yearSchema = z.number().int().min(2000).max(2100);

const issueInput = z.object({ year: yearSchema, cursor: uuid.nullish() });
const noticeInput = z.object({ year: yearSchema, cursor: uuid.nullish() });

const BLOCKER_TEXT: Record<StatementBlocker, string> = {
  donee_name: "the church's legal name",
  donee_address: "a complete mailing address",
};

function blockedMessage(blockers: StatementBlocker[]): string {
  return `Statements can't be issued yet. Add ${blockers.map((b) => BLOCKER_TEXT[b]).join(" and ")} on the Statement details page first.`;
}

const DISABLED_MESSAGE =
  "Statements can't be issued on this site yet. They are switched on once your accountant has reviewed the statement wording.";

export interface IssueBatchData {
  issued: number;
  skipped: number;
  failed: Array<{ donorId: string; donorName: string; reason: IssueFailureReason }>;
  nextCursor: string | null;
}

export async function issueStatementBatchAction(
  slug: string,
  input: unknown,
): Promise<GivingActionResult<IssueBatchData>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = issueInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await issueStatementBatch(gate.personId, gate.organizationId, gate.userId, {
    year: parsed.data.year,
    cursor: parsed.data.cursor ?? null,
  });
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "Issuing statements needs both manage and view access to Giving." };
    case "disabled":
      return { ok: false, error: DISABLED_MESSAGE };
    case "invalid_year":
      return { ok: false, error: "Choose a year that has ended or is under way." };
    case "blocked":
      return { ok: false, error: blockedMessage(result.blockers) };
    case "ok":
      break;
  }

  for (const statement of result.issuedStatements) {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_STATEMENT_ISSUED,
      resourceType: "giving_statement",
      resourceId: statement.statementId,
      metadata: {
        organizationId: gate.organizationId,
        statementId: statement.statementId,
        donorId: statement.donorId,
        taxYear: parsed.data.year,
        version: statement.version,
      },
    });
  }
  revalidatePath(`/o/${slug}/admin/giving/statements`);
  revalidatePath(`/o/${slug}/admin/giving`);
  return {
    ok: true,
    data: { issued: result.issued, skipped: result.skipped, failed: result.failed, nextCursor: result.nextCursor },
  };
}

export async function reissueStatementAction(
  slug: string,
  statementId: unknown,
): Promise<GivingActionResult<{ statementId: string; version: number }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = uuid.safeParse(statementId);
  if (!parsed.success) return { ok: false, error: "That statement no longer exists." };

  const result = await reissueStatement(gate.personId, gate.organizationId, gate.userId, parsed.data);
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "Issuing a corrected statement needs both manage and view access to Giving." };
    case "disabled":
      return { ok: false, error: DISABLED_MESSAGE };
    case "blocked":
      return { ok: false, error: blockedMessage(result.blockers) };
    case "not_found":
      return { ok: false, error: "That statement no longer exists." };
    case "not_latest":
      return { ok: false, error: "A newer version of this statement has already been issued." };
    case "not_stale":
      return { ok: false, error: "That statement is up to date, so it doesn't need a correction." };
    case "already_reissued":
      return { ok: false, error: "Someone else just issued a correction for this statement. Reload to see it." };
    case "nothing_to_count":
      return {
        ok: false,
        error:
          "Every gift on this statement has since been refunded, so there is nothing to put on a corrected statement. Contact the donor directly.",
      };
    case "failed":
      return { ok: false, error: "We couldn't issue the corrected statement. Nothing was changed; try again in a moment." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.GIVING_STATEMENT_REISSUED,
    resourceType: "giving_statement",
    resourceId: result.statementId,
    metadata: {
      organizationId: gate.organizationId,
      statementId: result.statementId,
      supersedesId: parsed.data,
      version: result.version,
    },
  });
  revalidatePath(`/o/${slug}/admin/giving/statements`);
  revalidatePath(`/o/${slug}/admin/giving`);
  return { ok: true, data: { statementId: result.statementId, version: result.version } };
}

export async function recordDeliveryAction(slug: string, statementId: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = uuid.safeParse(statementId);
  if (!parsed.success) return { ok: false, error: "That statement no longer exists." };

  const result = await recordDelivery(gate.personId, gate.organizationId, gate.userId, parsed.data);
  if (result.kind === "forbidden") return { ok: false, error: "You don't have permission to do that." };
  if (result.kind === "not_found") return { ok: false, error: "That statement no longer exists." };

  if (!result.alreadyRecorded) {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_STATEMENT_DELIVERY_RECORDED,
      resourceType: "giving_statement",
      resourceId: parsed.data,
      metadata: { organizationId: gate.organizationId, statementId: parsed.data, channel: "print_mailed" },
    });
  }
  revalidatePath(`/o/${slug}/admin/giving/statements`);
  return { ok: true };
}

export interface SendNoticesData {
  sent: number;
  skipped: number;
  failed: number;
  nextCursor: string | null;
}

export async function sendStatementNoticesAction(
  slug: string,
  input: unknown,
): Promise<GivingActionResult<SendNoticesData>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = noticeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await sendStatementNotices(gate.personId, gate.organizationId, gate.userId, {
    year: parsed.data.year,
    cursor: parsed.data.cursor ?? null,
  });
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: "You don't have permission to send notices here." };
    case "invalid_year":
      return { ok: false, error: "Choose a year that has ended or is under way." };
    case "origin_unconfigured":
      return {
        ok: false,
        error: "This site has no secure web address configured, so there is no safe link to put in the email. Ask the platform administrator.",
      };
    case "ok":
      break;
  }

  if (result.sent > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_STATEMENT_NOTICE_SENT,
      resourceType: "giving_statements",
      resourceId: gate.organizationId,
      metadata: {
        organizationId: gate.organizationId,
        taxYear: parsed.data.year,
        sent: result.sent,
        statementIds: result.sentStatements.map((s) => s.statementId),
      },
    });
  }
  revalidatePath(`/o/${slug}/admin/giving/statements`);
  return { ok: true, data: { sent: result.sent, skipped: result.skipped, failed: result.failed, nextCursor: result.nextCursor } };
}
