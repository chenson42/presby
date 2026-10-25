/**
 * Tests for src/lib/audit.ts
 *
 * Two test suites:
 * 1. AUDIT_ACTIONS catalog — regression guard for audit-string drift.
 * 2. recordAudit() — unit tests for actor resolution, IP extraction,
 *    failure swallowing, and no-request-context graceful handling.
 */

// vi.mock() calls are hoisted before imports by Vitest's transform.
// These mocks must be declared before any import that transitively pulls in
// the mocked modules (including the `import "server-only"` in audit.ts).

// server-only: build-time bundler guard only; not enforced at runtime in
// Node.js/vitest. Mock to prevent any version that does throw from breaking tests.
vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  auditEvents: {},
}));

vi.mock("@/lib/request-ip", () => ({
  getRequestIp: vi.fn(),
}));

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { AUDIT_ACTIONS, recordAudit } from "./audit";
import { auth } from "@/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getRequestIp } from "@/lib/request-ip";

// ---------------------------------------------------------------------------
// AUDIT_ACTIONS catalog — regression for audit-string drift
//
// If any entry is renamed, added, or removed, this test fails before a stale
// audit_events row is written to the DB with a bad action string.
// ---------------------------------------------------------------------------

const EXPECTED_ENTRIES: Record<keyof typeof AUDIT_ACTIONS, string> = {
  FEATURE_FLAG_TOGGLED: "feature_flag.toggled",
  TOTP_ENROLLED: "totp.enrolled",
  TOTP_RECOVERY_CODES_REGENERATED: "totp.recovery_codes.regenerated",
  TOTP_RESET: "totp.reset",
  USER_ROLE_ASSIGNED: "user.role.assigned",
  USER_ROLE_REMOVED: "user.role.removed",
  USER_2FA_REQUIRED_CHANGED: "user.2fa_required.changed",
  USER_2FA_FORCE_RESET: "user.2fa_force_reset",
  ORG_2FA_POLICY_CHANGED: "org.2fa_policy.changed",
  // Account self-serve actions (added with /account page feature)
  USER_PROFILE_UPDATED: "user.profile_updated",
  USER_EMAIL_CHANGE_REQUESTED: "user.email_change_requested",
  USER_EMAIL_CHANGED: "user.email_changed",
  USER_EMAIL_CHANGE_CANCELLED: "user.email_change_cancelled",
  USER_PASSWORD_CHANGED: "user.password_changed",
  USER_DELETION_REQUESTED: "user.deletion_requested",
  // Password-reset flow (unauthenticated)
  USER_PASSWORD_RESET_REQUESTED: "user.password_reset_requested",
  USER_PASSWORD_RESET_COMPLETED: "user.password_reset_completed",
  // TOTP verification attempts (src/app/(auth)/totp/actions.ts)
  TOTP_VERIFY_FAILED: "totp.verify_failed",
  TOTP_VERIFY_SUCCEEDED: "totp.verify_succeeded",
  TOTP_RECOVERY_FAILED: "totp.recovery_failed",
  TOTP_RECOVERY_SUCCEEDED: "totp.recovery_succeeded",
  // Admin user management (deactivate / reactivate)
  USER_DEACTIVATED: "user.deactivated",
  USER_REACTIVATED: "user.reactivated",
  // Rate limiting — written from src/lib/rate-limit.ts, not from actions.ts
  RATE_LIMIT_BLOCKED: "rate_limit.blocked",
  // Email queue — written from src/lib/email/queue.ts, not from actions.ts
  EMAIL_QUEUE_PERMANENT_FAILURE: "email.queue.permanent_failure",
  // Access gate — written from src/app/access-pending/page.tsx during RSC render
  ACCESS_DENIED: "access.denied",
  // Account lockout — written from src/auth.ts authorize(), not from actions.ts
  USER_ACCOUNT_LOCKED: "user.account_locked",
  // Admin-initiated account unlock — written from src/app/(admin)/admin/users/actions.ts
  USER_ACCOUNT_UNLOCKED: "user.account_unlocked",
  // What's-new entries — written from src/app/(admin)/admin/whats-new/actions.ts
  WHATS_NEW_ENTRY_CREATED: "whats_new.entry_created",
  WHATS_NEW_ENTRY_UPDATED: "whats_new.entry_updated",
  WHATS_NEW_ENTRY_DELETED: "whats_new.entry_deleted",
  // Per-org brand (P0.5 slice c2) — written from
  // src/app/(admin)/admin/organizations/[id]/actions.ts
  ORG_BRAND_SET: "org.brand.set",
  ORG_BRAND_NEUTRALIZED: "org.brand.neutralized",
  // Tenant role administration (P9) — written from
  // src/app/(org)/o/[slug]/admin/roles/actions.ts
  TENANT_ROLE_GRANTED: "tenant.role.granted",
  TENANT_ROLE_REVOKED: "tenant.role.revoked",
  // Support tickets (2026-08-20) — written from
  // src/app/(org)/o/[slug]/tickets/actions.ts
  TICKET_CREATED: "tenant.ticket.created",
  TICKET_FEEDBACK_PROMOTED: "tenant.ticket.feedback_promoted",
  // Public sites (2026-08-20) — written from
  // src/app/(admin)/admin/organizations/[id]/actions.ts and
  // src/app/api/sites/ingest/route.ts (SITE_CONTENT_INGESTED only, actor null)
  SITE_PROVISIONED: "site.provisioned",
  SITE_STATUS_CHANGED: "site.status_changed",
  SITE_CONTENT_INGESTED: "site.content_ingested",
  // Org creation (2026-08-24) — written from
  // src/app/(admin)/admin/organizations/new/actions.ts
  ORG_CREATED: "org.created",
  // Per-org feature toggles (2026-08-25, DECISION-097) — written from
  // src/app/(org)/o/[slug]/admin/features/actions.ts
  ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled",
  ORG_FEATURE_CATEGORY_TOGGLED: "tenant.org_feature_category.toggled",
  // Member management, Increment 1 (2026-08-25) — written from
  // src/app/(org)/o/[slug]/admin/community/pending/actions.ts
  ROLL_ACTION_APPROVED: "tenant.roll_action.approved",
  ROLL_ACTION_DENIED: "tenant.roll_action.denied",
  ROLL_ACTION_WITHDRAWN: "tenant.roll_action.withdrawn",
  // Participant enrolment/removal/undo on record (2026-10-22, DECISION-198)
  // — written from src/lib/roll.ts, in the same transaction as the roll row
  ROLL_ACTION_RECORDED: "tenant.roll_action.recorded",
  ROLL_ACTION_VOIDED: "tenant.roll_action.voided",
  // Member management, Increment 2 (2026-08-26) — written from
  // src/app/(org)/o/[slug]/admin/community/[id]/edit/actions.ts
  PERSON_UPDATED: "tenant.person.updated",
  TENANT_PERSON_EMAIL_ADDED: "tenant.person_email.added",
  TENANT_PERSON_EMAIL_ENDED: "tenant.person_email.ended",
  TENANT_PERSON_EMAIL_PRIMARY_CHANGED: "tenant.person_email.primary_changed",
  TENANT_PERSON_EMAIL_UPDATED: "tenant.person_email.updated",
  // Officer-terms administration (2026-08-26, groups-and-officers) —
  // written from src/app/(org)/o/[slug]/admin/officers/actions.ts
  OFFICER_TERM_STARTED: "tenant.officer_term.started",
  OFFICER_TERM_ENDED: "tenant.officer_term.ended",
  // Tenant-facing brand editor (2026-08-26, tenant-branding-permission) —
  // written from src/app/(org)/o/[slug]/admin/branding/actions.ts
  TENANT_BRAND_SET: "tenant.brand.set",
  // Member edit: tiered sensitive information (2026-08-26,
  // member-sensitive-info, DECISION-108) — written from
  // src/lib/person-sensitive.ts
  TENANT_PERSON_NOTE_ADDED: "tenant.person_note.added",
  TENANT_PERSON_DEMOGRAPHICS_UPDATED: "tenant.person_demographics.updated",
  TENANT_PERSON_MEDICAL_UPDATED: "tenant.person_medical.updated",
  TENANT_PERSON_DISABILITY_SET: "tenant.person_disability.set",
  // Role & permissions administration (2026-08-26,
  // role-permissions-admin, DECISION-106/109) — written from
  // src/app/(org)/o/[slug]/admin/roles/new/actions.ts and
  // src/app/(org)/o/[slug]/admin/roles/[id]/edit/actions.ts
  ROLE_DEFINITION_CREATED: "tenant.role_definition.created",
  ROLE_DEFINITION_PERMISSIONS_CHANGED:
    "tenant.role_definition.permissions_changed",
  ROLE_DEFINITION_DEACTIVATED: "tenant.role_definition.deactivated",
  ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE:
    "tenant.role_definition.adopted_from_template",
  // Groups administration (2026-08-26, groups-admin) — written from
  // src/app/(org)/o/[slug]/admin/groups/actions.ts
  GROUP_CREATED: "tenant.group.created",
  GROUP_UPDATED: "tenant.group.updated",
  GROUP_MEMBER_ADDED: "tenant.group_membership.added",
  GROUP_MEMBER_ENDED: "tenant.group_membership.ended",
  // Children's ministry, Increment A (2026-08-26, childrens-ministry) —
  // written from src/lib/children.ts
  TENANT_PERSON_RELATIONSHIP_ADDED: "tenant.person_relationship.added",
  TENANT_PERSON_RELATIONSHIP_UPDATED: "tenant.person_relationship.updated",
  TENANT_PERSON_RELATIONSHIP_REMOVED: "tenant.person_relationship.removed",
  // Ministry credentials & pastoral appointments (2026-08-26,
  // presbytery-functionality Increment 2, DECISION-112/116) — written from
  // src/app/(org)/o/[slug]/admin/credentials/actions.ts
  ORDINATION_RECORDED: "tenant.ordination.recorded",
  ORDINATION_STATUS_CHANGED: "tenant.ordination.status_changed",
  APPOINTMENT_RECORDED: "tenant.appointment.recorded",
  APPOINTMENT_ENDED: "tenant.appointment.ended",
  CONGREGATION_OVERSIGHT_SET: "tenant.congregation_oversight.set",
  CONGREGATION_STATISTICS_ENTERED: "tenant.congregation_statistics.entered",
  PER_CAPITA_RATE_SET: "tenant.per_capita_rate.set",
  PER_CAPITA_RECORDS_GENERATED: "tenant.per_capita_records.generated",
  PER_CAPITA_PAYMENT_RECORDED: "tenant.per_capita_payment.recorded",
  STAFF_POSITION_LISTED_PUBLICLY: "staff_position.listed_publicly",
  STAFF_POSITION_UNLISTED_PUBLICLY: "staff_position.unlisted_publicly",
  OFFICER_TERM_LISTED_PUBLICLY: "officer_term.listed_publicly",
  OFFICER_TERM_UNLISTED_PUBLICLY: "officer_term.unlisted_publicly",
  GROUP_MEMBERSHIP_LISTED_PUBLICLY: "group_membership.listed_publicly",
  GROUP_MEMBERSHIP_UNLISTED_PUBLICLY: "group_membership.unlisted_publicly",
  STATISTICS_GRANT_ISSUED: "tenant.statistics_grant.issued",
  STATISTICS_GRANT_REVOKED: "tenant.statistics_grant.revoked",
  STATISTICS_GRANT_SUBMITTED: "tenant.statistics_grant.submitted",
  STATISTICS_RETURN_WITHDRAWN: "tenant.statistics_return.withdrawn",
  // Founding administrator designation (2026-09-28, DECISION-155) — written
  // from src/app/(admin)/admin/organizations/[id]/actions.ts
  ORG_FOUNDING_ADMINISTRATOR_DESIGNATED: "org.founding_administrator.designated",
  // Online giving (2026-10-15, docs/work-log/2026-10-15-online-giving.md) — every
  // key of every batch, declared up front in Batch 1b.
  ORG_TREASURER_DESIGNATED: "org.treasurer.designated",
  ORG_FOUNDING_ADMINISTRATOR_REVOKED: "org.founding_administrator.revoked",
  ORG_TREASURER_REVOKED: "org.treasurer.revoked",
  ORG_GIVING_EVENT_REQUEUED: "org.giving_event.requeued",
  GIVING_CONNECTION_CREATED: "tenant.giving_connection.created",
  GIVING_CONNECTION_STATUS_CHANGED: "tenant.giving_connection.status_changed",
  GIVING_CONNECTION_DISCONNECTED: "tenant.giving_connection.disconnected",
  GIVING_PUBLIC_PAGE_TOGGLED: "tenant.giving_connection.public_toggled",
  GIVING_CONNECTION_RATES_CHANGED: "tenant.giving_connection.rates_changed",
  GIVING_PAYOUTS_ATTESTED: "tenant.giving_connection.payouts_attested",
  GIVING_FUND_CREATED: "tenant.giving_fund.created",
  GIVING_FUND_UPDATED: "tenant.giving_fund.updated",
  GIVING_FUND_RETIRED: "tenant.giving_fund.retired",
  GIVING_FUND_REACTIVATED: "tenant.giving_fund.reactivated",
  GIVING_SETTINGS_CHANGED: "tenant.giving_settings.changed",
  GIVING_GIFT_RECORDED: "tenant.giving_gift.recorded",
  GIVING_GIFT_VOIDED: "tenant.giving_gift.voided",
  GIVING_REVERSAL_RECORDED: "tenant.giving_reversal.recorded",
  GIVING_EVENT_DEAD_LETTERED: "tenant.giving_event.dead_lettered",
  GIVING_DONOR_CREATED: "tenant.giving_donor.created",
  GIVING_DONOR_CONTACT_CHANGED: "tenant.giving_donor.contact_changed",
  GIVING_DONOR_MERGED: "tenant.giving_donor.merged",
  GIVING_DONOR_LINK_CONFIRMED: "tenant.giving_donor.link_confirmed",
  GIVING_DONOR_LINK_REMOVED: "tenant.giving_donor.link_removed",
  GIVING_DONOR_LINK_DISMISSED: "tenant.giving_donor.link_dismissed",
  GIVING_DONOR_AUTOLINKED: "tenant.giving_donor.autolinked",
  GIVING_DONOR_LINK_CONFLICT: "tenant.giving_donor.link_conflict",
  GIVING_GIFTS_EXPORTED: "tenant.giving_gifts.exported",
  GIVING_STATEMENT_ISSUED: "tenant.giving_statement.issued",
  GIVING_STATEMENT_REISSUED: "tenant.giving_statement.reissued",
  GIVING_STATEMENT_NOTICE_SENT: "tenant.giving_statement.notice_sent",
  GIVING_STATEMENT_DELIVERY_RECORDED: "tenant.giving_statement.delivery_recorded",
  GIVING_STATEMENT_DOWNLOADED: "tenant.giving_statement.downloaded",
  GIVING_STATEMENTS_BULK_DOWNLOADED: "tenant.giving_statements.bulk_downloaded",
  // Custom domains (docs/work-log/2026-10-19-custom-domains.md, Phase 3 section 8).
  DOMAIN_CLAIMED: "domain.claimed",
  DOMAIN_PROOF_VERIFIED: "domain.proof_verified",
  DOMAIN_ATTACH_REQUESTED: "domain.attach_requested",
  DOMAIN_ATTACHED: "domain.attached",
  DOMAIN_LIVE: "domain.live",
  DOMAIN_LIVE_LOST: "domain.live_lost",
  DOMAIN_LAPSED: "domain.lapsed",
  DOMAIN_RECOVERED: "domain.recovered",
  DOMAIN_PARKED: "domain.parked",
  DOMAIN_RECONNECTED: "domain.reconnected",
  DOMAIN_RELEASE_REQUESTED: "domain.release_requested",
  DOMAIN_RELEASED: "domain.released",
  DOMAIN_EXPIRED: "domain.expired",
  DOMAIN_CANONICAL_CHANGED: "domain.canonical_changed",
  DOMAIN_HOLD_SET: "domain.hold_set",
  DOMAIN_HOLD_CLEARED: "domain.hold_cleared",
  INVITATION_CREATED: "invitation.created",
  INVITATION_RESENT: "invitation.resent",
  INVITATION_REVOKED: "invitation.revoked",
  INVITATION_ACCEPTED: "invitation.accepted",
  INVITATION_ACCEPT_BLOCKED: "invitation.accept_blocked",
  USER_CREATED_VIA_INVITATION: "user.created_via_invitation",
  // Parish management (2026-10-25, DECISION-245).
  DISTRICT_CREATED: "tenant.district.created",
  DISTRICT_RENAMED: "tenant.district.renamed",
  DISTRICT_ARCHIVED: "tenant.district.archived",
  DISTRICT_RESTORED: "tenant.district.restored",
  HOUSEHOLD_DISTRICT_CHANGED: "tenant.household.district_changed",
  HOUSEHOLD_DISTRICT_BULK_MOVED: "tenant.household.district_bulk_moved",
};

