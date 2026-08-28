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
  // Org creation (docs/work-log/2026-08-24-admin-org-create.md) — written
  // from src/app/(admin)/admin/organizations/new/actions.ts. F18 (same
  // precedent as ORG_BRAND_SET): a platform action against a tenant carries
  // that tenant's organization_id as resourceId, so the church can
  // eventually see platform actions against it, even though there is no
  // tenant to see it yet at the moment of creation.
  ORG_CREATED: "org.created",
  // Per-org feature toggles (docs/work-log/2026-08-25-member-management.md
  // Deliverable A, DECISION-097) — written from
  // src/app/(org)/o/[slug]/admin/features/actions.ts. A
  // permission/access-control-adjacent mutation, audited like
  // TENANT_ROLE_GRANTED. Metadata: { organizationId, featureKey, enabled }.
  ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled",
  // Org feature CATEGORIES — the fourth, coarser gating axis (docs/work-log/
  // 2026-08-27-feature-categories.md, Phase 3; DECISION-130) — written from
  // src/app/(org)/o/[slug]/admin/features/actions.ts's
  // toggleFeatureCategoryAction(), NOT from src/lib/org-feature-categories.ts
  // itself (a deliberate divergence from ORG_FEATURE_TOGGLED's own
  // audit-in-lib split, forced by that module's one-directional dependency on
  // org-features.ts — see toggleOrgFeatureCategory()'s own header comment).
  // Metadata: { organizationId, category, enabled, affectedFeatureKeys },
  // naming every ORG_FEATURE_CATALOG key the category mutation affects
  // rather than one opaque event (architect's Phase 2 conditional approval of
  // reusing org_features.manage for this mutation).
  ORG_FEATURE_CATEGORY_TOGGLED: "tenant.org_feature_category.toggled",
  // Member management, Increment 1 (docs/work-log/
  // 2026-08-25-member-management.md Deliverable B, Phase 2 open-question (b))
  // — written from src/app/(org)/o/[slug]/admin/members/pending/actions.ts.
  // A roll action outranks a role grant in constitutional weight, so
  // approve/deny get their own audited events even though routine roll-read
  // access does not.
  ROLL_ACTION_APPROVED: "tenant.roll_action.approved",
  ROLL_ACTION_DENIED: "tenant.roll_action.denied",
  // Member management, Increment 2 (docs/work-log/
  // 2026-08-26-member-management-edit-person.md) — written from
  // src/app/(org)/o/[slug]/admin/members/[id]/edit/actions.ts. Identity,
  // contact, address, and household are tier-1 data, but still
  // identity-adjacent and worth a record of who changed what and when —
  // same tier as ORG_FEATURE_TOGGLED, not elevated to the roll actions'
  // constitutional weight.
  PERSON_UPDATED: "tenant.person.updated",
  // Officer-terms administration (docs/work-log/
  // 2026-08-26-groups-and-officers.md, Phase 3/4 commit 2) — written from
  // src/app/(org)/o/[slug]/admin/officers/actions.ts. Starting or ending a
  // Session/Diaconate term is a de facto access change (it flows through
  // the derived group into whatever that group's role_grants carry), so
  // these are audited like TENANT_ROLE_GRANTED/REVOKED even though the
  // written row is officer_terms, not role_grants.
  OFFICER_TERM_STARTED: "tenant.officer_term.started",
  OFFICER_TERM_ENDED: "tenant.officer_term.ended",
  // Tenant-facing brand editor (docs/work-log/
  // 2026-08-26-tenant-branding-permission.md, Phase 3/4 commit 2) — written
  // from src/app/(org)/o/[slug]/admin/branding/actions.ts. A DISTINCT key
  // from ORG_BRAND_SET, not a reuse: every existing audit key distinguishes
  // which axis the actor is on by prefix — `org.*` for platform-initiated
  // actions against a tenant, `tenant.*` for tenant-initiated self-service
  // actions (same convention TENANT_ROLE_GRANTED/ORG_FEATURE_TOGGLED/
  // OFFICER_TERM_STARTED already establish). Reusing ORG_BRAND_SET here
  // would collapse the one signal ("who changed our brand, the platform or
  // the church") an audit reader exists to answer for this resource. No
  // tenant-side neutralize key exists or should be built — neutralize stays
  // platform-only (DECISION-101).
  TENANT_BRAND_SET: "tenant.brand.set",
  // Member edit: tiered sensitive information (docs/work-log/
  // 2026-08-26-member-sensitive-info.md, DECISION-108) — written from
  // src/lib/person-sensitive.ts. All four tables are tier-3 mutations and
  // must fire recordAudit() with no exemption (architect's Phase 2 ruling).
  // Distinct per-table keys, same "tenant.*" axis convention as
  // TENANT_ROLE_GRANTED/TENANT_BRAND_SET (a tenant-initiated self-service
  // action, not a platform action against a tenant).
  TENANT_PERSON_NOTE_ADDED: "tenant.person_note.added",
  TENANT_PERSON_DEMOGRAPHICS_UPDATED: "tenant.person_demographics.updated",
  TENANT_PERSON_MEDICAL_UPDATED: "tenant.person_medical.updated",
  TENANT_PERSON_DISABILITY_SET: "tenant.person_disability.set",
  // Role & permissions administration (docs/work-log/
  // 2026-08-26-role-permissions-admin.md, DECISION-106/109) — written from
  // src/app/(org)/o/[slug]/admin/roles/new/actions.ts and
  // src/app/(org)/o/[slug]/admin/roles/[id]/edit/actions.ts. A DISTINCT
  // `tenant.role_definition.*` prefix from TENANT_ROLE_GRANTED/REVOKED's
  // `tenant.role.*` — assignment (who holds a role) and definition (what a
  // role contains) are two different axes (DECISION-106), and collapsing
  // the audit prefix would collapse the one signal an eventual tenant audit
  // reader needs to tell them apart.
  ROLE_DEFINITION_CREATED: "tenant.role_definition.created",
  // Metadata: { organizationId, roleKey, permissionKeys }.
  ROLE_DEFINITION_PERMISSIONS_CHANGED: "tenant.role_definition.permissions_changed",
  // Metadata: { organizationId, addedKeys, removedKeys, holderCount } —
  // holderCount is Phase 1 Flow 3's explicit ask: editing a role's bindings
  // retroactively changes what every CURRENT holder can do, with no new
  // role_grants row of its own, so the audit event carries the affected
  // count rather than leaving it implicit.
  ROLE_DEFINITION_DEACTIVATED: "tenant.role_definition.deactivated",
  // Metadata: { organizationId, endedGrantCount } — deactivation also ends
  // every live role_grants row pointing at the role in the same
  // transaction (DECISION-109 finding 3); endedGrantCount records how many.
  ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE: "tenant.role_definition.adopted_from_template",
  // Metadata: { organizationId, roleKey, templateRoleId, templateKey }.
  // Groups administration (docs/work-log/2026-08-26-groups-admin.md, Phase 3/
  // 4 commit 2) — written from
  // src/app/(org)/o/[slug]/admin/groups/actions.ts. `role_grants.group_id`
  // can bind a role to any group, managed or derived — adding/removing a
  // person from a managed group that happens to carry a role grant is a de
  // facto access change, so these are audited like
  // OFFICER_TERM_STARTED/ENDED even though the written row is
  // groups/group_memberships, not officer_terms.
  GROUP_CREATED: "tenant.group.created",
  // Metadata: { organizationId, groupTypeId, name }.
  GROUP_UPDATED: "tenant.group.updated",
  // Metadata: { organizationId, groupId, name }.
  GROUP_MEMBER_ADDED: "tenant.group_membership.added",
  // Metadata: { organizationId, groupId, personId, groupRole, startsOn }.
  GROUP_MEMBER_ENDED: "tenant.group_membership.ended",
  // Metadata: { organizationId, groupId, personId, groupName, endsOn }.
  // Children's ministry, Increment A (docs/work-log/
  // 2026-08-26-childrens-ministry.md, DECISION-111/114) — written from
  // src/lib/children.ts. The first application-level read/write surface
  // `person_relationships` has ever had; every mutation is audited (Phase 2
  // ruling), no exemption. Reads are never audited, same posture as
  // TENANT_PERSON_NOTE_ADDED's sibling table.
  TENANT_PERSON_RELATIONSHIP_ADDED: "tenant.person_relationship.added",
  // Metadata: { organizationId, childPersonId, relationship }.
  TENANT_PERSON_RELATIONSHIP_UPDATED: "tenant.person_relationship.updated",
  // Metadata: { organizationId, childPersonId, relationship }.
  TENANT_PERSON_RELATIONSHIP_REMOVED: "tenant.person_relationship.removed",
  // Metadata: { organizationId, childPersonId }.
  // Ministry credentials & pastoral appointments (docs/work-log/
  // 2026-08-26-presbytery-functionality.md, Increment 2 — DECISION-112/116)
  // — written from src/app/(org)/o/[slug]/admin/credentials/actions.ts.
  // ORDINATION_RECORDED is a Phase 3 addition beyond DECISION-112's own
  // notes (which named only the status-change/appointment keys): the FIRST
  // application write path this codebase has ever had to `ordinations` —
  // a new credential attaching to a person is a polity action with real
  // weight, same tier as OFFICER_TERM_STARTED, so it gets its own audited
  // event rather than riding along silently.
  ORDINATION_RECORDED: "tenant.ordination.recorded",
  // Metadata: { organizationId, personId, ministry, ordainedOn }.
  // Fires on EVERY changeOrdinationStatus() call, including the "End
  // ordination" UI control's status: "removed" submission — see
  // src/lib/credentials.ts's header for why that shares this one key/
  // function rather than getting a distinct ORDINATION_ENDED key.
  ORDINATION_STATUS_CHANGED: "tenant.ordination.status_changed",
  // Metadata: { organizationId, personId, ordinationId, status }.
  APPOINTMENT_RECORDED: "tenant.appointment.recorded",
  // Metadata: { organizationId, personId, servingOrgId, callType, startsOn }.
  APPOINTMENT_ENDED: "tenant.appointment.ended",
  // Metadata: { organizationId, appointmentId, personId, servingOrgId, endsOn }.
  // Presbytery oversight & statistics, Increments 3/3b (docs/work-log/
  // 2026-08-27-presbytery-program.md, DECISION-118 through 121) — written
  // from src/app/(org)/o/[slug]/admin/oversight/actions.ts and
  // .../admin/reports/actions.ts. ONE key per table, regardless of insert
  // vs. update (same discipline TENANT_PERSON_DEMOGRAPHICS_UPDATED already
  // uses for its own upsert) — the audited fact is "this record changed,"
  // not which SQL verb changed it.
  CONGREGATION_OVERSIGHT_SET: "tenant.congregation_oversight.set",
  // Metadata: { organizationId, aboutOrgId, viabilityScore }.
  CONGREGATION_STATISTICS_ENTERED: "tenant.congregation_statistics.entered",
  // Metadata: { organizationId, aboutOrgId, year }.
  PER_CAPITA_RATE_SET: "tenant.per_capita_rate.set",
  // Metadata: { organizationId, billingYear, basisYear, ratePerMember }.
  // Beyond Phase 1's own named audit list (rate-set, record-marked-paid) —
  // batch-generating records is itself a financial-stakes write (it issues
  // bills), audited for the same reason Phase 1's Gaps section calls for
  // auditing oversight/publication writes "even beyond Rule-7's letter."
  PER_CAPITA_RECORDS_GENERATED: "tenant.per_capita_records.generated",
  // Metadata: { organizationId, billingYear, created, skipped }.
  PER_CAPITA_PAYMENT_RECORDED: "tenant.per_capita_payment.recorded",
  // Metadata: { organizationId, recordId, paidAmount, paidStatus }.
  // Public staff & leadership directory (docs/work-log/
  // 2026-08-27-public-staff-directory.md, Phase 2 ruling 6b) — written from
  // src/lib/staff.ts's setStaffPositionPublicListed() and src/lib/
  // officers.ts's setOfficerTermPublicListed(), NOT from either module's
  // actions.ts (a deliberate divergence from OFFICER_TERM_STARTED/ENDED's
  // own actions.ts-does-audit split in officers.ts specifically — see that
  // function's own header comment). Not an access-change fact (DECISION-129's
  // own test doesn't transfer), but a DISCLOSURE fact Rule 7 covers by
  // spirit: the bit exposes a person's name/role/photo to the entire
  // unauthenticated internet. On/off-pair shape, matching ORG_BRAND_SET/
  // NEUTRALIZED — the direction is the fact worth searching audit history
  // for. Metadata: { organizationId, publicListed }.
  STAFF_POSITION_LISTED_PUBLICLY: "staff_position.listed_publicly",
  STAFF_POSITION_UNLISTED_PUBLICLY: "staff_position.unlisted_publicly",
  OFFICER_TERM_LISTED_PUBLICLY: "officer_term.listed_publicly",
  OFFICER_TERM_UNLISTED_PUBLICLY: "officer_term.unlisted_publicly",
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
