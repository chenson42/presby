/**
 * `org-invite.ts` with the database mocked (Community Increment 2b, Batch B2,
 * T-10; Phase 3 Test Plan 1.7, amendment 2 E-23, E-28, E-29, F177 conditions 1
 * and 2). What this file pins is what the TypeScript decides: the order of the
 * checks, what it hands the definers, what it queues and audits, and what it
 * will not do. The SQL it calls is proven in `sign-in-invitations.db.test.ts`
 * and `org-invite.db.test.ts` (a real Postgres, where a rolled-back transaction
 * is a fact and not a mock).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const h = vi.hoisted(() => {
  class FakeOrgAccessError extends Error {}
  return {
    FakeOrgAccessError,
    execute: vi.fn(),
    withOrgContext: vi.fn(),
    insertAuditRow: vi.fn(),
    insertQueueRowInTx: vi.fn(),
    cancelQueuedEmail: vi.fn(),
    attemptQueuedSend: vi.fn(),
    getPersonEmail: vi.fn(),
    personIdsWithCredentialEmail: vi.fn(),
    orgFeatureEnabledInTx: vi.fn(),
    isTotpConfigured: vi.fn(),
    origin: "https://app.example.invalid" as string | null,
  };
});

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/authz", () => ({
  OrgAccessError: h.FakeOrgAccessError,
  withOrgContext: (...a: unknown[]) => h.withOrgContext(...a),
}));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return { ...actual, insertAuditRow: h.insertAuditRow };
});
vi.mock("@/lib/email/queue", () => ({
  insertQueueRowInTx: (...a: unknown[]) => h.insertQueueRowInTx(...a),
  cancelQueuedEmail: (...a: unknown[]) => h.cancelQueuedEmail(...a),
  attemptQueuedSend: (...a: unknown[]) => h.attemptQueuedSend(...a),
}));
vi.mock("@/lib/contact-methods/reader", () => ({
  getPersonEmail: (...a: unknown[]) => h.getPersonEmail(...a),
  personIdsWithCredentialEmail: (...a: unknown[]) => h.personIdsWithCredentialEmail(...a),
}));
vi.mock("@/lib/org-features", () => ({
  orgFeatureEnabledInTx: (...a: unknown[]) => h.orgFeatureEnabledInTx(...a),
}));
vi.mock("@/lib/two-factor", () => ({ isTotpConfigured: () => h.isTotpConfigured() }));
vi.mock("@/lib/domains/host", () => ({ platformOrigin: () => h.origin }));

const org = await import("./org-invite");

const ORG = "10000000-0000-4000-8000-000000000001";
const ACTING_PERSON = "20000000-0000-4000-8000-000000000002";
const ACTING_USER = "30000000-0000-4000-8000-000000000003";
const PERSON = "40000000-0000-4000-8000-000000000004";
const OTHER = "50000000-0000-4000-8000-000000000005";
const INVITATION = "60000000-0000-4000-8000-000000000006";
const SUPERSEDED_QUEUE = "70000000-0000-4000-8000-000000000007";
const ADDRESS = "wendeline.ashgrove@example.invalid";
const ctx: import("./org-invite").SignInContext = {
  organizationId: ORG,
  actingPersonId: ACTING_PERSON,
  actingUserId: ACTING_USER,
  actingUserEmail: "sender@example.invalid",
};
const tx = { execute: h.execute };

const okIssue = (over: Record<string, unknown> = {}) => ({
  outcome: "ok",
  invitation_id: INVITATION,
  address: ADDRESS,
  recipient_first_name: "Wendeline",
  organization_name: "Quillhaven Fellowship",
  sender_name: "Beatrix Holloway",
  invitation_expires_at: new Date(Date.now() + 7 * 86_400_000),
  ack_reasons: [],
  existing_invitation_expired: false,
  ...over,
});

interface Script {
  peopleManage: boolean;
  officersManage: boolean;
  definer: Record<string, unknown> | undefined;
  states: Record<string, unknown>[];
  standing: Record<string, unknown>[];
  probe: Record<string, unknown>[];
  seats: Record<string, unknown>[];
  name: string | null;
}
let script: Script;

const sqlOf = (q: unknown) => new PgDialect().sqlToQuery(q as never);
const callsMatching = (re: RegExp) => h.execute.mock.calls.filter((c) => re.test(sqlOf(c[0]).sql));

function install() {
  h.execute.mockImplementation(async (q: unknown) => {
    const { sql: text, params } = sqlOf(q);
    if (/presby_has_permission/.test(text)) {
      const key = params[2];
      return { rows: [{ allowed: key === "people.manage" ? script.peopleManage : script.officersManage }] };
    }
    if (/presby_issue_sign_in_invitation|presby_resend_sign_in_invitation|presby_revoke_sign_in_invitation/.test(text)) {
      return { rows: script.definer ? [script.definer] : [] };
    }
    if (/presby_sign_in_invitation_states/.test(text)) return { rows: script.states };
    if (/presby_sign_in_card_standing/.test(text)) return { rows: script.standing };
    if (/from officer_terms/.test(text)) return { rows: script.probe };
    if (/from group_memberships/.test(text)) return { rows: script.seats };
    if (/from people p where p\.id/.test(text)) return { rows: script.name ? [{ name: script.name }] : [] };
    throw new Error(`unexpected SQL in org-invite.test: ${text.slice(0, 80)}`);
  });
}

beforeEach(() => {
  for (const fn of [h.execute, h.withOrgContext, h.insertAuditRow, h.insertQueueRowInTx, h.cancelQueuedEmail, h.attemptQueuedSend, h.getPersonEmail, h.personIdsWithCredentialEmail, h.orgFeatureEnabledInTx, h.isTotpConfigured]) fn.mockReset();
  script = { peopleManage: true, officersManage: true, definer: okIssue(), states: [], standing: [], probe: [], seats: [], name: "Wendeline Ashgrove" };
  install();
  h.origin = "https://app.example.invalid";
  h.isTotpConfigured.mockReturnValue(true);
  h.withOrgContext.mockImplementation(async (_p: string, _o: string, fn: (t: unknown) => Promise<unknown>) => fn(tx));
  h.insertQueueRowInTx.mockResolvedValue({ id: "queued" });
  h.attemptQueuedSend.mockResolvedValue({ sentInline: true });
  h.getPersonEmail.mockResolvedValue({ contactMethodId: "c", address: ADDRESS, subtype: null, doNotContact: false });
  h.personIdsWithCredentialEmail.mockResolvedValue(new Set());
  h.orgFeatureEnabledInTx.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const input = (over: Partial<import("./org-invite").SignInSendInput> = {}) => ({
  personId: PERSON,
  confirmedAddress: ADDRESS,
  acknowledged: false,
  ...over,
});

// ===========================================================================
describe("sendSignInInvitation: before the database", () => {
  it("a malformed organization, acting person or acting user is forbidden with no round trip", async () => {
    for (const bad of [{ organizationId: "x" }, { actingPersonId: "" }, { actingUserId: "nope" }]) {
      expect(await org.sendSignInInvitation({ ...ctx, ...bad }, input())).toEqual({ kind: "forbidden" });
    }
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });

  it("a malformed person id is not_found (an id that cannot exist), with no round trip", async () => {
    for (const personId of ["x", "", "../../etc", "40000000-0000-4000-8000-00000000000g"]) {
      expect(await org.sendSignInInvitation(ctx, input({ personId }))).toEqual({ kind: "refused", reason: "not_found" });
    }
    expect(await org.sendSignInInvitation(ctx, { ...input(), personId: undefined as never })).toEqual({ kind: "refused", reason: "not_found" });
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });

  it("a confirmation that is not an address is invalid_input, with no round trip", async () => {
    for (const confirmedAddress of ["", "   ", "no-at-sign", "a b@c.invalid", "a@@b.invalid", `${"x".repeat(320)}@example.invalid`]) {
      expect(await org.sendSignInInvitation(ctx, input({ confirmedAddress }))).toEqual({ kind: "invalid_input", field: "confirmedAddress" });
    }
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });

  it("an unset or unsafe platform origin refuses BEFORE any write (a link built from anything else is phishable)", async () => {
    h.origin = null;
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "link_origin_unavailable" });
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });

  it("an unconfigured two-factor deployment refuses BEFORE any write (new accounts default to required and would be stranded at the wall)", async () => {
    h.isTotpConfigured.mockReturnValue(false);
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "totp_unavailable" });
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("sendSignInInvitation: the transaction", () => {
  it("runs inside withOrgContext for the acting person and organization from the context, never from the input", async () => {
    await org.sendSignInInvitation(ctx, { ...input(), organizationId: OTHER, actingUserId: OTHER, personId: PERSON } as never);
    expect(h.withOrgContext).toHaveBeenCalledWith(ACTING_PERSON, ORG, expect.any(Function));
    const issue = callsMatching(/presby_issue_sign_in_invitation/)[0]!;
    const { params } = sqlOf(issue[0]);
    expect(params[0]).toBe(PERSON);
    expect(params[params.length - 1]).toBe(ACTING_USER);
    expect(params).not.toContain(OTHER);
  });

  it("checks people.manage first: a holder of nothing gets forbidden and the definer is never called", async () => {
    script.peopleManage = false;
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "forbidden" });
    expect(callsMatching(/presby_issue_sign_in_invitation/)).toHaveLength(0);
    expect(h.insertQueueRowInTx).not.toHaveBeenCalled();
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("hands the definer the NORMALIZED confirmation, a token HASH (never the token), a pre-minted queue id and the acknowledgement flag", async () => {
    await org.sendSignInInvitation(ctx, input({ confirmedAddress: "  Wendeline.Ashgrove@EXAMPLE.invalid ", acknowledged: true }));
    const { params, sql: text } = sqlOf(callsMatching(/presby_issue_sign_in_invitation/)[0]![0]);
    // (person, tokenHash, expiresAt, queueId, confirmed, acknowledged, issuedBy)
    expect(params[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(params[3]).toMatch(/^[0-9a-f-]{36}$/);
    expect(params[4]).toBe(ADDRESS);
    expect(params[5]).toBe(true);
    expect(text).toMatch(/::boolean/);
    // The queue row carries that same id and the email's link hashes to the stored hash.
    const queued = h.insertQueueRowInTx.mock.calls[0]![1] as { id: string; to: string; templateKey: string; message: { text: string } };
    expect(queued.id).toBe(params[3]);
    const token = /invite\?token=([A-Za-z0-9_-]{43})/.exec(queued.message.text)![1]!;
    expect(createHash("sha256").update(token, "utf8").digest("hex")).toBe(params[1]);
    expect(JSON.stringify(params)).not.toContain(token);
  });

  it("queues to the address the DEFINER returned, never the client's string", async () => {
    script.definer = okIssue({ address: "on-file@example.invalid" });
    await org.sendSignInInvitation(ctx, input({ confirmedAddress: "typed-by-client@example.invalid" }));
    const queued = h.insertQueueRowInTx.mock.calls[0]![1] as { to: string; templateKey: string };
    expect(queued.to).toBe("on-file@example.invalid");
    expect(queued.templateKey).toBe("account_sign_in_invitation");
  });

  it("renders the sign-in email with the definer's names: the recipient, the congregation and the sender's own record name", async () => {
    await org.sendSignInInvitation(ctx, input());
    const { message } = h.insertQueueRowInTx.mock.calls[0]![1] as { message: { text: string; subject: string } };
    expect(message.subject).toBe("Quillhaven Fellowship has invited you to sign in to PresbyPortal");
    expect(message.text).toContain("Hello Wendeline,");
    expect(message.text).toContain("Beatrix Holloway at Quillhaven Fellowship has set up a place for you");
  });

  it("an ok result returns the invitation, the definer's address, and 'sent' when the post-commit send succeeds", async () => {
    const result = await org.sendSignInInvitation(ctx, input());
    expect(result).toMatchObject({ kind: "ok", invitationId: INVITATION, address: ADDRESS, delivery: "sent", acknowledged: [] });
    expect(h.attemptQueuedSend).toHaveBeenCalledTimes(1);
    // After the commit, not before: the transaction callback has already returned.
    const queuedId = (h.insertQueueRowInTx.mock.calls[0]![1] as { id: string }).id;
    expect(h.attemptQueuedSend).toHaveBeenCalledWith(queuedId);
  });

  it("a failing post-commit send is delivery 'queued', never an error (the row stays queued for the worker)", async () => {
    h.attemptQueuedSend.mockResolvedValue({ sentInline: false });
    expect(await org.sendSignInInvitation(ctx, input())).toMatchObject({ kind: "ok", delivery: "queued" });
    h.attemptQueuedSend.mockRejectedValue(new Error("provider down"));
    expect(await org.sendSignInInvitation(ctx, input())).toMatchObject({ kind: "ok", delivery: "queued" });
  });
});

// ===========================================================================
describe("sendSignInInvitation: the audit row (Rule 7; F177 condition 2)", () => {
  it("writes invitation.created in the same transaction, from ids and enums only", async () => {
    await org.sendSignInInvitation(ctx, input());
    expect(h.insertAuditRow).toHaveBeenCalledTimes(1);
    const [txArg, row] = h.insertAuditRow.mock.calls[0] as [unknown, { action: string; actor: unknown; resourceType: string; resourceId: string; metadata: Record<string, unknown> }];
    expect(txArg).toBe(tx);
    expect(row.action).toBe("invitation.created");
    expect(row.actor).toEqual({ userId: ACTING_USER, email: "sender@example.invalid" });
    expect(row.resourceType).toBe("account_invitation");
    expect(row.resourceId).toBe(INVITATION);
    expect(Object.keys(row.metadata).sort()).toEqual(
      ["acknowledged", "expiresAt", "invitationId", "organizationId", "origin", "personId", "purpose"].sort(),
    );
    expect(row.metadata).toMatchObject({ invitationId: INVITATION, organizationId: ORG, purpose: "sign_in", origin: "org", personId: PERSON, acknowledged: [] });
  });

  it("'acknowledged' is what the DEFINER returned, never the client's flag (a client claiming true for a non-visitor still records [])", async () => {
    await org.sendSignInInvitation(ctx, input({ acknowledged: true }));
    expect((h.insertAuditRow.mock.calls[0]![1] as { metadata: { acknowledged: unknown } }).metadata.acknowledged).toEqual([]);
  });

  it("a visitor send records ['visitor'] and a do-not-contact address records it too", async () => {
    script.definer = okIssue({ ack_reasons: ["visitor", "do_not_contact"] });
    const result = await org.sendSignInInvitation(ctx, input({ acknowledged: true }));
    expect((h.insertAuditRow.mock.calls[0]![1] as { metadata: { acknowledged: unknown } }).metadata.acknowledged).toEqual(["visitor", "do_not_contact"]);
    expect(result).toMatchObject({ kind: "ok", acknowledged: ["visitor", "do_not_contact"] });
  });

  it("an array returned as a Postgres text literal is parsed, and an unknown reason is dropped", async () => {
    script.definer = okIssue({ ack_reasons: "{visitor,teleported}" });
    const result = await org.sendSignInInvitation(ctx, input({ acknowledged: true }));
    expect(result).toMatchObject({ acknowledged: ["visitor"] });
  });

  it("contains no address, name or token", async () => {
    await org.sendSignInInvitation(ctx, input());
    const json = JSON.stringify(h.insertAuditRow.mock.calls[0]![1]);
    expect(json).not.toContain(ADDRESS);
    expect(json).not.toMatch(/Wendeline|Beatrix|[A-Za-z0-9_-]{43}/);
  });

  it("a FORCED throw from the audit insert fails the send: db_error, and the email is never attempted", async () => {
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed (test-injected)"));
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "db_error" });
    expect(h.attemptQueuedSend).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("sendSignInInvitation: refusals abort the transaction and write nothing", () => {
  const refusals = [
    "not_found", "already_signs_in", "person_merged", "person_deceased", "membership_ended", "needs_support",
    "needs_officers_permission", "exceeds_your_access", "no_email_on_file", "address_changed", "address_is_yours",
    "address_shared", "already_pending", "rate_limited",
  ] as const;

  it.each(refusals)("%s: refused with that reason, nothing queued, audited or sent", async (outcome) => {
    script.definer = { outcome };
    const result = await org.sendSignInInvitation(ctx, input());
    expect(result).toMatchObject({ kind: "refused", reason: outcome });
    expect(h.insertQueueRowInTx).not.toHaveBeenCalled();
    expect(h.insertAuditRow).not.toHaveBeenCalled();
    expect(h.attemptQueuedSend).not.toHaveBeenCalled();
  });

  it("the transaction is aborted by a throw, not an early return (an early return from db.transaction() COMMITS)", async () => {
    script.definer = { outcome: "address_changed" };
    let threw = false;
    h.withOrgContext.mockImplementation(async (_p: string, _o: string, fn: (t: unknown) => Promise<unknown>) => {
      try {
        return await fn(tx);
      } catch (e) {
        threw = true;
        throw e;
      }
    });
    await org.sendSignInInvitation(ctx, input());
    expect(threw).toBe(true);
  });

  it("needs_acknowledgement carries the reasons the DEFINER found (F177 condition 1: the database asks)", async () => {
    script.definer = { outcome: "needs_acknowledgement", ack_reasons: ["visitor"] };
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "refused", reason: "needs_acknowledgement", ackReasons: ["visitor"] });
  });

  it("cooldown carries when Send again opens; already_pending carries whether the open row has expired", async () => {
    const next = new Date(Date.now() + 120_000);
    script.definer = { outcome: "cooldown", next_resend_at: next };
    expect(await org.resendSignInInvitation(ctx, input())).toEqual({ kind: "refused", reason: "cooldown", nextResendAt: next });
    script.definer = { outcome: "already_pending", existing_invitation_expired: true };
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "refused", reason: "already_pending", existingExpired: true });
    script.definer = { outcome: "already_pending", existing_invitation_expired: false };
    expect(await org.sendSignInInvitation(ctx, input())).toMatchObject({ existingExpired: false });
  });

  it("reads the person's name from their own record only for the refusals whose sentence names them", async () => {
    for (const outcome of ["already_signs_in", "needs_officers_permission", "exceeds_your_access", "no_email_on_file"]) {
      h.execute.mockClear();
      script.definer = { outcome };
      expect(await org.sendSignInInvitation(ctx, input())).toMatchObject({ reason: outcome, personName: "Wendeline Ashgrove" });
    }
    h.execute.mockClear();
    script.definer = { outcome: "address_changed" };
    const result = await org.sendSignInInvitation(ctx, input());
    expect(result).toEqual({ kind: "refused", reason: "address_changed" });
    expect(callsMatching(/from people p where p\.id/)).toHaveLength(0);
  });

  it("an outcome the code does not know fails closed (db_error), as does a missing row", async () => {
    script.definer = { outcome: "teleported" };
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "db_error" });
    script.definer = undefined;
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "db_error" });
  });

  it("the uniform identity-refusal (42501) and a lost membership are forbidden, not db_error", async () => {
    h.execute.mockImplementation(() => {
      throw Object.assign(new Error("account_invitations: this sign-in invitation action is not permitted"), { code: "42501" });
    });
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "forbidden" });
    install();
    h.withOrgContext.mockImplementation(async () => {
      throw new h.FakeOrgAccessError("no membership");
    });
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "forbidden" });
  });

  it("a database failure logs a class only (no address, no id) and returns db_error", async () => {
    h.withOrgContext.mockImplementation(async () => {
      throw Object.assign(new Error(`insert failed for ${ADDRESS} person ${PERSON}`), { cause: { code: "55P03" } });
    });
    expect(await org.sendSignInInvitation(ctx, input())).toEqual({ kind: "db_error" });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).toContain("55P03");
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain(PERSON);
  });
});

// ===========================================================================
describe("resendSignInInvitation", () => {
  beforeEach(() => {
    script.definer = okIssue({ cancel_email_queue_id: SUPERSEDED_QUEUE, next_resend_at: new Date(Date.now() + 300_000) });
    script.states = [{ person_id: PERSON, linked: false, state: "pending", resend_count: 3 }];
  });

  it("calls the resend definer (the current address is re-read there), cancels the superseded still-queued email in the SAME transaction, and queues the new one", async () => {
    const result = await org.resendSignInInvitation(ctx, input());
    expect(result).toMatchObject({ kind: "ok", invitationId: INVITATION });
    expect(callsMatching(/presby_resend_sign_in_invitation/)).toHaveLength(1);
    expect(callsMatching(/presby_issue_sign_in_invitation/)).toHaveLength(0);
    expect(h.cancelQueuedEmail).toHaveBeenCalledWith(tx, SUPERSEDED_QUEUE);
    expect(h.insertQueueRowInTx).toHaveBeenCalledTimes(1);
  });

  it("writes invitation.resent with the chain position read in the same transaction (the superseded id is not returned by the definer, so it is not on the row)", async () => {
    await org.resendSignInInvitation(ctx, input());
    const row = h.insertAuditRow.mock.calls[0]![1] as { action: string; metadata: Record<string, unknown> };
    expect(row.action).toBe("invitation.resent");
    expect(row.metadata).toMatchObject({ invitationId: INVITATION, organizationId: ORG, purpose: "sign_in", origin: "org", personId: PERSON, resendCount: 3 });
    expect(Object.keys(row.metadata)).not.toContain("supersededInvitationId");
    expect(JSON.stringify(row.metadata)).not.toContain(ADDRESS);
  });

  it("does not cancel anything when the superseded row's email already left (no cancel id)", async () => {
    script.definer = okIssue({ cancel_email_queue_id: null });
    await org.resendSignInInvitation(ctx, input());
    expect(h.cancelQueuedEmail).not.toHaveBeenCalled();
  });

  it("a refusal leaves the open invitation alone: no queue row, no cancel, no audit", async () => {
    for (const outcome of ["not_open", "cooldown", "chain_cap", "address_changed"]) {
      script.definer = { outcome, next_resend_at: new Date() };
      expect(await org.resendSignInInvitation(ctx, input())).toMatchObject({ kind: "refused", reason: outcome });
    }
    expect(h.cancelQueuedEmail).not.toHaveBeenCalled();
    expect(h.insertQueueRowInTx).not.toHaveBeenCalled();
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("a forced audit failure fails the resend (so nothing was superseded: the whole transaction rolls back)", async () => {
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed (test-injected)"));
    expect(await org.resendSignInInvitation(ctx, input())).toEqual({ kind: "db_error" });
    expect(h.attemptQueuedSend).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("revokeSignInInvitation", () => {
  beforeEach(() => {
    script.definer = { outcome: "ok", invitation_id: INVITATION, cancel_email_queue_id: SUPERSEDED_QUEUE };
  });

  it("revokes, cancels the still-queued email in the same transaction, and audits invitation.revoked via 'single'", async () => {
    expect(await org.revokeSignInInvitation(ctx, { personId: PERSON })).toEqual({ kind: "ok" });
    expect(h.cancelQueuedEmail).toHaveBeenCalledWith(tx, SUPERSEDED_QUEUE);
    const row = h.insertAuditRow.mock.calls[0]![1] as { action: string; actor: unknown; resourceId: string; metadata: Record<string, unknown> };
    expect(row.action).toBe("invitation.revoked");
    expect(row.actor).toEqual({ userId: ACTING_USER, email: "sender@example.invalid" });
    expect(row.resourceId).toBe(INVITATION);
    expect(row.metadata).toEqual({ invitationId: INVITATION, organizationId: ORG, purpose: "sign_in", origin: "org", personId: PERSON, via: "single" });
  });

  it("not_open is refused with nothing written; a malformed id is not_found without a round trip", async () => {
    script.definer = { outcome: "not_open" };
    expect(await org.revokeSignInInvitation(ctx, { personId: PERSON })).toEqual({ kind: "refused", reason: "not_open" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
    h.withOrgContext.mockClear();
    expect(await org.revokeSignInInvitation(ctx, { personId: "x" })).toEqual({ kind: "refused", reason: "not_found" });
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });

  it("is people.manage only: officers.manage alone is forbidden, and a cancel is never an escalation", async () => {
    script.peopleManage = false;
    expect(await org.revokeSignInInvitation(ctx, { personId: PERSON })).toEqual({ kind: "forbidden" });
    expect(callsMatching(/presby_revoke_sign_in_invitation/)).toHaveLength(0);
  });

  it("a forced audit failure fails the revoke", async () => {
    h.insertAuditRow.mockRejectedValue(new Error("audit insert failed (test-injected)"));
    expect(await org.revokeSignInInvitation(ctx, { personId: PERSON })).toEqual({ kind: "db_error" });
  });
});

// ===========================================================================
describe("getSignInCard", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    person_id: PERSON,
    linked: false,
    state: "none",
    sent_at: null,
    expires_at: null,
    resend_count: 0,
    next_resend_at: null,
    invited_address: null,
    address_current: null,
    outcome: null,
    queue_status: null,
    connected_via: null,
    connected_on: null,
    ...over,
  });

  beforeEach(() => {
    script.states = [row()];
    script.standing = [{ standing: "listed", authority_bearing: false, address_shared: false }];
  });

  it("forbidden without people.manage, with nothing read", async () => {
    script.peopleManage = false;
    expect(await org.getSignInCard(ctx, PERSON)).toEqual({ kind: "forbidden" });
    expect(callsMatching(/presby_sign_in_invitation_states/)).toHaveLength(0);
  });

  it("a person the reader omits (no membership here, or no such id) is not_found; a malformed id too, with no round trip", async () => {
    script.states = [];
    expect(await org.getSignInCard(ctx, PERSON)).toEqual({ kind: "not_found" });
    h.withOrgContext.mockClear();
    expect(await org.getSignInCard(ctx, "x")).toEqual({ kind: "not_found" });
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });

  it("an unconnected, authority-free person with an address and the toggle on reads by_sign_in with the credential address", async () => {
    const result = await org.getSignInCard(ctx, PERSON);
    expect(result).toMatchObject({
      kind: "ok",
      card: { personId: PERSON, state: "none", linked: false, address: ADDRESS, outlook: "by_sign_in", selfConnectEnabled: true, isVisitor: false },
    });
    expect(h.getPersonEmail).toHaveBeenCalledWith(tx, PERSON, "credential");
    expect(h.orgFeatureEnabledInTx).toHaveBeenCalledWith(tx, ORG, "org_portal.sign_in_connect", false);
  });

  it("a connected person carries how and when (from this organization's own rows) and reads connected", async () => {
    script.states = [row({ linked: true, state: "signs_in", connected_via: "sign_in", connected_on: "2026-10-22" })];
    const result = await org.getSignInCard(ctx, PERSON);
    expect(result).toMatchObject({ card: { linked: true, connectedVia: "sign_in", connectedOn: "2026-10-22", outlook: "connected" } });
  });

  it("a visitor, a shared address and an authority-bearing record are surfaced from the standing core's answers", async () => {
    script.standing = [{ standing: "visitor", authority_bearing: false, address_shared: false }];
    expect(await org.getSignInCard(ctx, PERSON)).toMatchObject({ card: { isVisitor: true, outlook: "visitor" } });
    script.standing = [{ standing: "listed", authority_bearing: false, address_shared: true }];
    expect(await org.getSignInCard(ctx, PERSON)).toMatchObject({ card: { addressShared: true, outlook: "shared_address" } });
    script.standing = [{ standing: "listed", authority_bearing: true, address_shared: false }];
    expect(await org.getSignInCard(ctx, PERSON)).toMatchObject({ card: { authorityBearing: true, outlook: "by_sign_in_second_factor" } });
  });

  it("an off or absent toggle reads turned_off; no address on file reads none", async () => {
    h.orgFeatureEnabledInTx.mockResolvedValue(false);
    expect(await org.getSignInCard(ctx, PERSON)).toMatchObject({ card: { selfConnectEnabled: false, outlook: "turned_off" } });
    h.orgFeatureEnabledInTx.mockResolvedValue(true);
    h.getPersonEmail.mockResolvedValue(null);
    expect(await org.getSignInCard(ctx, PERSON)).toMatchObject({ card: { address: null, outlook: "none" } });
  });

  it("a pending invitation carries its address, expiry, delivery, the cooldown in whole minutes and no chain cap until the fifth resend", async () => {
    const sent = new Date(Date.now() - 60_000);
    script.states = [
      row({
        state: "pending", sent_at: sent, expires_at: new Date(Date.now() + 6 * 86_400_000), resend_count: 2,
        next_resend_at: new Date(sent.getTime() + 300_000), invited_address: ADDRESS, address_current: true, queue_status: "sent",
      }),
    ];
    const { card } = (await org.getSignInCard(ctx, PERSON)) as { card: import("./sign-in-types").SignInCardState };
    expect(card).toMatchObject({ state: "pending", invitedAddress: ADDRESS, addressCurrent: true, delivery: "sent", resendCount: 2, chainCapReached: false, outlook: "none" });
    expect(card.cooldownMinutes).toBe(4);
    script.states = [row({ state: "pending", sent_at: sent, resend_count: 5, next_resend_at: new Date(Date.now() - 1000), queue_status: "sent" })];
    const capped = (await org.getSignInCard(ctx, PERSON)) as { card: import("./sign-in-types").SignInCardState };
    expect(capped.card).toMatchObject({ chainCapReached: true, cooldownMinutes: 0 });
  });

  it("a blocked invitation carries the reader's collapsed outcome, never a raw reason", async () => {
    script.states = [row({ state: "blocked", outcome: "needs_support" })];
    expect(await org.getSignInCard(ctx, PERSON)).toMatchObject({ card: { state: "blocked", blockedOutcome: "needs_support" } });
    script.states = [row({ state: "blocked", outcome: "person_elsewhere" })];
    expect(await org.getSignInCard(ctx, PERSON)).toMatchObject({ card: { blockedOutcome: null } });
  });

  it("a failure is 'error' (the card's honest load-failure line), never a thrown page", async () => {
    h.execute.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await org.getSignInCard(ctx, PERSON)).toEqual({ kind: "error" });
  });
});

// ===========================================================================
describe("getSignInMarkers", () => {
  const state = (id: string, over: Record<string, unknown> = {}) => ({
    person_id: id, linked: false, state: "none", sent_at: null, resend_count: 0, queue_status: null, ...over,
  });

  it("makes exactly ONE reader call, ONE authority probe and ONE address-presence query for a whole page", async () => {
    const ids = [PERSON, OTHER, "80000000-0000-4000-8000-000000000008"];
    script.states = ids.map((id) => state(id));
    await org.getSignInMarkers(ctx, ids);
    expect(callsMatching(/presby_sign_in_invitation_states/)).toHaveLength(1);
    expect(callsMatching(/from officer_terms/)).toHaveLength(1);
    expect(h.personIdsWithCredentialEmail).toHaveBeenCalledTimes(1);
    expect(h.withOrgContext).toHaveBeenCalledTimes(1);
  });

  it("is {} for a viewer without people.manage, with no reader call", async () => {
    script.peopleManage = false;
    expect(await org.getSignInMarkers(ctx, [PERSON])).toEqual({});
    expect(callsMatching(/presby_sign_in_invitation_states/)).toHaveLength(0);
  });

  it("is {} for no ids, for malformed ids only, and for an invalid context, with no round trip", async () => {
    expect(await org.getSignInMarkers(ctx, [])).toEqual({});
    expect(await org.getSignInMarkers(ctx, ["x", "", "../"])).toEqual({});
    expect(await org.getSignInMarkers({ ...ctx, organizationId: "x" }, [PERSON])).toEqual({});
    expect(h.withOrgContext).not.toHaveBeenCalled();
  });

  it("de-duplicates ids and caps the reader call at its 500-id bound", async () => {
    const many = Array.from({ length: 600 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    script.states = [];
    await org.getSignInMarkers(ctx, [...many, ...many]);
    const { params } = sqlOf(callsMatching(/presby_sign_in_invitation_states/)[0]![0]);
    expect(params).toHaveLength(500 + 1); // 500 distinct ids + the actor
    expect(new Set(params).size).toBe(501);
  });

  it("derives each person's marker: pending, expired, bounced, not connected with inert authority (and 'no email'), none for an ordinary member, none for a connected person", async () => {
    const [a, b, c, d, e, f] = ["a", "b", "c", "d", "e", "f"].map((x) => `9000000${x.charCodeAt(0) - 96}-0000-4000-8000-000000000000`);
    script.states = [
      state(a!, { state: "pending", sent_at: new Date("2026-10-20T12:00:00Z"), queue_status: "sent" }),
      state(b!, { state: "expired", sent_at: new Date("2026-10-01T12:00:00Z") }),
      state(c!, { state: "pending", sent_at: new Date("2026-10-20T12:00:00Z"), queue_status: "sent", queue_bounced_at: new Date() }),
      state(d!, { state: "none" }),
      state(e!, { state: "none" }),
      state(f!, { state: "signs_in", linked: true }),
    ];
    script.probe = [{ id: d! }];
    h.personIdsWithCredentialEmail.mockResolvedValue(new Set([a!, b!, c!]));
    const markers = await org.getSignInMarkers(ctx, [a!, b!, c!, d!, e!, f!]);
    expect(markers[a!]).toEqual({ kind: "pending", sentAt: new Date("2026-10-20T12:00:00Z") });
    expect(markers[b!]).toEqual({ kind: "expired" });
    expect(markers[c!]).toEqual({ kind: "bounced" });
    expect(markers[d!]).toEqual({ kind: "not_connected", noEmail: true });
    expect(markers[e!]).toBeUndefined();
    expect(markers[f!]).toBeUndefined();
  });

  it("probes only the unconnected people whose state could show an inert-authority marker (a pending person is never probed)", async () => {
    script.states = [state(PERSON, { state: "pending", sent_at: new Date(), queue_status: "sent" }), state(OTHER, { state: "signs_in", linked: true })];
    await org.getSignInMarkers(ctx, [PERSON, OTHER]);
    expect(callsMatching(/from officer_terms/)).toHaveLength(0);
  });

  it("never throws for chrome: any failure is {} and logs a class only", async () => {
    h.withOrgContext.mockRejectedValue(Object.assign(new Error(`for ${ADDRESS}`), { code: "40001" }));
    expect(await org.getSignInMarkers(ctx, [PERSON])).toEqual({});
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls)).not.toContain(ADDRESS);
  });
});

// ===========================================================================
describe("listSessionSignInRows", () => {
  const seat = (id: string, name: string) => ({ id, name });
  const state = (id: string, over: Record<string, unknown> = {}) => ({ person_id: id, linked: false, state: "none", sent_at: null, resend_count: 0, queue_status: null, ...over });

  it("is forbidden unless the viewer holds BOTH people.manage and officers.manage (284e), with no seat read", async () => {
    for (const [p, o] of [[true, false], [false, true], [false, false]] as const) {
      script.peopleManage = p;
      script.officersManage = o;
      expect(await org.listSessionSignInRows(ctx)).toEqual({ kind: "forbidden" });
    }
    expect(callsMatching(/from group_memberships/)).toHaveLength(0);
  });

  it("reads the seats in effect today, then one reader call and one address-presence query for all of them", async () => {
    script.seats = [seat(PERSON, "Wendeline Ashgrove"), seat(OTHER, "Corwin Dellacroix")];
    script.states = [state(PERSON), state(OTHER, { state: "pending", sent_at: new Date("2026-10-20T12:00:00Z"), queue_status: "sent" })];
    h.personIdsWithCredentialEmail.mockResolvedValue(new Set([PERSON, OTHER]));
    const result = await org.listSessionSignInRows(ctx);
    expect(result).toEqual({
      kind: "ok",
      rows: [
        { personId: PERSON, name: "Wendeline Ashgrove", state: "not_invited", sentAt: null, action: "invite" },
        { personId: OTHER, name: "Corwin Dellacroix", state: "sent", sentAt: new Date("2026-10-20T12:00:00Z"), action: "open" },
      ],
    });
    expect(callsMatching(/presby_sign_in_invitation_states/)).toHaveLength(1);
    expect(h.personIdsWithCredentialEmail).toHaveBeenCalledTimes(1);
    const seatSql = sqlOf(callsMatching(/from group_memberships/)[0]![0]).sql;
    expect(seatSql).toMatch(/p\.user_id is null/);
    expect(seatSql).toMatch(/gm\.starts_on <= current_date/);
    expect(seatSql).toMatch(/derived_from = 'session'/);
  });

  it("a seat with no address reads 'no email' and offers the card; an expired or bounced invitation offers the card", async () => {
    script.seats = [seat(PERSON, "A B"), seat(OTHER, "C D")];
    script.states = [state(PERSON), state(OTHER, { state: "expired", sent_at: new Date("2026-10-01T12:00:00Z") })];
    h.personIdsWithCredentialEmail.mockResolvedValue(new Set([OTHER]));
    const result = (await org.listSessionSignInRows(ctx)) as { rows: import("./sign-in-types").SessionSignInRow[] };
    expect(result.rows.map((r) => [r.state, r.action])).toEqual([["no_email", "open"], ["expired", "open"]]);
  });

  it("no seats without a login is ok with no rows, and no reader call (the reader raises on an empty list)", async () => {
    script.seats = [];
    expect(await org.listSessionSignInRows(ctx)).toEqual({ kind: "ok", rows: [] });
    expect(callsMatching(/presby_sign_in_invitation_states/)).toHaveLength(0);
  });

  it("a failure is 'error', and logs a class only", async () => {
    h.withOrgContext.mockRejectedValue(new Error(`for ${ADDRESS}`));
    expect(await org.listSessionSignInRows(ctx)).toEqual({ kind: "error" });
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls)).not.toContain(ADDRESS);
  });
});
