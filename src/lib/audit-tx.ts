import "server-only";
import { headers } from "next/headers";
import { auditEvents } from "@/lib/db/schema";
import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit";
import type { OrgTx } from "@/lib/authz";
import { getRequestIp } from "@/lib/request-ip";

/**
 * Writes one `audit_events` row INSIDE the caller's transaction (R8).
 *
 * Not `recordAudit()`: that opens its own connection and swallows failures, so
 * a transition could commit with no audit row. Here the audit insert shares
 * the state change's transaction, so the two commit or roll back together - a
 * failed audit insert fails the change, which is the point. The same helper
 * serves the tenant tx (`presby_app` holds INSERT on audit_events) and the
 * platform tx.
 *
 * `ip` / `userAgent` are best-effort from the request when there is one (a
 * cron or a test has none).
 */

export type AuditActor =
  | { userId: string; email: string | null }
  | null;

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return { ip: getRequestIp(h), userAgent: h.get("user-agent") ?? null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function insertAuditRow(
  tx: OrgTx,
  input: {
    action: AuditAction;
    actor: AuditActor;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const meta = await requestMeta();
  await tx.insert(auditEvents).values({
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/**
 * The multi-row variant of `insertAuditRow()` (parish management, bulk move:
 * one row per household plus one batch row, DECISION-245). ONE multi-row
 * insert inside the caller's transaction, so a hundred rows are one round trip
 * and a failure of any of them fails the change. An empty list writes nothing.
 */
export async function insertAuditRows(
  tx: OrgTx,
  inputs: Array<{
    action: AuditAction;
    actor: AuditActor;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }>,
): Promise<void> {
  if (inputs.length === 0) return;
  const meta = await requestMeta();
  await tx.insert(auditEvents).values(
    inputs.map((input) => ({
      actorUserId: input.actor?.userId ?? null,
      actorEmail: input.actor?.email ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
      ip: meta.ip,
      userAgent: meta.userAgent,
    })),
  );
}

export { AUDIT_ACTIONS };
