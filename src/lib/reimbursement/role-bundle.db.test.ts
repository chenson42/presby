/**
 * The role bundle, through the real designation path - docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 P3-2, DECISION-269, EC29, EC31, F322. The
 * treasurer here is NOT a hand-built role: it is minted by `presby_apply_treasurer`
 * (the SQL the real invitation accept runs), holds only that one role, and does
 * what Batch 3 gives a treasurer to do: set up a second payer and the clerk role
 * through the treasury team path, and approve a request nobody else can (the
 * override, which needs that second payer). The payment verbs are Batch 4's and
 * extend this file; the e2e twin (`reimbursement-role-bundle`) is Batch 7's.
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/role-bundle.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    REIMBURSEMENT_APPROVED: "tenant.reimbursement.approved",
    REIMBURSEMENT_OVERRIDE_APPROVED: "tenant.reimbursement.override_approved",
    REIMBURSEMENT_RETURNED: "tenant.reimbursement.returned",
    REIMBURSEMENT_NOT_APPROVED: "tenant.reimbursement.not_approved",
  },
  recordAudit: vi.fn(),
}));
const sent = vi.hoisted(() => ({ spy: vi.fn(async (_id: string) => ({ sentInline: true })) }));
vi.mock("@/lib/email/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/queue")>();
  return { ...actual, attemptQueuedSend: sent.spy };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const SEVEN = [
  "giving.manage", "giving.record", "giving.view",
  "reimbursement.manage", "reimbursement.pay", "reimbursement.request_for_others", "reimbursement.view",
];
const REIMBURSEMENT_KEYS = SEVEN.filter((k) => k.startsWith("reimbursement."));

describe.skipIf(!hasDb)("the designated treasurer's bundle (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let decisions: typeof import("./decisions");
  let requests: typeof import("./requests");
  let team: typeof import("@/lib/treasury/team");
  let input: typeof import("./input");
  let reads: typeof import("./reads");

  let A: string;
  let today: string;
  let session: string;
  let category: string;
  let designated: RequestActor;
  let admin: RequestActor;
  let filer: RequestActor;
  let treasurerRoleId: string;
  let clerkRoleId: string;
  const mail: Record<string, string> = {};
  let keySeq = 0;
  const nextKey = () => `rk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");
  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId, email: null, personId: m.personId, organizationId: org,
  });
  const holds = async (personId: string, key: string) =>
    (await fx.app(A, sql`select presby_has_permission(${personId}::uuid, ${A}::uuid, ${key}) as ok`))[0]!.ok === true;

  async function submitIn(who: RequestActor, over: Record<string, unknown> = {}) {
    const saved = await requests.saveRequest(who, input.saveRequestSchema.parse({
      clientKey: nextKey(), kind: "reimburse", groupId: session, amountCents: 8800, expenseDate: today,
      purpose: "Sound board cables", categoryId: category, noReceiptClaimed: true, ...over,
    }));
    if (saved.kind !== "ok") throw new Error(`save failed ${JSON.stringify(saved)}`);
    const sub = await requests.submitRequest(who, { requestId: saved.requestId, expectedRevision: saved.revision });
    if (sub.kind !== "ok") throw new Error(`submit failed ${JSON.stringify(sub)}`);
    return { requestId: saved.requestId, expectedRevision: sub.revision };
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("bundle");
    decisions = await import("./decisions");
    requests = await import("./requests");
    team = await import("@/lib/treasury/team");
    input = await import("./input");
    reads = await import("./reads");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    session = await fx.derivedGroup(A, "session");
    const t = await fx.member(A, "Designated");
    const a = await fx.member(A, "Founder");
    const f = await fx.member(A, "Filer");
    designated = actor(A, t);
    admin = actor(A, a);
    filer = actor(A, f);
    // The founding administrator's role, with the keys a founding administrator really has: none of the money ones.
    await fx.grant(A, await fx.makeRole(A, "founding_like", ["roles.manage", "groups.manage", "people.manage"]), a.personId);
    category = await fx.category(A, "Equipment", t.userId);
    for (const [tag, m] of Object.entries({ designated: t, filer: f })) mail[tag] = await fx.email(m.personId, tag, { subtype: "work" });
    today = await reads.getOrgToday({ userId: f.userId, personId: f.personId, organizationId: A });

    // The REAL designation effect (the SQL `presby_accept_invitation` calls), then nothing else.
    const [applied] = await fx.q(sql`select * from presby_apply_treasurer(${A}::uuid, ${t.personId}::uuid, ${t.userId}::uuid)`);
    expect(applied).toMatchObject({ outcome: "ok" });
    treasurerRoleId = String(applied!.treasurer_role_id);
    await fx.q(sql`
      insert into reimbursement_chargeable_groups (organization_id, group_id, created_by_user)
      values (${A}, ${session}, ${t.userId})`);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("DECISION-269: the designation-minted role carries all four reimbursement keys with the three giving keys - seven in all - and nothing more", async () => {
    const keys = (await fx.q(sql`select permission_key from app_role_permissions where role_id = ${treasurerRoleId} order by permission_key collate "C"`))
      .map((r) => String(r.permission_key));
    expect(keys).toEqual(SEVEN);
  });

  it("the treasurer holds the bundle through that role alone; the founding administrator holds no money key (DECISION-078)", async () => {
    const roles = await fx.q(sql`select role_id from role_grants where organization_id = ${A} and person_id = ${designated.personId}`);
    expect(roles.map((r) => String(r.role_id))).toEqual([treasurerRoleId]);
    for (const key of REIMBURSEMENT_KEYS) {
      expect(await holds(designated.personId, key), key).toBe(true);
      expect(await holds(admin.personId, key), `founder ${key}`).toBe(false);
    }
  });

  it("EC10 through the real bundle: alone, the designated treasurer cannot override-approve - whoever approves cannot also pay", async () => {
    const req = await submitIn(filer);
    expect(await decisions.approveRequest(designated, { ...req, path: "override" })).toEqual({ kind: "refused", outcome: "needs_second_payer" });
  });

  it("EC31: the treasurer sets up the clerk role and names a second payer through the team path; the second payer then holds pay", async () => {
    const clerkRole = await team.ensureTreasuryRole("reimbursement", designated.personId, A, { templateKey: "reimbursement_clerk" });
    expect(clerkRole).toMatchObject({ kind: "ok", roleKey: "reimbursement_clerk", created: true, addedKeys: ["reimbursement.request_for_others"] });
    const second = await fx.member(A, "Successor");
    mail.second = await fx.email(second.personId, "second", { subtype: "work" });
    const granted = await team.grantTreasuryRole("reimbursement", designated.personId, A, designated.userId, {
      roleId: treasurerRoleId, personId: second.personId,
    });
    expect(granted).toMatchObject({ kind: "ok" });
    expect(await holds(second.personId, "reimbursement.pay")).toBe(true);
    if (clerkRole.kind !== "ok") throw new Error("clerk role not set up");
    clerkRoleId = clerkRole.roleId;
  });

  it("with the second payer in place the override works, is audited as the override, and tells ONLY the second payer it is ready to pay", async () => {
    const req = await submitIn(filer);
    sent.spy.mockClear();
    const result = await decisions.approveRequest(designated, { ...req, path: "override" });
    expect(result).toMatchObject({ kind: "ok", path: "override" });
    const [row] = await fx.q(sql`select status, approval_path, approved_by_user from reimbursement_requests where id = ${req.requestId}`);
    expect(row).toMatchObject({ status: "approved", approval_path: "override", approved_by_user: designated.userId });
    const audit = await fx.q(sql`select action from audit_events where resource_id = ${req.requestId}`);
    expect(audit.map((r) => r.action)).toEqual(["tenant.reimbursement.override_approved"]);
    const ready = (await fx.queued(Object.values(mail))).filter(
      (r) => r.template_key === "reimbursement.notice.ready_to_pay" && String(r.text_body).includes(req.requestId),
    );
    expect(ready.map((r) => r.to_email)).toEqual([mail.second]);
  });

  it("a clerk who enters a request on behalf of a member cannot approve it; the treasurer's override does, once", async () => {
    const clerk = await fx.member(A, "Clerkperson");
    expect(await team.grantTreasuryRole("reimbursement", designated.personId, A, designated.userId, { roleId: clerkRoleId, personId: clerk.personId }))
      .toMatchObject({ kind: "ok" });
    expect(await holds(clerk.personId, "reimbursement.pay")).toBe(false);
    const clerkActor = actor(A, clerk);
    const req = await submitIn(clerkActor, { beneficiaryPersonId: filer.personId });
    expect(await decisions.approveRequest(clerkActor, { ...req, path: "override" })).toEqual({ kind: "denied" });
    expect(await decisions.approveRequest(designated, { ...req, path: "override" })).toMatchObject({ kind: "ok" });
    expect(await decisions.approveRequest(designated, { ...req, path: "override" })).toMatchObject({ kind: "already_decided" });
  });
});
