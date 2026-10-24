/**
 * src/lib/onboarding/issue.ts on a REAL Postgres connection
 * (docs/work-log/2026-10-21-invitations.md, Phase 3 Batch 2b; Phase 2 R4/R7/R8
 * and the addendum's D-2). One test per outcome, plus the properties that make
 * the issue side safe:
 *
 *   - RULE 7, AUDIT IN THE SAME TRANSACTION: created, resent, revoked and
 *     revoked-all each leave exactly their audit row, ids only; and a FAILED
 *     audit insert (the audit-tx module is wrapped so a test can make it throw)
 *     rolls the whole change back - no invitation row, no queue row, no
 *     supersede, no revoke.
 *   - ATOMIC QUEUE LINK: the invitation, its `email_queue` row and the link
 *     between them commit together; a provider that fails leaves the row
 *     `queued` WITH the link, a later worker success redacts it, and a
 *     delivered row's body is the redaction marker.
 *   - THE LINK IS THE CREDENTIAL: the token embedded in the queued email hashes
 *     to the stored `token_hash`, and the real preview function resolves it.
 *   - NO ENUMERATION: the result shape for an address that has an account is
 *     identical to one that does not.
 *   - DURABLE LIMITS count superseded/revoked rows, and never count a row dated
 *     in the future (the dev seed carries rows dated 2099).
 *   - Every refusal leaves nothing behind.
 *
 * Fixtures are `example.invalid`; the suite's `email_queue` rows (no FK) and
 * audit rows are deleted at teardown by address pattern / organization id.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/issue.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
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

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const MARKER = "[Removed after delivery: this message contained a one-time sign-in link.]";

describe.skipIf(!hasDb)("src/lib/onboarding/issue.ts (Postgres-backed)", { timeout: 60_000 }, () => {
  let fx: InvitationFixture;
  let issue: typeof import("./issue");
  let queue: typeof import("@/lib/email/queue");
  let operator: string; // the fixture creator of seeded rows
  let inviter: string; // a fresh user per test: the ACTOR under test (the per-inviter limit is 20 per 24h)
  const orgIds: string[] = [];
  const actor = () => ({ userId: inviter, email: null as string | null });

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  async function org(type: "congregation" | "presbytery" | "synod" | "new_worshiping_community" = "congregation") {
    const id = await fx.makeOrg("iss", { organizationType: type });
    orgIds.push(id);
    return id;
  }

  /** An active, unlinked member carrying an on-file email address. */
  async function member(orgId: string, address: string, first = "Odalys") {
    const person = await fx.makePerson(first, "Pennick");
    await fx.addMember(orgId, person);
    await fx.addEmail(person, address);
    return person;
  }

  async function auditRows(action: string, orgId: string): Promise<Row[]> {
    return q(sql`select * from audit_events where action = ${action} and metadata->>'organizationId' = ${orgId} order by created_at`);
  }

  async function invitationsOf(orgId: string): Promise<Row[]> {
    return q(sql`select * from account_invitations where organization_id = ${orgId} order by created_at, resend_count`);
  }

  async function queueRow(id: string): Promise<Row> {
    return (await q(sql`select * from email_queue where id = ${id}`))[0]!;
  }

  async function queueRowsTo(address: string): Promise<Row[]> {
    return q(sql`select * from email_queue where to_email = ${address}`);
  }

  /** An owner-inserted queue row for an invitation fixture (status queued, link in the body). */
  async function seedQueueRow(address: string, status = "queued", token = "x".repeat(43)): Promise<string> {
    const link = `http://localhost:3000/invite?token=${token}`;
    const [row] = await q(sql`
      insert into email_queue (to_email, subject, html_body, text_body, template_key, status)
      values (${address}, 's', ${`<a href="${link}">${link}</a>`}, ${link}, 'account_invitation', ${status})
      returning id`);
    return String(row!.id);
  }

  function tokenFrom(body: string): string {
    const m = /invite\?token=([A-Za-z0-9_-]{43})/.exec(body);
    expect(m, "the queued body carries the accept link").not.toBeNull();
    return m![1]!;
  }

  const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

  /** An open row, plus a chain of `n` resends behind it (parents superseded). Returns the head. */
  async function chainOfLength(orgId: string, address: string, resends: number) {
    let previous: { id: string } | null = null;
    let head: { id: string; token: string; tokenHash: string } | null = null;
    for (let i = 0; i <= resends; i += 1) {
      head = await fx.insertInvitation({
        organizationId: orgId,
        purpose: "founding_administrator",
        email: address,
        createdByUserId: operator,
        firstName: "Chain",
        lastName: "Head",
        createdAt: sql`now() - interval '10 minutes'`,
        expiresAt: sql`now() + interval '2 days'`,
        resentFromId: previous?.id ?? null,
        resendCount: i,
      });
      if (i < resends) {
        await q(sql`update account_invitations set superseded_at = now() where id = ${head.id}`);
      }
      previous = head;
    }
    return head!;
  }

  beforeAll(async () => {
    delete process.env.EMAIL_DEV_INTERCEPT;
    delete process.env.EMAIL_DEV_REDIRECT_TO;
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("inv-issue");
    operator = fx.actingUserId;
    issue = await import("./issue");
    queue = await import("@/lib/email/queue");

    // The race injector (see "D-2 race backstop"): a test-only trigger that is a
    // no-op for every row except an email_queue insert addressed to
    // `inv-issue-race-<32 hex of an org id>@example.invalid`. It then inserts a
    // COMPETING open founding-administrator invitation for that org inside the
    // same transaction, so the real invitation insert that follows violates the
    // partial unique index - the real error, through the real code path.
    // Created here and dropped in afterAll (pipeline Neon branch only).
    await q(sql.raw(`
      create or replace function presby_test_issue_race() returns trigger
      language plpgsql set search_path = public, pg_temp as $f$
      declare v_hex text; v_org uuid;
      begin
        if new.to_email like 'inv-issue-race-%@example.invalid' then
          v_hex := substr(new.to_email, 16, 32);
          v_org := (substr(v_hex,1,8)||'-'||substr(v_hex,9,4)||'-'||substr(v_hex,13,4)||'-'||substr(v_hex,17,4)||'-'||substr(v_hex,21,12))::uuid;
          insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name,
                 invitee_last_name, token_hash, created_by_user_id, expires_at)
          values (v_org, 'founding_administrator', 'rival-' || v_hex || '@example.invalid', 'Rival', 'Row',
                 encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
                 (select id from users order by created_at limit 1), now() + interval '1 day');
        end if;
        return new;
      end $f$;
      drop trigger if exists zz_test_issue_race on email_queue;
      create trigger zz_test_issue_race before insert on email_queue for each row execute function presby_test_issue_race();
    `));
  });

  beforeEach(async () => {
    inviter = await fx.makeUser(fx.email("inviter"));
  });

  afterEach(() => {
    auditControl.fail = false;
    vi.unstubAllEnvs();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ id: "provider-ok" });
  });

  afterAll(async () => {
    if (!fx) return;
    try {
      await q(sql.raw(`
        drop trigger if exists zz_test_issue_race on email_queue;
        drop function if exists presby_test_issue_race();
      `));
      for (const id of orgIds) {
        await q(sql`delete from audit_events where metadata->>'organizationId' = ${id}`);
      }
      await q(sql`delete from email_queue where to_email like 'inv-issue-%@example.invalid'`);
    } finally {
      await fx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  describe("createInvitation: created (founding administrator)", () => {
    it("creates the invitation, its queue row and the audit row in one commit; delivered -> sent, body redacted", async () => {
      sendMock.mockResolvedValue({ id: "prov-1" });
      const orgId = await org();
      const address = fx.email("fa-ok");
      const result = await issue.createInvitation({
        organizationId: orgId,
        purpose: "founding_administrator",
        email: `  ${address.toUpperCase()} `,
        firstName: "  Marisol ",
        lastName: "Quenby",
        inviter: actor(),
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.delivery).toBe("sent");
      expect(result.selfAddressed).toBe(false);

      const [inv] = await invitationsOf(orgId);
      expect(inv).toMatchObject({
        id: result.invitationId,
        purpose: "founding_administrator",
        origin: "platform",
        email_normalized: address,
        invitee_first_name: "Marisol",
        invitee_last_name: "Quenby",
        person_id: null,
        created_by_user_id: inviter,
        resend_count: 0,
        resent_from_id: null,
        accepted_at: null,
        revoked_at: null,
        superseded_at: null,
        blocked_at: null,
      });
      const [lifetime] = await q(sql`select extract(epoch from (expires_at - created_at)) / 86400 as days from account_invitations where id = ${result.invitationId}`);
      expect(Number(lifetime!.days)).toBeGreaterThan(6.99);
      expect(Number(lifetime!.days)).toBeLessThanOrEqual(7.01);

      // The queue row: linked at insert, addressed, templated, SENT, body redacted.
      const queued = await queueRow(String(inv!.email_queue_id));
      expect(queued).toMatchObject({
        to_email: address,
        template_key: "account_invitation",
        status: "sent",
        html_body: MARKER,
        text_body: MARKER,
        from_email: null,
      });
      expect(sendMock).toHaveBeenCalledTimes(1);

      // Rule 7: exactly one audit row, ids only.
      const audit = await auditRows("invitation.created", orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_user_id: inviter,
        resource_type: "account_invitation",
        resource_id: result.invitationId,
      });
      const metadata = audit[0]!.metadata as Record<string, unknown>;
      expect(Object.keys(metadata).sort()).toEqual(
        ["acknowledgedDoNotContact", "expiresAt", "invitationId", "organizationId", "personId", "purpose", "selfAddressed"],
      );
      expect(metadata).toMatchObject({
        invitationId: result.invitationId,
        organizationId: orgId,
        purpose: "founding_administrator",
        personId: null,
        selfAddressed: false,
        acknowledgedDoNotContact: false,
      });
      expect(JSON.stringify(audit[0])).not.toContain(address);
      expect(JSON.stringify(audit[0])).not.toContain(String(inv!.token_hash));
    });

    it("a failing provider leaves the row queued WITH a working link; a later worker success redacts it", async () => {
      sendMock.mockRejectedValue(new Error("provider down"));
      const orgId = await org();
      const address = fx.email("fa-queued");
      const result = await issue.createInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address,
        firstName: "Marisol", lastName: "Quenby", inviter: actor(),
      });
      expect(result).toMatchObject({ kind: "ok", delivery: "queued" });
      const [inv] = await invitationsOf(orgId);
      const queued = await queueRow(String(inv!.email_queue_id));
      expect(queued).toMatchObject({ status: "queued", attempt_count: 1, failure_reason: "provider down" });

      // The link: the app origin, and the embedded token IS the stored credential.
      const html = String(queued.html_body);
      const text = String(queued.text_body);
      expect(html).toContain('href="http://localhost:3000/invite?token=');
      const token = tokenFrom(text);
      expect(tokenFrom(html)).toBe(token);
      expect(sha(token)).toBe(inv!.token_hash);
      const preview = await fx.preview(token);
      expect(preview).toHaveLength(1);
      expect(preview[0]).toMatchObject({ purpose: "founding_administrator", invitee_first_name: "Marisol" });
      // The address is never in the body.
      expect(html + text).not.toContain(address);

      // Worker: the claim orders by next_attempt_at ascending, so a row due
      // since 1970 is the oldest eligible row on any branch and `limit 1`
      // claims exactly it (the branch also carries stale queued rows that
      // this test must neither send nor mutate).
      await q(sql`update email_queue set next_attempt_at = '1970-01-01T00:00:00Z' where id = ${queued.id as string}`);
      sendMock.mockReset();
      sendMock.mockResolvedValue({ id: "prov-worker" });
      const batch = await queue.processQueueBatch(1);
      expect(batch).toMatchObject({ claimed: 1, sent: 1 });
      expect(await queueRow(String(queued.id))).toMatchObject({ status: "sent", html_body: MARKER, text_body: MARKER });
    });

    it("an address with an account and one without produce the identical result shape and queue shape (no enumeration)", async () => {
      sendMock.mockResolvedValue({ id: "prov" });
      const known = fx.email("known");
      await fx.makeUser(known);
      const unknown = fx.email("unknown");
      const a = await issue.createInvitation({ organizationId: await org(), purpose: "founding_administrator", email: known, firstName: "A", lastName: "B", inviter: actor() });
      const b = await issue.createInvitation({ organizationId: await org(), purpose: "founding_administrator", email: unknown, firstName: "A", lastName: "B", inviter: actor() });
      expect(a.kind).toBe("ok");
      expect(b.kind).toBe("ok");
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      if (a.kind === "ok" && b.kind === "ok") {
        expect(a.delivery).toBe(b.delivery);
        expect(a.selfAddressed).toBe(b.selfAddressed);
      }
      const [qa] = await queueRowsTo(known);
      const [qb] = await queueRowsTo(unknown);
      for (const key of ["template_key", "status", "subject", "html_body", "text_body", "from_email", "attempt_count"]) {
        expect(qa![key], key).toEqual(qb![key]);
      }
    });

    it("a self-addressed send is allowed and stamped selfAddressed (operator ruling on R9)", async () => {
      const orgId = await org();
      const address = fx.email("self");
      const result = await issue.createInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address,
        firstName: "Own", lastName: "Self", inviter: { userId: inviter, email: address.toUpperCase() },
      });
      expect(result).toMatchObject({ kind: "ok", selfAddressed: true });
      const [audit] = await auditRows("invitation.created", orgId);
      expect((audit!.metadata as Record<string, unknown>).selfAddressed).toBe(true);
    });

    it("a FAILED audit insert rolls the whole create back: no invitation, no queue row", async () => {
      const orgId = await org();
      const address = fx.email("fa-rollback");
      auditControl.fail = true;
      const result = await issue.createInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address,
        firstName: "Marisol", lastName: "Quenby", inviter: actor(),
      });
      expect(result).toEqual({ kind: "db_error" });
      expect(await invitationsOf(orgId)).toHaveLength(0);
      expect(await queueRowsTo(address)).toHaveLength(0);
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("createInvitation: created (treasurer)", () => {
    it("resolves the person from the on-file email FIRST and carries them on the row and in the audit", async () => {
      sendMock.mockRejectedValue(new Error("provider down"));
      const orgId = await org();
      const address = fx.email("tr-ok");
      const person = await member(orgId, address, "Odalys");
      const result = await issue.createInvitation({
        organizationId: orgId, purpose: "treasurer", email: address, inviter: actor(),
      });
      expect(result.kind).toBe("ok");
      const [inv] = await invitationsOf(orgId);
      expect(inv).toMatchObject({
        purpose: "treasurer", person_id: person, invitee_first_name: null, invitee_last_name: null,
      });
      const queued = await queueRow(String(inv!.email_queue_id));
      expect(String(queued.text_body)).toContain("Hello Odalys,");
      expect(String(queued.text_body)).toContain("the treasurer");
      const [audit] = await auditRows("invitation.created", orgId);
      expect(audit!.metadata).toMatchObject({ purpose: "treasurer", personId: person });
    });
  });

  // -------------------------------------------------------------------------
  // docs/work-log/2026-10-23-person-emails.md: ER3a (the TypeScript readers learn
  // `ended_at`) and the operator-ruled signed-in-address warning.
  describe("createInvitation: contact rows (person-emails)", () => {
    /** End an address the way the store does: clear the main flag and stamp ended_at in one statement. */
    async function endAddresses(personId: string) {
      await q(sql`update contact_methods set is_primary = false, ended_at = now() where person_id = ${personId} and kind = 'email'`);
    }
    /** Owner-side insert of an ENDED row for an address (the guard lets the owner set ended_at at insert). */
    async function insertEndedAddress(personId: string, address: string, doNotContact = false) {
      await q(sql`
        insert into contact_methods (person_id, kind, value, is_primary, do_not_contact, ended_at)
        values (${personId}, 'email', ${address}, false, ${doNotContact}, now())`);
    }

    it("an ENDED address does not resolve a treasurer: the person has no address on file (no_matching_person)", async () => {
      const orgId = await org();
      const address = fx.email("tr-ended-addr");
      const person = await member(orgId, address);
      await endAddresses(person);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r).toEqual({ kind: "no_matching_person" });
      expect(await invitationsOf(orgId)).toHaveLength(0);
    });

    it("another person's ENDED copy of the address does not make it ambiguous: the active holder resolves", async () => {
      const orgId = await org();
      const address = fx.email("tr-ended-copy");
      const active = await member(orgId, address, "Odalys");
      const formerHolder = await fx.makePerson("Odell", "Pennick");
      await fx.addMember(orgId, formerHolder);
      await insertEndedAddress(formerHolder, address);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r.kind).toBe("ok");
      const [inv] = await invitationsOf(orgId);
      expect(inv!.person_id).toBe(active);
    });

    it("an ended do-not-contact copy of an address does NOT trigger the warning for its active replacement", async () => {
      const orgId = await org();
      const address = fx.email("tr-dnc-ended");
      const person = await member(orgId, address);
      await insertEndedAddress(person, address, true);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r.kind).toBe("ok");
    });

    it("an ACTIVE do-not-contact address still needs the acknowledgement (the ended predicate did not weaken it)", async () => {
      const orgId = await org();
      const address = fx.email("tr-dnc-active");
      const person = await member(orgId, address);
      await q(sql`update contact_methods set do_not_contact = true where person_id = ${person} and ended_at is null`);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r).toEqual({ kind: "needs_acknowledgement", reason: "do_not_contact" });
    });
  });

  // -------------------------------------------------------------------------
  describe("createInvitation: the signed-in-address warning (operator ruling 2026-10-23)", () => {
    /** An active roster member with the address on file, linked to an account (people.user_id set). */
    async function signedInMember(orgId: string, address: string) {
      const person = await member(orgId, address);
      const userId = await fx.makeUser(fx.email("linked"));
      await fx.linkUser(person, userId);
      return person;
    }

    it("a treasurer invitation to an address on a person who already signs in is CREATED, with the warning (non-blocking)", async () => {
      const orgId = await org();
      const address = fx.email("warn-tr");
      const person = await signedInMember(orgId, address);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.warnings).toEqual(["address_on_signed_in_person"]);
      // non-blocking: the invitation, its queue row and the audit row all exist
      const [inv] = await invitationsOf(orgId);
      expect(inv).toMatchObject({ id: r.invitationId, person_id: person, purpose: "treasurer" });
      expect(await auditRows("invitation.created", orgId)).toHaveLength(1);
      expect(await queueRowsTo(address)).toHaveLength(1);
    });

    it("the same for a founding administrator whose address matches a signed-in roster person", async () => {
      const orgId = await org();
      const address = fx.email("warn-fa");
      await signedInMember(orgId, address);
      const r = await issue.createInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor(),
      });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.warnings).toEqual(["address_on_signed_in_person"]);
    });

    it("no warning (and no `warnings` key at all) when the person does not sign in", async () => {
      const orgId = await org();
      const address = fx.email("nowarn-unlinked");
      await member(orgId, address);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r.kind).toBe("ok");
      expect(r).not.toHaveProperty("warnings");
    });

    it("no warning for an address nobody has on file (a founding administrator's typed address)", async () => {
      const orgId = await org();
      const r = await issue.createInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: fx.email("nowarn-new"), firstName: "A", lastName: "B", inviter: actor(),
      });
      expect(r.kind).toBe("ok");
      expect(r).not.toHaveProperty("warnings");
    });

    it("no warning when the signed-in person's copy of the address has ENDED", async () => {
      const orgId = await org();
      const address = fx.email("nowarn-ended");
      const holder = await signedInMember(orgId, address);
      // an ended copy on the signed-in person, and an active copy on someone who does not sign in
      await q(sql`update contact_methods set is_primary = false, ended_at = now() where person_id = ${holder}`);
      await member(orgId, address, "Odalys");
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r.kind).toBe("ok");
      expect(r).not.toHaveProperty("warnings");
    });

    it("is scoped to THIS organization's roster: a signed-in person elsewhere with the address does not warn", async () => {
      const orgId = await org();
      const elsewhere = await org();
      const address = fx.email("nowarn-elsewhere");
      await signedInMember(elsewhere, address);
      const r = await issue.createInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor(),
      });
      expect(r.kind).toBe("ok");
      expect(r).not.toHaveProperty("warnings");
    });

    it("a merged person's link does not warn", async () => {
      const orgId = await org();
      const address = fx.email("nowarn-merged");
      const merged = await signedInMember(orgId, address);
      const survivor = await fx.makePerson("Surv", "Ivor");
      await q(sql`update people set merged_into_id = ${survivor} where id = ${merged}`);
      const r = await issue.createInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor(),
      });
      expect(r.kind).toBe("ok");
      expect(r).not.toHaveProperty("warnings");
      await q(sql`update people set merged_into_id = null where id = ${merged}`);
    });

    it("a warning changes nothing else: the audit row and the invitation row are those of an unwarned send", async () => {
      const orgId = await org();
      const address = fx.email("warn-same");
      await signedInMember(orgId, address);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r.kind).toBe("ok");
      const [audit] = await auditRows("invitation.created", orgId);
      expect(Object.keys(audit!.metadata as object).sort()).toEqual(
        ["acknowledgedDoNotContact", "expiresAt", "invitationId", "organizationId", "personId", "purpose", "selfAddressed"].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("createInvitation: refusals leave nothing behind", () => {
    async function expectNothing(orgId: string, address: string) {
      expect(await invitationsOf(orgId)).toHaveLength(0);
      expect(await queueRowsTo(address)).toHaveLength(0);
      expect(await auditRows("invitation.created", orgId)).toHaveLength(0);
    }

    it("has_holders (founding administrator): someone already holds roles.manage", async () => {
      const orgId = await org();
      const holder = await fx.makePerson("Hollis", "Holder");
      await fx.enroll(orgId, holder, ["roles.manage"]);
      const address = fx.email("fa-holders");
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor() });
      expect(r).toEqual({ kind: "has_holders" });
      await expectNothing(orgId, address);
    });

    it("has_holders (treasurer): someone already holds giving.manage", async () => {
      const orgId = await org();
      const holder = await fx.makePerson("Hollis", "Holder");
      await fx.enroll(orgId, holder, ["giving.manage"]);
      const address = fx.email("tr-holders");
      await member(orgId, address);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r).toEqual({ kind: "has_holders" });
      await expectNothing(orgId, address);
    });

    it("already_pending: a second designation for the same org and purpose, even for a different address", async () => {
      const orgId = await org();
      const first = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("p1"), firstName: "A", lastName: "B", inviter: actor() });
      expect(first.kind).toBe("ok");
      const address = fx.email("p2");
      const second = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "C", lastName: "D", inviter: actor() });
      expect(second).toMatchObject({ kind: "already_pending", invitationId: first.kind === "ok" ? first.invitationId : "", expired: false });
      expect(await invitationsOf(orgId)).toHaveLength(1);
      expect(await queueRowsTo(address)).toHaveLength(0);
    });

    it("already_pending reports an EXPIRED open row as expired (it keeps blocking until resent or revoked)", async () => {
      const orgId = await org();
      const stale = await fx.insertInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: fx.email("stale"), createdByUserId: operator,
        createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '2 days'`,
      });
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("fresh"), firstName: "A", lastName: "B", inviter: actor() });
      expect(r).toEqual({ kind: "already_pending", invitationId: stale.id, expired: true });
    });

    it("not_applicable: a treasurer at a presbytery", async () => {
      const orgId = await org("presbytery");
      const address = fx.email("tr-presbytery");
      await member(orgId, address);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r).toEqual({ kind: "not_applicable" });
      await expectNothing(orgId, address);
    });

    it("provisioning_incomplete: an org with no derived Active Membership group", async () => {
      const bare = await fx.makeBareOrg("iss-bare");
      orgIds.push(bare);
      const address = fx.email("bare");
      const r = await issue.createInvitation({ organizationId: bare, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor() });
      expect(r).toEqual({ kind: "provisioning_incomplete" });
      await expectNothing(bare, address);
    });

    it("no_matching_person: nobody enrolled at this congregation has that email (and a person at ANOTHER org does not count)", async () => {
      const orgId = await org();
      const elsewhere = await org();
      const address = fx.email("tr-nomatch");
      await member(elsewhere, address);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r).toEqual({ kind: "no_matching_person" });
      await expectNothing(orgId, address);
    });

    it("ambiguous_person: two active people at this org share the address", async () => {
      const orgId = await org();
      const address = fx.email("tr-ambig");
      await member(orgId, address, "Odalys");
      await member(orgId, address, "Odell");
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r).toEqual({ kind: "ambiguous_person" });
      await expectNothing(orgId, address);
    });

    it("membership_ended: the only match's membership has ended", async () => {
      const orgId = await org();
      const address = fx.email("tr-ended");
      const person = await member(orgId, address);
      await q(sql`update memberships set ended_on = current_date, ended_reason = 'transferred' where organization_id = ${orgId} and person_id = ${person}`);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(r).toEqual({ kind: "membership_ended" });
      await expectNothing(orgId, address);
    });

    it("needs_acknowledgement for a do_not_contact address; proceeds when acknowledged and says so in the audit", async () => {
      const orgId = await org();
      const address = fx.email("tr-dnc");
      const person = await member(orgId, address);
      await q(sql`update contact_methods set do_not_contact = true where person_id = ${person}`);
      const first = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor() });
      expect(first).toEqual({ kind: "needs_acknowledgement", reason: "do_not_contact" });
      await expectNothing(orgId, address);
      const second = await issue.createInvitation({ organizationId: orgId, purpose: "treasurer", email: address, inviter: actor(), acknowledgeDoNotContact: true });
      expect(second.kind).toBe("ok");
      const [audit] = await auditRows("invitation.created", orgId);
      expect((audit!.metadata as Record<string, unknown>).acknowledgedDoNotContact).toBe(true);
    });

    it("totp_unavailable: the TOTP encryption key is not configured", async () => {
      const orgId = await org();
      const address = fx.email("totp");
      vi.stubEnv("AUTH_TOTP_ENCRYPTION_KEY", "");
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor() });
      expect(r).toEqual({ kind: "totp_unavailable" });
      await expectNothing(orgId, address);
    });

    it("link_origin_unavailable: production with no valid NEXT_PUBLIC_APP_URL", async () => {
      const orgId = await org();
      const address = fx.email("origin");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor() });
      expect(r).toEqual({ kind: "link_origin_unavailable" });
      await expectNothing(orgId, address);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("invalid_input: validated before the database, each field named", async () => {
      const orgId = await org();
      const good = { organizationId: orgId, purpose: "founding_administrator" as const, email: fx.email("inval"), firstName: "A", lastName: "B", inviter: actor() };
      expect(await issue.createInvitation({ ...good, organizationId: "not-a-uuid" })).toEqual({ kind: "invalid_input", field: "organizationId" });
      expect(await issue.createInvitation({ ...good, organizationId: "c1000000-0000-4000-8000-0000000000aa" })).toEqual({ kind: "invalid_input", field: "organizationId" });
      expect(await issue.createInvitation({ ...good, email: "nope" })).toEqual({ kind: "invalid_input", field: "email" });
      expect(await issue.createInvitation({ ...good, firstName: "   " })).toEqual({ kind: "invalid_input", field: "firstName" });
      expect(await issue.createInvitation({ ...good, lastName: "x".repeat(101) })).toEqual({ kind: "invalid_input", field: "lastName" });
      expect(await issue.createInvitation({ ...good, purpose: "owner" as never })).toEqual({ kind: "invalid_input", field: "purpose" });
      expect(await invitationsOf(orgId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("createInvitation: durable limits (R8)", () => {
    async function rowsAt(orgId: string, email: string, by: string, count: number, revoke: boolean) {
      for (let i = 0; i < count; i += 1) {
        const row = await fx.insertInvitation({
          organizationId: orgId, purpose: "founding_administrator", email: i === 0 ? email : fx.email("lim"),
          createdByUserId: by,
        });
        if (revoke) await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${by} where id = ${row.id}`);
      }
    }

    it("per recipient address: 3 per 24 hours across organizations, revoked rows included", async () => {
      const address = fx.email("lim-addr");
      for (let i = 0; i < 3; i += 1) {
        const other = await org();
        const row = await fx.insertInvitation({ organizationId: other, purpose: "founding_administrator", email: address, createdByUserId: operator });
        await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${row.id}`);
      }
      const orgId = await org();
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor() });
      expect(r).toEqual({ kind: "rate_limited" });
      expect(await invitationsOf(orgId)).toHaveLength(0);
      expect(await queueRowsTo(address)).toHaveLength(0);
    });

    it("per organization: 10 per 24 hours", async () => {
      const orgId = await org();
      const other = await fx.makeUser(fx.email("lim-org-user"));
      await rowsAt(orgId, fx.email("lim-org"), other, 10, true);
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("lim-org-new"), firstName: "A", lastName: "B", inviter: actor() });
      expect(r).toEqual({ kind: "rate_limited" });
    });

    it("per inviter: 20 per 24 hours", async () => {
      const busy = await fx.makeUser(fx.email("lim-busy"));
      const spread = await org();
      await rowsAt(spread, fx.email("lim-inv"), busy, 20, true);
      const orgId = await org();
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("lim-inv-new"), firstName: "A", lastName: "B", inviter: { userId: busy, email: null } });
      expect(r).toEqual({ kind: "rate_limited" });
    });

    it("never counts a row dated in the future (the dev seed carries 2099 rows) - regression for the seed-poisoned limit", async () => {
      const address = fx.email("lim-future");
      for (let i = 0; i < 3; i += 1) {
        await fx.insertInvitation({
          organizationId: await org(), purpose: "founding_administrator", email: address, createdByUserId: operator,
          createdAt: sql`'2099-01-01'::timestamptz`, expiresAt: sql`'2099-01-08'::timestamptz`,
        });
      }
      const orgId = await org();
      const r = await issue.createInvitation({ organizationId: orgId, purpose: "founding_administrator", email: address, firstName: "A", lastName: "B", inviter: actor() });
      expect(r.kind).toBe("ok");
    });

    it("maps a unique violation on either open-row partial index to already_pending, by constraint name (D-2)", async () => {
      const orgId = await org();
      await fx.insertInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("uv1"), createdByUserId: operator });
      let caught: unknown = null;
      try {
        await fx.insertInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("uv2"), createdByUserId: operator });
      } catch (err) {
        caught = err;
      }
      expect(caught).not.toBeNull();
      expect(["account_invitations_open_designation_uq", "account_invitations_open_address_uq"]).toContain(
        issue.uniqueViolationConstraint(caught),
      );
      // Any OTHER unique violation (the token_hash key) is NOT an already_pending.
      const token = await fx.insertInvitation({ organizationId: await org(), purpose: "founding_administrator", email: fx.email("uv3"), createdByUserId: operator });
      let other: unknown = null;
      try {
        await q(sql`insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name, invitee_last_name, token_hash, created_by_user_id, expires_at)
                    values (${await org()}, 'founding_administrator', ${fx.email("uv4")}, 'A', 'B', ${token.tokenHash}, ${operator}, now() + interval '1 day')`);
      } catch (err) {
        other = err;
      }
      expect(issue.uniqueViolationConstraint(other)).toBe("account_invitations_token_hash_key");
    });
  });

  // -------------------------------------------------------------------------
  describe("D-2 race backstop: a real unique violation on the open-row partial index", () => {
    const raceAddress = (orgId: string) => `inv-issue-race-${orgId.replace(/-/g, "")}@example.invalid`;

    it("createInvitation maps it to already_pending (never db_error) and the whole transaction, including the rival row, rolls back", async () => {
      const orgId = await org();
      const address = raceAddress(orgId);
      const r = await issue.createInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address,
        firstName: "A", lastName: "B", inviter: actor(),
      });
      // The rival existed only inside the aborted transaction, so there is no open row to name.
      expect(r).toEqual({ kind: "already_pending", invitationId: null, expired: false });
      expect(await invitationsOf(orgId)).toHaveLength(0);
      expect(await queueRowsTo(address)).toHaveLength(0);
      expect(await auditRows("invitation.created", orgId)).toHaveLength(0);
    });

    it("resendInvitation maps it to not_open, and the supersede rolls back with it (the old row stays open)", async () => {
      const orgId = await org();
      const address = raceAddress(orgId);
      const old = await fx.insertInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address, createdByUserId: operator,
        firstName: "A", lastName: "B", createdAt: sql`now() - interval '10 minutes'`, expiresAt: sql`now() + interval '2 days'`,
      });
      const r = await issue.resendInvitation({ organizationId: orgId, invitationId: old.id, actor: actor() });
      expect(r).toEqual({ kind: "not_open" });
      const rows = await invitationsOf(orgId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.superseded_at).toBeNull();
      expect(await auditRows("invitation.resent", orgId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("resendInvitation", () => {
    async function seed(options: { sentQueue?: boolean; createdAgo?: string; expiresIn?: string } = {}) {
      const orgId = await org();
      const address = fx.email("rs");
      const queueId = await seedQueueRow(address, options.sentQueue ? "sent" : "queued");
      const old = await fx.insertInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address, createdByUserId: operator,
        firstName: "Marisol", lastName: "Quenby", emailQueueId: queueId,
        createdAt: sql.raw(`now() - interval '${options.createdAgo ?? "10 minutes"}'`),
        expiresAt: sql.raw(`now() + interval '${options.expiresIn ?? "2 days"}'`),
      });
      return { orgId, address, queueId, old };
    }

    it("supersedes the old row FIRST, inserts the successor with lineage, cancels the unsent old email, audits - one commit", async () => {
      sendMock.mockRejectedValue(new Error("provider down"));
      const s = await seed();
      const r = await issue.resendInvitation({ organizationId: s.orgId, invitationId: s.old.id, actor: actor() });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.delivery).toBe("queued");

      const rows = await invitationsOf(s.orgId);
      expect(rows).toHaveLength(2);
      const oldRow = rows.find((x) => x.id === s.old.id)!;
      const newRow = rows.find((x) => x.id === r.invitationId)!;
      expect(oldRow.superseded_at).not.toBeNull();
      expect(oldRow.token_hash).toBe(s.old.tokenHash); // never rotated
      expect(newRow).toMatchObject({
        resent_from_id: s.old.id, resend_count: 1, purpose: "founding_administrator", email_normalized: s.address,
        invitee_first_name: "Marisol", invitee_last_name: "Quenby", person_id: null, created_by_user_id: inviter,
        superseded_at: null, revoked_at: null,
      });
      expect(newRow.token_hash).not.toBe(s.old.tokenHash);

      // The unsent old email is cancelled and scrubbed; the new one carries the new link.
      expect(await queueRow(s.queueId)).toMatchObject({ status: "cancelled", html_body: MARKER, text_body: MARKER });
      const newQueue = await queueRow(String(newRow.email_queue_id));
      expect(newQueue).toMatchObject({ status: "queued", template_key: "account_invitation" });
      const token = tokenFrom(String(newQueue.text_body));
      expect(sha(token)).toBe(newRow.token_hash);

      // The old link is dead; the new one previews.
      expect(await fx.preview(s.old.token)).toHaveLength(0);
      expect(await fx.preview(token)).toHaveLength(1);

      const audit = await auditRows("invitation.resent", s.orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_user_id: inviter, resource_id: r.invitationId });
      expect(audit[0]!.metadata).toEqual({
        invitationId: r.invitationId, supersededInvitationId: s.old.id, organizationId: s.orgId,
        purpose: "founding_administrator", resendCount: 1,
      });
      expect(JSON.stringify(audit[0])).not.toContain(s.address);
    });

    it("an old email that already went out is left as sent (it arrives dead: its token is superseded)", async () => {
      const s = await seed({ sentQueue: true });
      const r = await issue.resendInvitation({ organizationId: s.orgId, invitationId: s.old.id, actor: actor() });
      expect(r.kind).toBe("ok");
      expect((await queueRow(s.queueId)).status).toBe("sent");
    });

    it("an EXPIRED open row can be resent", async () => {
      const s = await seed({ createdAgo: "9 days", expiresIn: "-2 days" });
      const r = await issue.resendInvitation({ organizationId: s.orgId, invitationId: s.old.id, actor: actor() });
      expect(r.kind).toBe("ok");
    });

    it("rate_limited inside the 5-minute cooldown; nothing changes", async () => {
      const s = await seed({ createdAgo: "1 minute" });
      const r = await issue.resendInvitation({ organizationId: s.orgId, invitationId: s.old.id, actor: actor() });
      expect(r).toEqual({ kind: "rate_limited" });
      expect(await invitationsOf(s.orgId)).toHaveLength(1);
      expect((await q(sql`select superseded_at from account_invitations where id = ${s.old.id}`))[0]!.superseded_at).toBeNull();
      expect(await auditRows("invitation.resent", s.orgId)).toHaveLength(0);
    });

    it("rate_limited at the per-chain cap (5 resends)", async () => {
      const orgId = await org();
      const head = await chainOfLength(orgId, fx.email("chain"), 5);
      const r = await issue.resendInvitation({ organizationId: orgId, invitationId: head.id, actor: actor() });
      expect(r).toEqual({ kind: "rate_limited" });
      expect(await invitationsOf(orgId)).toHaveLength(6);
    });

    it("rate_limited by the per-address limit: a resend is an email too", async () => {
      const s = await seed();
      for (let i = 0; i < 2; i += 1) {
        await fx.insertInvitation({ organizationId: await org(), purpose: "founding_administrator", email: s.address, createdByUserId: operator });
      }
      const r = await issue.resendInvitation({ organizationId: s.orgId, invitationId: s.old.id, actor: actor() });
      expect(r).toEqual({ kind: "rate_limited" });
    });

    it("not_open: accepted-blocked, revoked and superseded rows cannot be resent", async () => {
      const orgId = await org();
      const revoked = await fx.insertInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("nr"), createdByUserId: operator, createdAt: sql`now() - interval '10 minutes'`, expiresAt: sql`now() + interval '1 day'` });
      await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${revoked.id}`);
      expect(await issue.resendInvitation({ organizationId: orgId, invitationId: revoked.id, actor: actor() })).toEqual({ kind: "not_open" });
      const superseded = await fx.insertInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("ns"), createdByUserId: operator });
      await q(sql`update account_invitations set superseded_at = now() where id = ${superseded.id}`);
      expect(await issue.resendInvitation({ organizationId: orgId, invitationId: superseded.id, actor: actor() })).toEqual({ kind: "not_open" });
    });

    it("not_found: another organization's invitation, an unknown id, a malformed id", async () => {
      const s = await seed();
      const other = await org();
      expect(await issue.resendInvitation({ organizationId: other, invitationId: s.old.id, actor: actor() })).toEqual({ kind: "not_found" });
      expect(await issue.resendInvitation({ organizationId: s.orgId, invitationId: "c1000000-0000-4000-8000-0000000000bb", actor: actor() })).toEqual({ kind: "not_found" });
      expect(await issue.resendInvitation({ organizationId: s.orgId, invitationId: "nope", actor: actor() })).toEqual({ kind: "not_found" });
      expect(await invitationsOf(s.orgId)).toHaveLength(1);
    });

    it("has_holders: someone gained the access since the invitation was sent", async () => {
      const s = await seed();
      const holder = await fx.makePerson("Hollis", "Holder");
      await fx.enroll(s.orgId, holder, ["roles.manage"]);
      const r = await issue.resendInvitation({ organizationId: s.orgId, invitationId: s.old.id, actor: actor() });
      expect(r).toEqual({ kind: "has_holders" });
      expect(await invitationsOf(s.orgId)).toHaveLength(1);
    });

    it("link_origin_unavailable: nothing is superseded", async () => {
      const s = await seed();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      expect(await issue.resendInvitation({ organizationId: s.orgId, invitationId: s.old.id, actor: actor() })).toEqual({ kind: "link_origin_unavailable" });
      expect(await invitationsOf(s.orgId)).toHaveLength(1);
    });

    it("a FAILED audit insert rolls the resend back: the old row stays open, no successor, queue untouched", async () => {
      const s = await seed();
      auditControl.fail = true;
      const r = await issue.resendInvitation({ organizationId: s.orgId, invitationId: s.old.id, actor: actor() });
      expect(r).toEqual({ kind: "db_error" });
      const rows = await invitationsOf(s.orgId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.superseded_at).toBeNull();
      expect((await queueRow(s.queueId)).status).toBe("queued");
      expect(await fx.preview(s.old.token)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("revokeInvitation", () => {
    async function seed(queueStatus = "queued") {
      const orgId = await org();
      const address = fx.email("rv");
      const queueId = await seedQueueRow(address, queueStatus);
      const inv = await fx.insertInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address, createdByUserId: operator, emailQueueId: queueId,
      });
      return { orgId, address, queueId, inv };
    }

    it("revokes, cancels and scrubs the unsent email, audits, kills the link - one commit", async () => {
      const s = await seed();
      expect(await fx.preview(s.inv.token)).toHaveLength(1);
      const r = await issue.revokeInvitation({ organizationId: s.orgId, invitationId: s.inv.id, actor: actor() });
      expect(r).toEqual({ kind: "ok" });
      const [row] = await invitationsOf(s.orgId);
      expect(row).toMatchObject({ revoked_by_user_id: inviter });
      expect(row!.revoked_at).not.toBeNull();
      expect(await queueRow(s.queueId)).toMatchObject({ status: "cancelled", html_body: MARKER, text_body: MARKER });
      expect(await fx.preview(s.inv.token)).toHaveLength(0);
      const audit = await auditRows("invitation.revoked", s.orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_user_id: inviter, resource_id: s.inv.id });
      expect(audit[0]!.metadata).toEqual({ invitationId: s.inv.id, organizationId: s.orgId, purpose: "founding_administrator", via: "single" });
      expect(JSON.stringify(audit[0])).not.toContain(s.address);
    });

    it("leaves an already-sent email as sent", async () => {
      const s = await seed("sent");
      expect(await issue.revokeInvitation({ organizationId: s.orgId, invitationId: s.inv.id, actor: actor() })).toEqual({ kind: "ok" });
      expect((await queueRow(s.queueId)).status).toBe("sent");
    });

    it("not_open when already revoked; not_found across organizations and for a malformed id; neither writes an audit row", async () => {
      const s = await seed();
      await issue.revokeInvitation({ organizationId: s.orgId, invitationId: s.inv.id, actor: actor() });
      expect(await issue.revokeInvitation({ organizationId: s.orgId, invitationId: s.inv.id, actor: actor() })).toEqual({ kind: "not_open" });
      const t = await seed();
      expect(await issue.revokeInvitation({ organizationId: s.orgId, invitationId: t.inv.id, actor: actor() })).toEqual({ kind: "not_found" });
      expect(await issue.revokeInvitation({ organizationId: s.orgId, invitationId: "x", actor: actor() })).toEqual({ kind: "not_found" });
      expect((await q(sql`select revoked_at from account_invitations where id = ${t.inv.id}`))[0]!.revoked_at).toBeNull();
      expect(await auditRows("invitation.revoked", s.orgId)).toHaveLength(1);
    });

    it("a FAILED audit insert rolls the revoke back: the invitation stays open and its email queued", async () => {
      const s = await seed();
      auditControl.fail = true;
      expect(await issue.revokeInvitation({ organizationId: s.orgId, invitationId: s.inv.id, actor: actor() })).toEqual({ kind: "db_error" });
      expect((await invitationsOf(s.orgId))[0]!.revoked_at).toBeNull();
      expect((await queueRow(s.queueId)).status).toBe("queued");
      expect(await fx.preview(s.inv.token)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("revokeAllOpenInvitations", () => {
    it("revokes every open row of the organization (and only that organization), one audit row each via revoke_all", async () => {
      const orgId = await org();
      const bystander = await org();
      const faAddress = fx.email("ra-fa");
      const faQueue = await seedQueueRow(faAddress);
      const fa = await fx.insertInvitation({ organizationId: orgId, purpose: "founding_administrator", email: faAddress, createdByUserId: operator, emailQueueId: faQueue });
      const trAddress = fx.email("ra-tr");
      const person = await member(orgId, trAddress);
      const tr = await fx.insertInvitation({ organizationId: orgId, purpose: "treasurer", email: trAddress, createdByUserId: operator, personId: person });
      const other = await fx.insertInvitation({ organizationId: bystander, purpose: "founding_administrator", email: fx.email("ra-other"), createdByUserId: operator });

      const r = await issue.revokeAllOpenInvitations({ organizationId: orgId, actor: actor() });
      expect(r).toEqual({ kind: "ok", revoked: 2 });
      const rows = await invitationsOf(orgId);
      expect(rows.every((x) => x.revoked_at !== null && x.revoked_by_user_id === inviter)).toBe(true);
      expect((await q(sql`select revoked_at from account_invitations where id = ${other.id}`))[0]!.revoked_at).toBeNull();
      expect(await fx.preview(fa.token)).toHaveLength(0);
      expect(await fx.preview(tr.token)).toHaveLength(0);
      expect(await fx.preview(other.token)).toHaveLength(1);
      expect((await queueRow(faQueue)).status).toBe("cancelled");

      const audit = await auditRows("invitation.revoked", orgId);
      expect(audit).toHaveLength(2);
      expect(audit.map((a) => (a.metadata as Record<string, unknown>).via)).toEqual(["revoke_all", "revoke_all"]);
      expect(audit.map((a) => a.resource_id).sort()).toEqual([fa.id, tr.id].sort());
      expect(await auditRows("invitation.revoked", bystander)).toHaveLength(0);
    });

    it("an organization with nothing open revokes zero and writes no audit row", async () => {
      const orgId = await org();
      expect(await issue.revokeAllOpenInvitations({ organizationId: orgId, actor: actor() })).toEqual({ kind: "ok", revoked: 0 });
      expect(await auditRows("invitation.revoked", orgId)).toHaveLength(0);
    });

    it("a FAILED audit insert rolls every revoke back", async () => {
      const orgId = await org();
      const inv = await fx.insertInvitation({ organizationId: orgId, purpose: "founding_administrator", email: fx.email("ra-rb"), createdByUserId: operator });
      auditControl.fail = true;
      expect(await issue.revokeAllOpenInvitations({ organizationId: orgId, actor: actor() })).toEqual({ kind: "db_error" });
      expect((await invitationsOf(orgId))[0]!.revoked_at).toBeNull();
      expect(await fx.preview(inv.token)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("listInvitationsForOrg", () => {
    it("derives status, joins delivery state, hides superseded rows, flags self-designation, orders newest first", async () => {
      const orgId = await org();
      // Superseded parent + open head.
      const head = await chainOfLength(orgId, fx.email("ls-chain"), 1);
      // Revoked (a different purpose so the open indexes allow it).
      const trAddress = fx.email("ls-tr");
      const person = await member(orgId, trAddress);
      const tr = await fx.insertInvitation({ organizationId: orgId, purpose: "treasurer", email: trAddress, createdByUserId: operator, personId: person });
      await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${tr.id}`);

      const rows = await issue.listInvitationsForOrg(orgId);
      expect(rows).toHaveLength(2); // the superseded parent is hidden
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(head.id)).toMatchObject({ status: "pending", purpose: "founding_administrator", resendCount: 1, selfDesignated: false });
      expect(byId.get(head.id)!.canResendAt).toBeInstanceOf(Date);
      expect(byId.get(tr.id)).toMatchObject({ status: "revoked", canResendAt: null, purpose: "treasurer" });
      expect(byId.get(head.id)!.email).toContain("@example.invalid");
    });

    it("reports expired, delivery state per queue row, and the blocked reason", async () => {
      const orgId = await org();
      const address = fx.email("ls-exp");
      const queueId = await seedQueueRow(address, "sent");
      await q(sql`update email_queue set bounced_at = now() where id = ${queueId}`);
      await fx.insertInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address, createdByUserId: operator, emailQueueId: queueId,
        createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '2 days'`,
      });
      const [expired] = await issue.listInvitationsForOrg(orgId);
      expect(expired).toMatchObject({ status: "expired", delivery: "bounced" });
      expect(expired!.canResendAt).toBeInstanceOf(Date);
    });

    it("returns nothing for a malformed or unknown organization id", async () => {
      expect(await issue.listInvitationsForOrg("nope")).toEqual([]);
      expect(await issue.listInvitationsForOrg("c1000000-0000-4000-8000-0000000000cc")).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("source guarantees", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/onboarding/issue.ts"), "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");

    it("never reads the users table (the enumeration defence): no users import and no SQL against users", () => {
      expect(code).not.toMatch(/\bfrom\s+users\b/i);
      expect(code).not.toMatch(/\bjoin\s+users\b/i);
      expect(code).not.toMatch(/import\s*\{[^}]*\busers\b[^}]*\}/);
    });

    it("writes audit rows only through insertAuditRow in the transaction, never recordAudit()", () => {
      expect(code).not.toMatch(/recordAudit/);
      expect(code).toMatch(/insertAuditRow\(tx,/);
    });

    it("uses the platform connection only: getPlatformDb is imported, the tenant `db` is not", () => {
      expect(code).toMatch(/import\s*\{\s*getPlatformDb\s*\}\s*from\s*"@\/lib\/db"/);
      expect(code).not.toMatch(/import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*"@\/lib\/db"/);
    });
  });
});
