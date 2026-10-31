/**
 * `org-invite.ts` on a REAL Postgres connection, through the presby_app `db`
 * exactly as the community edit actions run it (Community Increment 2b, Batch
 * B2, T-10; Phase 3 Test Plan 1.7; amendment 2 E-28, E-29). The SQL decisions
 * (who may be invited, the limits, the reader's shape) are proven in
 * `src/lib/db/domain/sign-in-invitations.db.test.ts`; `org-invite.test.ts`
 * pins the TypeScript's decisions with the database mocked. What only a real
 * database can show, and this file does:
 *
 *   - ATOMICITY (Rule 7): a FORCED failure of the audit insert leaves no
 *     invitation row, no queue row, no superseded row and no revoked row;
 *   - THE ADDRESS IS THE DATABASE'S: the queued `to_email` is the person's
 *     credential address, never a client string; a different confirmation is
 *     `address_changed` with nothing written;
 *   - THE LINK IS THE CREDENTIAL: the token in the queued email hashes to the
 *     stored `token_hash`, and the real preview function resolves it;
 *   - F177 condition 2: the audit row's `acknowledged` is what the definer
 *     found, whatever the client said;
 *   - resend supersedes, cancels and SCRUBS the earlier still-queued email and
 *     re-reads the CURRENT address; revoke cancels and scrubs;
 *   - the card, the markers and the Session rows read the real reader.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/org-invite.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Row, SignInFixture } from "@/lib/testing/sign-in-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/send", () => ({ sendEmail: sendMock }));

const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const MARKER = "[Removed after delivery: this message contained a one-time sign-in link.]";

describe.skipIf(!hasDb)("src/lib/onboarding/org-invite.ts (Postgres-backed)", () => {
  let f: SignInFixture;
  let org: string;
  let other: string;
  let lib: typeof import("./org-invite");
  let ctx: import("./org-invite").SignInContext;
  let sender: { userId: string; personId: string; email: string };
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const asSender = (over: Partial<import("./org-invite").SignInContext> = {}) => ({ ...ctx, ...over });
  const send = (personId: string, address: string, acknowledged = false) =>
    lib.sendSignInInvitation(ctx, { personId, confirmedAddress: address, acknowledged });

  async function rowsFor(personId: string): Promise<Row[]> {
    return f.q(sql`select * from account_invitations where person_id = ${personId} order by created_at, resend_count`);
  }
  async function queueRow(id: string): Promise<Row> {
    return (await f.q(sql`select * from email_queue where id = ${id}`))[0]!;
  }
  async function auditFor(action: string, personId: string): Promise<Row[]> {
    return f.q(sql`
      select * from audit_events
       where action = ${action} and metadata->>'personId' = ${personId} and metadata->>'organizationId' = ${org}
       order by created_at`);
  }
  async function counts(personId: string) {
    const [row] = await f.q(sql`
      select (select count(*) from account_invitations where person_id = ${personId})::int as invitations,
             (select count(*) from email_queue where template_key = 'account_sign_in_invitation'
                and to_email like 'oi65-%@example.invalid')::int as queued,
             (select count(*) from audit_events where metadata->>'personId' = ${personId})::int as audits`);
    return row!;
  }
  async function replaceAddress(personId: string, address: string) {
    await f.q(sql`update contact_methods set ended_at = now(), is_primary = false
                   where person_id = ${personId} and kind = 'email' and ended_at is null`);
    await f.q(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${personId}, 'email', ${address}, true)`);
  }

  beforeAll(async () => {
    delete process.env.EMAIL_DEV_INTERCEPT;
    delete process.env.EMAIL_DEV_REDIRECT_TO;
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    f = await createSignInFixture("oi65");
    org = await f.congregation("a");
    other = await f.congregation("b");
    sender = await f.sender(org, ["people.manage", "officers.manage", "directory.view"]);
    ctx = { organizationId: org, actingPersonId: sender.personId, actingUserId: sender.userId, actingUserEmail: sender.email };
    lib = await import("./org-invite");
  });

  afterAll(async () => {
    if (!f) return;
    try {
      await f.q(sql`delete from audit_events where metadata->>'organizationId' in (${org}, ${other})`);
      await f.q(sql`delete from email_queue where to_email like 'oi65-%@example.invalid'`);
    } finally {
      await f.cleanup();
    }
  });

  beforeEach(() => {
    auditControl.fail = false;
    sendMock.mockReset();
    sendMock.mockResolvedValue({ id: "provider-ok" });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  // ===========================================================================
  describe("send", () => {
    it("creates the invitation, its queue row and the audit row in one commit, to the person's on-file address, linked by the pre-minted id", async () => {
      const p = await f.person(org);
      const result = await send(p.id, p.email!);
      expect(result).toMatchObject({ kind: "ok", address: p.email, delivery: "sent", acknowledged: [] });
      if (result.kind !== "ok") return;

      const [inv] = await rowsFor(p.id);
      expect(inv).toMatchObject({
        id: result.invitationId,
        organization_id: org,
        purpose: "sign_in",
        origin: "org",
        email_normalized: p.email,
        person_id: p.id,
        created_by_user_id: sender.userId,
        resend_count: 0,
      });
      // The queue row exists, is addressed to the on-file address and is the row the invitation links to.
      const queue = await queueRow(String(inv!.email_queue_id));
      expect(queue.to_email).toBe(p.email);
      expect(queue.template_key).toBe("account_sign_in_invitation");
      // Sent inline, so the stored body is already scrubbed (a credential template).
      expect(queue.status).toBe("sent");
      expect(queue.html_body).toBe(MARKER);

      const audit = await auditFor("invitation.created", p.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor_user_id).toBe(sender.userId);
      expect(audit[0]!.resource_id).toBe(result.invitationId);
      expect(Object.keys(audit[0]!.metadata as object).sort()).toEqual(
        ["acknowledged", "expiresAt", "invitationId", "organizationId", "origin", "personId", "purpose"].sort(),
      );
      expect(JSON.stringify(audit[0]!.metadata)).not.toContain(p.email!);
    });

    it("the token in the queued email hashes to the stored token_hash, and the real preview resolves it (the link is the credential)", async () => {
      sendMock.mockRejectedValue(new Error("provider down")); // keep the body unscrubbed to read it
      const p = await f.person(org);
      const result = await send(p.id, p.email!);
      expect(result).toMatchObject({ kind: "ok", delivery: "queued" });
      const [inv] = await rowsFor(p.id);
      const queue = await queueRow(String(inv!.email_queue_id));
      expect(queue.status).toBe("queued");
      const token = /invite\?token=([A-Za-z0-9_-]{43})/.exec(String(queue.text_body))![1]!;
      expect(createHash("sha256").update(token, "utf8").digest("hex")).toBe(inv!.token_hash);
      const preview = await f.preview(token);
      expect(preview).toHaveLength(1);
      expect(preview[0]).toMatchObject({ purpose: "sign_in", organization_name: expect.any(String) });
    });

    it("a provider failure after the commit is delivery 'queued', the row stays queued for the worker, and the invitation stands", async () => {
      sendMock.mockRejectedValue(new Error("provider down"));
      const p = await f.person(org);
      const result = await send(p.id, p.email!);
      expect(result).toMatchObject({ kind: "ok", delivery: "queued" });
      expect(await rowsFor(p.id)).toHaveLength(1);
    });

    it("a confirmation that is not the on-file address is address_changed and NOTHING is written: the client cannot choose where the email goes", async () => {
      const p = await f.person(org);
      const before = await counts(p.id);
      const result = await send(p.id, "attacker@example.invalid");
      expect(result).toEqual({ kind: "refused", reason: "address_changed" });
      expect(await counts(p.id)).toEqual(before);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("a different-case confirmation of the on-file address is accepted, and the email goes to the stored (normalized) address", async () => {
      const p = await f.person(org);
      const result = await send(p.id, `  ${p.email!.toUpperCase()}  `);
      expect(result).toMatchObject({ kind: "ok", address: p.email });
    });

    it("a visitor sends without an acknowledgement and is audited as [] (drizzle/0066 section 9 retired F177 condition 1); a client claiming acknowledgement for a non-visitor still records []", async () => {
      // Increment 3a: the definer no longer asks for a visitor acknowledgement
      // (check 10), so the unchanged TypeScript sends and records what the
      // definer found: nothing (EC-21). Batch B removes `visitor` from
      // SIGN_IN_ACK_REASONS and the dialog.
      const v = await f.person(org, { engagement: "visitor", roll: null });
      expect(await send(v.id, v.email!)).toMatchObject({ kind: "ok", acknowledged: [] });
      expect((await auditFor("invitation.created", v.id))[0]!.metadata).toMatchObject({ acknowledged: [] });

      const m = await f.person(org);
      expect(await send(m.id, m.email!, true)).toMatchObject({ kind: "ok", acknowledged: [] });
      expect((await auditFor("invitation.created", m.id))[0]!.metadata).toMatchObject({ acknowledged: [] });
    });

    it("a second send to the same person is already_pending (nothing new written)", async () => {
      const p = await f.person(org);
      expect((await send(p.id, p.email!)).kind).toBe("ok");
      const before = await counts(p.id);
      expect(await send(p.id, p.email!)).toEqual({ kind: "refused", reason: "already_pending", existingExpired: false });
      expect(await counts(p.id)).toEqual(before);
    });

    it("R21 and the officers rule: a Session member needs officers.manage; a person holding access the sender lacks is refused", async () => {
      const elder = await f.person(org);
      await f.seat(org, elder.id);
      const peopleOnly = await f.sender(org, ["people.manage"]);
      const asPeopleOnly = asSender({ actingPersonId: peopleOnly.personId, actingUserId: peopleOnly.userId, actingUserEmail: peopleOnly.email });
      expect(await lib.sendSignInInvitation(asPeopleOnly, { personId: elder.id, confirmedAddress: elder.email!, acknowledged: false })).toMatchObject({
        kind: "refused",
        reason: "needs_officers_permission",
        personName: expect.stringContaining("Wendeline"),
      });
      expect((await send(elder.id, elder.email!)).kind).toBe("ok");

      const holder = await f.person(org);
      await f.personGrant(org, holder.id, ["directory.view"]);
      expect(await lib.sendSignInInvitation(asPeopleOnly, { personId: holder.id, confirmedAddress: holder.email!, acknowledged: false })).toMatchObject({
        kind: "refused",
        reason: "exceeds_your_access",
      });
    });

    it("a sender without people.manage is forbidden and writes nothing", async () => {
      const nobody = await f.sender(org, []);
      const p = await f.person(org);
      const before = await counts(p.id);
      const result = await lib.sendSignInInvitation(
        asSender({ actingPersonId: nobody.personId, actingUserId: nobody.userId }),
        { personId: p.id, confirmedAddress: p.email!, acknowledged: false },
      );
      expect(result).toEqual({ kind: "forbidden" });
      expect(await counts(p.id)).toEqual(before);
    });

    it("a person at ANOTHER organization, and an id that does not exist, are the same not_found (no cross-organization oracle)", async () => {
      const foreign = await f.person(other);
      expect(await send(foreign.id, foreign.email!)).toEqual({ kind: "refused", reason: "not_found" });
      expect(await send("00000000-0000-4000-8000-000000000000", "a@example.invalid")).toEqual({ kind: "refused", reason: "not_found" });
    });

    it("a user from another organization cannot act here: the acting person is not a member of this organization", async () => {
      const outsider = await f.sender(other, ["people.manage"]);
      const p = await f.person(org);
      const result = await lib.sendSignInInvitation(
        asSender({ actingPersonId: outsider.personId, actingUserId: outsider.userId }),
        { personId: p.id, confirmedAddress: p.email!, acknowledged: false },
      );
      expect(result).toEqual({ kind: "forbidden" });
      expect(await rowsFor(p.id)).toHaveLength(0);
    });

    it("RULE 7: a FORCED failure of the audit insert leaves no invitation, no queue row and no audit row; the same send then works", async () => {
      const p = await f.person(org);
      const before = await counts(p.id);
      auditControl.fail = true;
      const result = await send(p.id, p.email!);
      auditControl.fail = false;
      expect(result).toEqual({ kind: "db_error" });
      expect(await counts(p.id)).toEqual(before);
      expect(sendMock).not.toHaveBeenCalled();
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain(p.email!);
      expect(logged).not.toContain(p.id);

      expect((await send(p.id, p.email!)).kind).toBe("ok");
      expect(await rowsFor(p.id)).toHaveLength(1);
    });
  });

  // ===========================================================================
  describe("resend", () => {
    /**
     * An open sign_in row created 10 minutes ago (past the 5-minute cooldown)
     * with a still-queued credential email, on the owner connection with a known
     * token (identity columns are immutable, so the age is set at insert).
     */
    async function pendingWithAgedRow(): Promise<{ personId: string; email: string; firstQueue: string; firstId: string; token: string }> {
      const p = await f.person(org);
      const [q] = await f.q(sql`
        insert into email_queue (to_email, subject, html_body, text_body, template_key, status)
        values (${p.email}, 's', '<a href="http://localhost/invite?token=seeded">x</a>', 'http://localhost/invite?token=seeded',
                'account_sign_in_invitation', 'queued')
        returning id`);
      const firstQueue = String(q!.id);
      const inv = await f.signInRow(org, p.id, p.email!, {
        createdAt: sql`now() - interval '10 minutes'`,
        expiresAt: sql`now() + interval '6 days'`,
        createdBy: sender.userId,
        emailQueueId: firstQueue,
      });
      return { personId: p.id, email: p.email!, firstQueue, firstId: inv.id, token: inv.token };
    }

    it("supersedes the open row, cancels and SCRUBS the earlier still-queued email, queues a new one at the CURRENT address, and audits invitation.resent with the chain position", async () => {
      const s = await pendingWithAgedRow();
      expect((await queueRow(s.firstQueue)).status).toBe("queued");
      const newAddress = f.email("moved");
      await replaceAddress(s.personId, newAddress);

      const result = await lib.resendSignInInvitation(ctx, { personId: s.personId, confirmedAddress: newAddress, acknowledged: false });
      expect(result).toMatchObject({ kind: "ok", address: newAddress });
      if (result.kind !== "ok") return;

      const rows = await rowsFor(s.personId);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.superseded_at).not.toBeNull();
      expect(rows[1]).toMatchObject({ id: result.invitationId, resend_count: 1, email_normalized: newAddress, resent_from_id: s.firstId });

      const earlier = await queueRow(s.firstQueue);
      expect(earlier.status).toBe("cancelled");
      expect(earlier.html_body).toBe(MARKER);
      expect(earlier.text_body).toBe(MARKER);
      expect((await queueRow(String(rows[1]!.email_queue_id))).to_email).toBe(newAddress);

      const audit = await auditFor("invitation.resent", s.personId);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({ invitationId: result.invitationId, purpose: "sign_in", origin: "org", resendCount: 1 });
    });

    it("the EARLIER link no longer resolves and the new one does", async () => {
      const s = await pendingWithAgedRow();
      expect(await f.preview(s.token)).toHaveLength(1);
      sendMock.mockRejectedValue(new Error("provider down")); // keep the new body unscrubbed to read its token
      expect((await lib.resendSignInInvitation(ctx, { personId: s.personId, confirmedAddress: s.email, acknowledged: false })).kind).toBe("ok");
      const rows = await rowsFor(s.personId);
      const newToken = /invite\?token=([A-Za-z0-9_-]{43})/.exec(String((await queueRow(String(rows[1]!.email_queue_id))).text_body))![1]!;
      expect(await f.preview(s.token)).toHaveLength(0);
      expect(await f.preview(newToken)).toHaveLength(1);
    });

    it("within the cooldown it is refused with when Send again opens, and the open row is untouched", async () => {
      const p = await f.person(org);
      await send(p.id, p.email!);
      const before = await counts(p.id);
      const result = await lib.resendSignInInvitation(ctx, { personId: p.id, confirmedAddress: p.email!, acknowledged: false });
      expect(result).toMatchObject({ kind: "refused", reason: "cooldown" });
      if (result.kind === "refused") expect(result.nextResendAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await counts(p.id)).toEqual(before);
    });

    it("RULE 7: a FORCED audit failure leaves the open invitation open and nothing superseded or queued", async () => {
      const s = await pendingWithAgedRow();
      const before = await counts(s.personId);
      auditControl.fail = true;
      const result = await lib.resendSignInInvitation(ctx, { personId: s.personId, confirmedAddress: s.email, acknowledged: false });
      auditControl.fail = false;
      expect(result).toEqual({ kind: "db_error" });
      expect(await counts(s.personId)).toEqual(before);
      const rows = await rowsFor(s.personId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.superseded_at).toBeNull();
      expect((await queueRow(s.firstQueue)).status).toBe("queued");
    });

    it("nothing open is not_open", async () => {
      const p = await f.person(org);
      expect(await lib.resendSignInInvitation(ctx, { personId: p.id, confirmedAddress: p.email!, acknowledged: false })).toEqual({
        kind: "refused",
        reason: "not_open",
      });
    });
  });

  // ===========================================================================
  describe("revoke", () => {
    it("revokes, cancels and scrubs the still-queued email, and audits invitation.revoked via 'single'", async () => {
      sendMock.mockRejectedValue(new Error("provider down"));
      const p = await f.person(org);
      await send(p.id, p.email!);
      const [row] = await rowsFor(p.id);
      expect(await lib.revokeSignInInvitation(ctx, { personId: p.id })).toEqual({ kind: "ok" });
      const [after] = await rowsFor(p.id);
      expect(after!.revoked_at).not.toBeNull();
      expect(after!.revoked_by_user_id).toBe(sender.userId);
      const queue = await queueRow(String(row!.email_queue_id));
      expect(queue.status).toBe("cancelled");
      expect(queue.html_body).toBe(MARKER);
      const audit = await auditFor("invitation.revoked", p.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toEqual({
        invitationId: String(row!.id), organizationId: org, purpose: "sign_in", origin: "org", personId: p.id, via: "single",
      });
    });

    it("a second revoke is not_open; a cancel refunds no limit (the row stays counted)", async () => {
      const p = await f.person(org);
      await send(p.id, p.email!);
      expect(await lib.revokeSignInInvitation(ctx, { personId: p.id })).toEqual({ kind: "ok" });
      expect(await lib.revokeSignInInvitation(ctx, { personId: p.id })).toEqual({ kind: "refused", reason: "not_open" });
      expect(await rowsFor(p.id)).toHaveLength(1);
    });

    it("RULE 7: a FORCED audit failure leaves the invitation open and the email queued", async () => {
      sendMock.mockRejectedValue(new Error("provider down"));
      const p = await f.person(org);
      await send(p.id, p.email!);
      const [row] = await rowsFor(p.id);
      auditControl.fail = true;
      expect(await lib.revokeSignInInvitation(ctx, { personId: p.id })).toEqual({ kind: "db_error" });
      auditControl.fail = false;
      expect((await rowsFor(p.id))[0]!.revoked_at).toBeNull();
      expect((await queueRow(String(row!.email_queue_id))).status).toBe("queued");
    });

    it("a sender without people.manage cannot cancel", async () => {
      const p = await f.person(org);
      await send(p.id, p.email!);
      const nobody = await f.sender(org, []);
      expect(await lib.revokeSignInInvitation(asSender({ actingPersonId: nobody.personId, actingUserId: nobody.userId }), { personId: p.id })).toEqual({
        kind: "forbidden",
      });
      expect((await rowsFor(p.id))[0]!.revoked_at).toBeNull();
    });
  });

  // ===========================================================================
  describe("the card, the markers and the Session rows (the real reader)", () => {
    it("the card for an unconnected person reads by_sign_in; after a send it reads pending with the address, expiry and delivery; a connected person reads connected with how", async () => {
      const p = await f.person(org);
      const before = await lib.getSignInCard(ctx, p.id);
      expect(before).toMatchObject({ kind: "ok", card: { state: "none", linked: false, address: p.email, outlook: "by_sign_in", selfConnectEnabled: true } });

      await send(p.id, p.email!);
      const pending = (await lib.getSignInCard(ctx, p.id)) as { card: import("./sign-in-types").SignInCardState };
      expect(pending.card).toMatchObject({ state: "pending", invitedAddress: p.email, addressCurrent: true, delivery: "sent", resendCount: 0, outlook: "none" });
      expect(pending.card.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      expect(pending.card.cooldownMinutes).toBeGreaterThan(0);

      const linked = await f.person(org);
      const userId = await f.user(linked.email!);
      await f.linkUser(linked.id, userId);
      expect(await lib.getSignInCard(ctx, linked.id)).toMatchObject({ card: { state: "signs_in", linked: true, outlook: "connected" } });
    });

    it("an address that left the record is withheld and marks the earlier link as stale", async () => {
      const p = await f.person(org);
      await send(p.id, p.email!);
      await replaceAddress(p.id, f.email("later"));
      const card = (await lib.getSignInCard(ctx, p.id)) as { card: import("./sign-in-types").SignInCardState };
      expect(card.card.state).toBe("pending");
      expect(card.card.addressCurrent).toBe(false);
      expect(card.card.invitedAddress).toBeNull();
    });

    it("a visitor, a shared address and an off toggle are surfaced from the real standing core and toggle row", async () => {
      const v = await f.person(org, { engagement: "visitor", roll: null });
      expect(await lib.getSignInCard(ctx, v.id)).toMatchObject({ card: { isVisitor: true, outlook: "visitor" } });

      const a = await f.person(org);
      const b = await f.person(org, { email: false });
      await f.addEmail(b.id, a.email!);
      expect(await lib.getSignInCard(ctx, a.id)).toMatchObject({ card: { addressShared: true, outlook: "shared_address" } });

      const quiet = await f.congregation("quiet", { toggle: false });
      const quietSender = await f.sender(quiet, ["people.manage"]);
      const q = await f.person(quiet);
      const card = await lib.getSignInCard(
        { organizationId: quiet, actingPersonId: quietSender.personId, actingUserId: quietSender.userId },
        q.id,
      );
      expect(card).toMatchObject({ card: { selfConnectEnabled: false, outlook: "turned_off" } });
    });

    it("a person at another organization is not_found; a non-manager is forbidden", async () => {
      const foreign = await f.person(other);
      expect(await lib.getSignInCard(ctx, foreign.id)).toEqual({ kind: "not_found" });
      const nobody = await f.sender(org, []);
      expect(await lib.getSignInCard(asSender({ actingPersonId: nobody.personId, actingUserId: nobody.userId }), foreign.id)).toEqual({ kind: "forbidden" });
    });

    it("markers: pending, inert authority (with 'no email'), nothing for an ordinary member or a connected person; {} for a non-manager", async () => {
      const pendingPerson = await f.person(org);
      await send(pendingPerson.id, pendingPerson.email!);
      const elder = await f.person(org, { email: false });
      await f.seat(org, elder.id);
      const ordinary = await f.person(org);
      const connected = await f.person(org);
      await f.linkUser(connected.id, await f.user(connected.email!));

      const ids = [pendingPerson.id, elder.id, ordinary.id, connected.id];
      const markers = await lib.getSignInMarkers(ctx, ids);
      expect(markers[pendingPerson.id]).toMatchObject({ kind: "pending" });
      expect(markers[elder.id]).toEqual({ kind: "not_connected", noEmail: true });
      expect(markers[ordinary.id]).toBeUndefined();
      expect(markers[connected.id]).toBeUndefined();

      const nobody = await f.sender(org, []);
      expect(await lib.getSignInMarkers(asSender({ actingPersonId: nobody.personId, actingUserId: nobody.userId }), ids)).toEqual({});
    });

    it("an expired invitation reads expired in the marker and the card offers Send a new one", async () => {
      const p = await f.person(org);
      await f.signInRow(org, p.id, p.email!, {
        createdAt: sql`now() - interval '9 days'`,
        expiresAt: sql`now() - interval '2 days'`,
        createdBy: sender.userId,
      });
      expect((await lib.getSignInMarkers(ctx, [p.id]))[p.id]).toEqual({ kind: "expired" });
      expect(await lib.getSignInCard(ctx, p.id)).toMatchObject({ card: { state: "expired" } });
    });

    it("Session rows: a seat in effect with no login, by state; a seat that has not started, a connected member and a Session of another organization are absent; both permissions are required", async () => {
      const room = await f.congregation("session-room");
      const roomSender = await f.sender(room, ["people.manage", "officers.manage"]);
      const roomCtx = { organizationId: room, actingPersonId: roomSender.personId, actingUserId: roomSender.userId, actingUserEmail: roomSender.email };

      const noEmail = await f.person(room, { email: false });
      const notInvited = await f.person(room);
      const invited = await f.person(room);
      const later = await f.person(room);
      const linked = await f.person(room);
      for (const p of [noEmail, notInvited, invited, linked]) await f.seat(room, p.id);
      await f.seat(room, later.id, "ruling_elder", "2099-01-01");
      await f.linkUser(linked.id, await f.user(linked.email!));
      await f.signInRow(room, invited.id, invited.email!, { createdBy: roomSender.userId });

      const result = await lib.listSessionSignInRows(roomCtx);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const byId = new Map(result.rows.map((r) => [r.personId, r]));
      expect(byId.get(noEmail.id)).toMatchObject({ state: "no_email", action: "open" });
      expect(byId.get(notInvited.id)).toMatchObject({ state: "not_invited", action: "invite" });
      expect(byId.get(invited.id)).toMatchObject({ state: "sent", action: "open" });
      expect(byId.has(later.id)).toBe(false);
      expect(byId.has(linked.id)).toBe(false);
      expect(byId.has(roomSender.personId)).toBe(false); // the sender is linked

      const peopleOnly = await f.sender(room, ["people.manage"]);
      expect(await lib.listSessionSignInRows({ ...roomCtx, actingPersonId: peopleOnly.personId, actingUserId: peopleOnly.userId })).toEqual({ kind: "forbidden" });
      const officersOnly = await f.sender(room, ["officers.manage"]);
      expect(await lib.listSessionSignInRows({ ...roomCtx, actingPersonId: officersOnly.personId, actingUserId: officersOnly.userId })).toEqual({ kind: "forbidden" });
    });
  });
});