const EXPECTED_COUNT = Object.keys(EXPECTED_ENTRIES).length;

describe("AUDIT_ACTIONS catalog — regression for audit-string drift", () => {
  it(`has exactly ${EXPECTED_COUNT} entries`, () => {
    const keys = Object.keys(AUDIT_ACTIONS);
    expect(keys).toHaveLength(EXPECTED_COUNT);
  });

  it("exports every expected key", () => {
    for (const key of Object.keys(EXPECTED_ENTRIES) as Array<
      keyof typeof AUDIT_ACTIONS
    >) {
      expect(AUDIT_ACTIONS).toHaveProperty(key);
    }
  });

  it("each key has the exact frozen string value", () => {
    for (const [key, value] of Object.entries(EXPECTED_ENTRIES) as Array<
      [keyof typeof AUDIT_ACTIONS, string]
    >) {
      expect(AUDIT_ACTIONS[key]).toBe(value);
    }
  });

  it(`has no extra keys beyond the ${EXPECTED_COUNT} expected entries`, () => {
    const expectedKeys = new Set(Object.keys(EXPECTED_ENTRIES));
    const actualKeys = Object.keys(AUDIT_ACTIONS);
    for (const key of actualKeys) {
      expect(expectedKeys.has(key)).toBe(true);
    }
  });
});

