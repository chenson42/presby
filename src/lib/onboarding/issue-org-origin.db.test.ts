/**
 * The platform side of the invitation table is bounded to PLATFORM rows
 * (Community Increment 2b, Batch B2, T-10; Phase 3 Test Plan 1.9; F198), on a
 * REAL Postgres connection. Since 0065 the table also holds a congregation's own
 * sign-in invitations (`origin = 'org'`). `issue.ts` (the platform operator's
 * library) must:
 *
 *   - never count them against, or let them be counted by, the platform's
 *     durable limits;
 *   - answer `not_found` to a resend or a revoke of one (a platform operator has
 *     no business editing a congregation's invitation by id);
 *   - never list them in an organization's designation list;
 *   - revoke them ONLY through the `org_sent` scope, and the designations only
 *     through the `designations` scope: a lever per origin, never a mixed one;
 *   - show them only masked (`summarizeOrgSentInvitations`): the first character
 *     of the local part, the domain and a status; no name, no full address.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/issue-org-origin.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Row, SignInFixture } from "@/lib/testing/sign-in-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/send", () => ({ sendEmail: sendMock }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("issue.ts is bounded to platform rows (F198, Postgres-backed)", () => {
  let f: SignInFixture;
  let org: string;
  let issue: typeof import("./issue");
  let operator: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const actor = () => ({ userId: operator, email: null as string | null });

  /** An org-origin sign_in invitation, open, with a queued credential email. */
  async function orgSent(at: string, options: { address?: string; createdBy?: string } = {}) {
    const p = await f.person(at, options.address ? { email: options.address } : {});
    const [q] = await f.q(sql`
      insert into email_queue (to_email, subject, html_body, text_body, template_key, status)
      values (${p.email}, 's', 'link', 'link', 'account_sign_in_invitation', 'queued') returning id`);
    const inv = await f.signInRow(at, p.id, p.email!, { createdBy: options.createdBy ?? f.actingUserId, emailQueueId: String(q!.id) });
    return { personId: p.id, email: p.email!, inv, queueId: String(q!.id) };
  }

  async function designation(at: string, address: string) {
    const queue = await f.q(sql`
      insert into email_queue (to_email, subject, html_body, text_body, template_key, status)
      values (${address}, 's', 'link', 'link', 'account_invitation', 'queued') returning id`);
    return f.insertInvitation({
      organizationId: at, purpose: "founding_administrator", email: address, createdByUserId: f.actingUserId,
      firstName: "Marisol", lastName: "Quenby", emailQueueId: String(queue[0]!.id),
    });
  }

  const row = async (id: string): Promise<Row> => (await f.q(sql`select * from account_invitations where id = ${id}`))[0]!;
  const queueStatus = async (id: string) => String((await f.q(sql`select status from email_queue where id = ${id}`))[0]!.status);

  beforeAll(async () => {
    delete process.env.EMAIL_DEV_INTERCEPT;
    delete process.env.EMAIL_DEV_REDIRECT_TO;
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    f = await createSignInFixture("io65");
    issue = await import("./issue");
    org = await f.congregation("a");
  });

  afterAll(async () => {
    if (!f) return;
    try {
      await f.q(sql`delete from audit_events where metadata->>'organizationId' = ${org}`);
      await f.q(sql`delete from email_queue where to_email like 'io65-%@example.invalid'`);
    } finally {
      await f.cleanup();
    }
  });

  beforeEach(async () => {
    operator = await f.makeUser(f.email("operator"));
    sendMock.mockReset();
    sendMock.mockResolvedValue({ id: "provider-ok" });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  // ===========================================================================
  it("a congregation's sends do not spend the platform's durable limits: eleven org-origin rows by the same inviter leave a platform invitation unlimited (the platform's per-organization cap is ten)", async () => {
    const target = await f.makeOrg("lim");
    for (let i = 0; i < 11; i += 1) {
      const s = await orgSent(target, { createdBy: operator });
      await f.q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${s.inv.id}`);
    }
    const [{ n }] = (await f.q(sql`select count(*)::int as n from account_invitations where organization_id = ${target} and origin = 'org'`)) as [{ n: number }];
    expect(n).toBe(11);

    const result = await issue.createInvitation({
      organizationId: target, purpose: "founding_administrator", email: f.email("fa-lim"), firstName: "Marisol", lastName: "Quenby", inviter: actor(),
    });
    expect(result.kind).toBe("ok");
  });

  it("a platform resend of a congregation's invitation, by id, is not_found and changes nothing", async () => {
    const s = await orgSent(org);
    const before = await row(s.inv.id);
    expect(await issue.resendInvitation({ organizationId: org, invitationId: s.inv.id, actor: actor() })).toEqual({ kind: "not_found" });
    expect(await row(s.inv.id)).toEqual(before);
    expect(await queueStatus(s.queueId)).toBe("queued");
  });

  it("a platform revoke of a congregation's invitation, by id, is not_found and changes nothing", async () => {
    const s = await orgSent(org);
    const before = await row(s.inv.id);
    expect(await issue.revokeInvitation({ organizationId: org, invitationId: s.inv.id, actor: actor() })).toEqual({ kind: "not_found" });
    expect(await row(s.inv.id)).toEqual(before);
    expect(await queueStatus(s.queueId)).toBe("queued");
  });

  it("an organization's designation list never contains a congregation's own invitation", async () => {
    const target = await f.makeOrg("lst");
    await orgSent(target);
    const fa = await designation(target, f.email("fa-list"));
    const list = await issue.listInvitationsForOrg(target);
    expect(list.map((r) => r.id)).toEqual([fa.id]);
    expect(list.every((r) => r.purpose !== "sign_in")).toBe(true);
  });

  // ===========================================================================
  describe("revokeAllOpenInvitations({ scope })", () => {
    it("designations: revokes the platform's rows and leaves the congregation's sign-in invitations open, with their emails queued", async () => {
      const target = await f.makeOrg("rad");
      const fa = await designation(target, f.email("fa-rad"));
      const mine = await orgSent(target);
      const result = await issue.revokeAllOpenInvitations({ organizationId: target, scope: "designations", actor: actor() });
      expect(result).toEqual({ kind: "ok", revoked: 1 });
      expect((await row(fa.id)).revoked_at).not.toBeNull();
      expect((await row(mine.inv.id)).revoked_at).toBeNull();
      expect(await queueStatus(mine.queueId)).toBe("queued");
    });

    it("org_sent: revokes the congregation's rows only, cancels and scrubs their queued emails, and audits each with via revoke_all and scope org_sent", async () => {
      const target = await f.makeOrg("ras");
      const fa = await designation(target, f.email("fa-ras"));
      const a = await orgSent(target);
      const b = await orgSent(target);
      const bystander = await f.makeOrg("by");
      const elsewhere = await orgSent(bystander);

      const result = await issue.revokeAllOpenInvitations({ organizationId: target, scope: "org_sent", actor: actor() });
      expect(result).toEqual({ kind: "ok", revoked: 2 });
      for (const s of [a, b]) {
        const r = await row(s.inv.id);
        expect(r.revoked_at).not.toBeNull();
        expect(r.revoked_by_user_id).toBe(operator);
        expect(await queueStatus(s.queueId)).toBe("cancelled");
      }
      expect((await row(fa.id)).revoked_at).toBeNull();
      expect((await row(elsewhere.inv.id)).revoked_at).toBeNull();

      const audit = await f.q(sql`
        select * from audit_events where action = 'invitation.revoked' and metadata->>'organizationId' = ${target} order by resource_id`);
      expect(audit).toHaveLength(2);
      for (const r of audit) {
        expect(r.metadata).toMatchObject({ purpose: "sign_in", via: "revoke_all", scope: "org_sent" });
        expect(r.actor_user_id).toBe(operator);
      }
      await f.q(sql`delete from audit_events where metadata->>'organizationId' = ${target}`);
    });

    it("refunds nothing: the revoked rows are still there to be counted", async () => {
      const target = await f.makeOrg("rfd");
      const s = await orgSent(target);
      await issue.revokeAllOpenInvitations({ organizationId: target, scope: "org_sent", actor: actor() });
      expect((await f.q(sql`select count(*)::int as n from account_invitations where organization_id = ${target}`))[0]!.n).toBe(1);
      expect((await row(s.inv.id)).revoked_at).not.toBeNull();
    });

    it("a FAILED audit insert rolls every revoke back (the audit shares the transaction)", async () => {
      const target = await f.makeOrg("rbk");
      const s = await orgSent(target);
      const spy = vi.spyOn(await import("@/lib/audit-tx"), "insertAuditRow").mockRejectedValue(new Error("audit insert failed (test-injected)"));
      try {
        expect(await issue.revokeAllOpenInvitations({ organizationId: target, scope: "org_sent", actor: actor() })).toEqual({ kind: "db_error" });
      } finally {
        spy.mockRestore();
      }
      expect((await row(s.inv.id)).revoked_at).toBeNull();
      expect(await queueStatus(s.queueId)).toBe("queued");
    });

    it("an unknown scope reaching the library (a caller bypassing the action) is refused, never defaulted to the other origin", async () => {
      const target = await f.makeOrg("unk");
      const s = await orgSent(target);
      const fa = await designation(target, f.email("fa-unk"));
      expect(await issue.revokeAllOpenInvitations({ organizationId: target, scope: "everything" as never, actor: actor() })).toEqual({ kind: "db_error" });
      expect((await row(s.inv.id)).revoked_at).toBeNull();
      expect((await row(fa.id)).revoked_at).toBeNull();
    });
  });

  // ===========================================================================
  describe("summarizeOrgSentInvitations (masked)", () => {
    it("counts by derived status and masks every address: first character, '***@', the domain; no name, no full address", async () => {
      const target = await f.makeOrg("sum");
      const open = await orgSent(target, { address: "io65-summary-open@example.invalid" });
      const expired = await f.person(target, { email: "io65-summary-expired@example.invalid" });
      await f.signInRow(target, expired.id, expired.email!, { createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '2 days'` });
      const revoked = await orgSent(target, { address: "io65-summary-revoked@example.invalid" });
      await f.q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${revoked.inv.id}`);
      await designation(target, f.email("fa-sum")); // a platform row: never in the summary

      const summary = await issue.summarizeOrgSentInvitations(target);
      expect(summary.counts).toEqual({ pending: 1, accepted: 0, expired: 1, revoked: 1, blocked: 0 });
      expect(summary.revocable).toBe(2);
      expect(summary.rows).toHaveLength(3);
      for (const r of summary.rows) {
        expect(r.maskedAddress).toBe("i***@example.invalid");
        expect(Object.keys(r).sort()).toEqual(["createdAt", "expiresAt", "id", "maskedAddress", "status"]);
      }
      const json = JSON.stringify(summary);
      expect(json).not.toContain("io65-summary");
      expect(json).not.toContain(open.email);
      expect(json).not.toMatch(/Wendeline|Ashgrove|Marisol|Quenby/);
    });

    it("hides a superseded row, and is empty for an organization with none or a malformed id (the redacted branch of the mask is defensive: the 90-day redaction sweep is unbuilt, S6, and the update guard refuses a manual redaction)", async () => {
      const target = await f.makeOrg("sup");
      const old = await orgSent(target);
      await f.q(sql`update account_invitations set superseded_at = now() where id = ${old.inv.id}`);
      expect((await issue.summarizeOrgSentInvitations(target)).rows).toEqual([]);

      expect(await issue.summarizeOrgSentInvitations("not-a-uuid")).toEqual({
        counts: { pending: 0, accepted: 0, expired: 0, revoked: 0, blocked: 0 }, revocable: 0, rows: [],
      });
    });

    it("sees only its own organization's rows", async () => {
      const a = await f.makeOrg("ia");
      const b = await f.makeOrg("ib");
      await orgSent(a);
      expect((await issue.summarizeOrgSentInvitations(b)).rows).toEqual([]);
    });
  });
});
