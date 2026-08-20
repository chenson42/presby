import "server-only";
// This module is server-only: it calls auth() and headers() from next/headers.
// The `import "server-only"` guard above causes the Next.js bundler to raise
// a build-time error if this module is ever imported from a Client Component
// or the Edge runtime (src/proxy.ts).
import { headers } from "next/headers";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import { getRequestIp } from "@/lib/request-ip";

export const AUDIT_ACTIONS = {
  // Existing — string values are frozen; they match live audit_events rows.
  FEATURE_FLAG_TOGGLED: "feature_flag.toggled",
  TOTP_ENROLLED: "totp.enrolled",
  TOTP_RECOVERY_CODES_REGENERATED: "totp.recovery_codes.regenerated",
  TOTP_RESET: "totp.reset",
  USER_ROLE_ASSIGNED: "user.role.assigned",
  USER_ROLE_REMOVED: "user.role.removed",
  USER_2FA_REQUIRED_CHANGED: "user.2fa_required.changed",
  USER_2FA_FORCE_RESET: "user.2fa_force_reset",
  ORG_2FA_POLICY_CHANGED: "org.2fa_policy.changed",
  // Account self-serve actions
  USER_PROFILE_UPDATED: "user.profile_updated",
  USER_EMAIL_CHANGE_REQUESTED: "user.email_change_requested",
  USER_EMAIL_CHANGED: "user.email_changed",
  USER_EMAIL_CHANGE_CANCELLED: "user.email_change_cancelled",
  USER_PASSWORD_CHANGED: "user.password_changed",
  USER_DELETION_REQUESTED: "user.deletion_requested",
  // Password-reset flow (unauthenticated; no current-password proof required)
  USER_PASSWORD_RESET_REQUESTED: "user.password_reset_requested",
  USER_PASSWORD_RESET_COMPLETED: "user.password_reset_completed",
  // TOTP verification attempts (written from src/app/(auth)/totp/actions.ts)
  TOTP_VERIFY_FAILED: "totp.verify_failed",
  TOTP_VERIFY_SUCCEEDED: "totp.verify_succeeded",
  TOTP_RECOVERY_FAILED: "totp.recovery_failed",
  TOTP_RECOVERY_SUCCEEDED: "totp.recovery_succeeded",
  // Admin user management
  USER_DEACTIVATED: "user.deactivated",
  USER_REACTIVATED: "user.reactivated",
  // Rate limiting — infrastructure event written from src/lib/rate-limit.ts.
  // The check:audit script scans only src/app/**/actions.ts; it will not see
  // this write. That is correct — do not add audit-exempt annotations to actions.ts.
  RATE_LIMIT_BLOCKED: "rate_limit.blocked",
  // Email queue — system event; written from src/lib/email/queue.ts (not an
  // actions.ts file, so not covered by the check:audit tripwire — intentional).
  EMAIL_QUEUE_PERMANENT_FAILURE: "email.queue.permanent_failure",
  // Access gate — written from src/app/access-pending/page.tsx during RSC
  // render, not from an actions.ts file. The check:audit tripwire scans only
  // src/app/**/actions.ts and will not see this write. That is intentional —
  // the page component is the audit site. This follows the RATE_LIMIT_BLOCKED
  // and EMAIL_QUEUE_PERMANENT_FAILURE precedents above.
  ACCESS_DENIED: "access.denied",
  // Account lockout — infrastructure event written from src/auth.ts authorize()
  // (not an actions.ts file, so not covered by the check:audit tripwire —
  // intentional, same pattern as RATE_LIMIT_BLOCKED and EMAIL_QUEUE_PERMANENT_FAILURE).
  USER_ACCOUNT_LOCKED: "user.account_locked",
  // Admin-initiated account unlock — written from src/app/(admin)/admin/users/actions.ts.
  // The check:audit tripwire scans that file and requires the AUDIT_ACTIONS reference.
  USER_ACCOUNT_UNLOCKED: "user.account_unlocked",
  // What's-new entries — written from src/app/(admin)/admin/whats-new/actions.ts.
  WHATS_NEW_ENTRY_CREATED: "whats_new.entry_created",
  WHATS_NEW_ENTRY_UPDATED: "whats_new.entry_updated",
  WHATS_NEW_ENTRY_DELETED: "whats_new.entry_deleted",
  // Per-org brand (P0.5 slice c2) — written from
  // src/app/(admin)/admin/organizations/[id]/actions.ts. F18: a platform
  // action against a tenant's brand carries that tenant's organization_id as
  // resourceId, or the church cannot see it. "Who made our website purple."
  ORG_BRAND_SET: "org.brand.set",
  ORG_BRAND_NEUTRALIZED: "org.brand.neutralized",
  // Tenant role administration (P9) — written from
  // src/app/(org)/o/[slug]/admin/roles/actions.ts. DECISION-067:
  // `organization_id` is recorded explicitly in `metadata` (not just
  // `resourceId`, which carries the grant id) because no tenant-facing
  // audit reader exists yet to establish a convention by example.
  TENANT_ROLE_GRANTED: "tenant.role.granted",
  TENANT_ROLE_REVOKED: "tenant.role.revoked",
  // Support tickets (2026-08-20) — written from
  // src/app/(org)/o/[slug]/tickets/actions.ts. Routine triage (status,
  // assignment, classification, area, priority) is audit-exempt by direct
  // precedent (admin/feedback/actions.ts's identical posture) — only
  // filing and feedback-promotion are audited.
  TICKET_CREATED: "tenant.ticket.created",
  TICKET_FEEDBACK_PROMOTED: "tenant.ticket.feedback_promoted",
  // Public sites (2026-08-20, docs/work-log/2026-08-20-public-sites.md) —
  // written from src/app/(admin)/admin/organizations/[id]/actions.ts
  // (provisioning/status changes, actor is the signed-in platform operator)
  // and from src/app/api/sites/ingest/route.ts (SITE_CONTENT_INGESTED only,
  // actor: null — a machine write, verified by GitHub Actions OIDC, not a
  // session). DECISION-084: the ingest route's write is intentionally
  // outside check:audit's scan scope (that tripwire scans only
  // src/app/**/actions.ts) — the fifth instance of the documented
  // RATE_LIMIT_BLOCKED/EMAIL_QUEUE_PERMANENT_FAILURE/ACCESS_DENIED/
  // USER_ACCOUNT_LOCKED precedent pattern above.
  SITE_PROVISIONED: "site.provisioned",
  SITE_STATUS_CHANGED: "site.status_changed",
  SITE_CONTENT_INGESTED: "site.content_ingested",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

// ---------------------------------------------------------------------------
// recordAudit() — centralized audit-event writer
// ---------------------------------------------------------------------------

/**
 * Explicit actor override. Pass to recordAudit() when the actor is already
 * resolved (unauthenticated flows, or sites where auth() was already called).
 */
export type AuditActorOverride = {
  userId: string | null;
  email: string | null;
};

export interface RecordAuditInput {
  /** Typed against the string-value union of AUDIT_ACTIONS. */
  action: AuditAction;
  /**
   * Actor resolution:
   *   undefined (omitted) — call auth() to get the signed-in session.
   *   { userId, email }   — explicit override (unauthenticated flows, or call
   *                         sites where auth() is already resolved; avoids a
   *                         redundant JWT read).
   *   null                — system write; no actor (seed scripts, future crons).
   */
  actor?: AuditActorOverride | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Write a row to audit_events.
 *
 * - Auto-resolves actor from the current session when `actor` is omitted.
 * - Populates `ip` and `user_agent` from the incoming request headers.
 * - Swallows all failures with `console.error` so an audit write never takes
 *   down the mutation it records.
 * - Safe to call from seed scripts and cron jobs: if `headers()` is unavailable
 *   (no request context), ip and userAgent are null and the insert still runs.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    let actorUserId: string | null = null;
    let actorEmail: string | null = null;

    if (input.actor === undefined) {
      const session = await auth();
      actorUserId = session?.user?.id ?? null;
      actorEmail = session?.user?.email ?? null;
    } else if (input.actor !== null) {
      actorUserId = input.actor.userId;
      actorEmail = input.actor.email;
    }
    // else: input.actor === null → system write; actorUserId and actorEmail
    // stay null.

    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const h = await headers();
      ip = getRequestIp(h);
      userAgent = h.get("user-agent") ?? null;
    } catch {
      // headers() is unavailable outside a request context (seed scripts,
      // scripts/). ip and userAgent stay null; the insert still runs.
    }

    await db.insert(auditEvents).values({
      actorUserId,
      actorEmail,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? {},
      ip,
      userAgent,
    });
  } catch (err) {
    // Audit failures must never take down the calling action. Log to stderr
    // so ops can see the failure in server logs (console.error is not
    // prohibited by CLAUDE.md; only console.log is banned in production paths).
    console.error("[audit] failed to write event", input.action, err);
  }
}