describe("AUDIT_ACTIONS — online-giving keys (Batch 1b)", () => {
  const givingKeys = Object.keys(AUDIT_ACTIONS).filter(
    (k) => k.startsWith("GIVING_") || k === "ORG_TREASURER_DESIGNATED" || k === "ORG_GIVING_EVENT_REQUEUED",
  ) as Array<keyof typeof AUDIT_ACTIONS>;

  it("declares all 32 giving keys (31 up front in Batch 1b, plus GIVING_PAYOUTS_ATTESTED in the Batch 3a addendum)", () => {
    expect(givingKeys).toHaveLength(32);
  });

  it("keeps every string value unique across the whole catalog (a duplicate would make two acts indistinguishable in audit_events)", () => {
    const values = Object.values(AUDIT_ACTIONS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("puts platform-actor acts on the org.* axis and tenant acts on tenant.giving_*", () => {
    for (const key of givingKeys) {
      const value = AUDIT_ACTIONS[key];
      if (key.startsWith("ORG_")) {
        expect(value, key).toMatch(/^org\./);
      } else {
        expect(value, key).toMatch(/^tenant\.giving_[a-z_]+\.[a-z_]+$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// recordAudit() — unit tests
// ---------------------------------------------------------------------------

// Helper: build a mock Headers-like object with .get() support.
function makeHeaders(map: Record<string, string> = {}) {
  return {
    get: (name: string) => map[name.toLowerCase()] ?? null,
  };
}

describe("recordAudit() — actor resolution", () => {
  let valuesSpy: MockInstance;
  let consoleSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    // Stub headers() to return a minimal headers object (no ip/user-agent).
    vi.mocked(headers).mockResolvedValue(makeHeaders() as any);
    vi.mocked(getRequestIp).mockReturnValue(null);
    // Capture the values spy from the mock chain.
    valuesSpy = vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    } as any).mock.results[0]?.value
      ? (vi.mocked(db.insert).mock.results as any)
      : null;
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("actor omitted (undefined) → auth() is called and session values used", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", email: "a@example.com" },
    } as any);

    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({ action: AUDIT_ACTIONS.USER_PROFILE_UPDATED });

    expect(auth).toHaveBeenCalledOnce();
    expect(capturedValues).toMatchObject({
      actorUserId: "user-1",
      actorEmail: "a@example.com",
      action: "user.profile_updated",
    });
  });

  it("actor omitted, auth() returns null session → actorUserId and actorEmail are null", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);

    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({ action: AUDIT_ACTIONS.USER_PROFILE_UPDATED });

    expect(capturedValues).toMatchObject({
      actorUserId: null,
      actorEmail: null,
    });
  });

  it("actor explicit { userId, email } → auth() NOT called, provided values used", async () => {
    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET_REQUESTED,
      actor: { userId: "u-explicit", email: "explicit@example.com" },
    });

    expect(auth).not.toHaveBeenCalled();
    expect(capturedValues).toMatchObject({
      actorUserId: "u-explicit",
      actorEmail: "explicit@example.com",
    });
  });

  it("actor null → auth() NOT called, actorUserId and actorEmail both null (system write)", async () => {
    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({
      action: AUDIT_ACTIONS.RATE_LIMIT_BLOCKED,
      actor: null,
    });

    expect(auth).not.toHaveBeenCalled();
    expect(capturedValues).toMatchObject({
      actorUserId: null,
      actorEmail: null,
    });
  });
});

describe("recordAudit() — ip and user-agent extraction", () => {
  let consoleSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(null as any);
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("headers() returns valid headers → ip and userAgent populated in insert", async () => {
    const fakeHeaders = makeHeaders({
      "user-agent": "Mozilla/5.0",
      "x-real-ip": "1.2.3.4",
    });
    vi.mocked(headers).mockResolvedValue(fakeHeaders as any);
    vi.mocked(getRequestIp).mockReturnValue("1.2.3.4");

    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({ action: AUDIT_ACTIONS.USER_PROFILE_UPDATED });

    expect(capturedValues).toMatchObject({
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
    });
  });

  it("headers() throws (no request context) → ip=null, userAgent=null, insert still called", async () => {
    vi.mocked(headers).mockRejectedValue(
      new Error("headers() called outside request context"),
    );

    let insertCalled = false;
    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        insertCalled = true;
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({ action: AUDIT_ACTIONS.USER_PROFILE_UPDATED });

    expect(insertCalled).toBe(true);
    expect(capturedValues).toMatchObject({ ip: null, userAgent: null });
    // The outer console.error should NOT fire — only the inner catch fires,
    // and it is silent by design.
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("recordAudit() — failure swallowing", () => {
  let consoleSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(null as any);
    vi.mocked(headers).mockResolvedValue(makeHeaders() as any);
    vi.mocked(getRequestIp).mockReturnValue(null);
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("db.insert rejects → console.error called with [audit] prefix and function returns void (no throw)", async () => {
    const dbError = new Error("DB connection timeout");
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockRejectedValue(dbError),
    } as any);

    // Must not throw — audit failures must never take down the calling action.
    await expect(
      recordAudit({ action: AUDIT_ACTIONS.USER_PROFILE_UPDATED }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[audit] failed to write event",
      "user.profile_updated",
      dbError,
    );
  });

  it("auth() rejects → caught by outer handler; console.error called; no throw", async () => {
    vi.mocked(auth).mockRejectedValue(new Error("auth() crashed"));

    await expect(
      recordAudit({ action: AUDIT_ACTIONS.USER_PROFILE_UPDATED }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toBe("[audit] failed to write event");
  });
});

describe("recordAudit() — metadata and optional fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(null as any);
    vi.mocked(headers).mockResolvedValue(makeHeaders() as any);
    vi.mocked(getRequestIp).mockReturnValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("metadata omitted → insert receives empty object {}", async () => {
    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({ action: AUDIT_ACTIONS.USER_PROFILE_UPDATED });

    expect(capturedValues).toMatchObject({ metadata: {} });
  });

  it("metadata provided → insert receives it verbatim", async () => {
    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({
      action: AUDIT_ACTIONS.USER_ROLE_ASSIGNED,
      metadata: { roleId: "role-abc", reason: "onboarding" },
    });

    expect(capturedValues).toMatchObject({
      metadata: { roleId: "role-abc", reason: "onboarding" },
    });
  });

  it("resourceType and resourceId omitted → null in insert", async () => {
    let capturedValues: Record<string, unknown> | null = null;
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve(undefined);
      }),
    } as any);

    await recordAudit({ action: AUDIT_ACTIONS.USER_PROFILE_UPDATED });

    expect(capturedValues).toMatchObject({
      resourceType: null,
      resourceId: null,
    });
  });
});
