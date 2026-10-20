/**
 * drizzle/0055_presby_giving.sql on a REAL Postgres connection - the proofs
 * scripts/giving/test-rls-46.sql cannot make because it runs as presby_app:
 *
 *   - P3-8's mandatory empirical premise: the giving BEFORE DELETE guards let
 *     the organization-teardown cascade through (the parent org row is gone
 *     when the RI cascade fires), so ONE `delete from organizations` of a
 *     deletable fixture org removes every giving row;
 *   - the freeze / write / delete guards fire on the OWNER path (getPlatformDb
 *     is neondb_owner, which no grant binds - F44);
 *   - the composite FK refuses an owner-path gift naming another org's fund;
 *   - the SECURITY DEFINER family derives the org (never from a parameter) and
 *     rejects cross-org references, through the presby_app connection;
 *   - the public config's `unavailable` state and an `onboarding` connection;
 *   - "another member's rows are not returned" for the confirmed-link read
 *     shape the member self-view (R14, Batch 6) will use;
 *   - correction C1/C2 (2026-10-16): the claim's two appended columns, and the
 *     owner-only dead-letter list returning a dead-lettered event without its
 *     body (presby_app cannot call it, so section 46 pins only its shape).
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/giving.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

type Row = Record<string, unknown>;

describe.skipIf(!hasDb)("drizzle/0055 giving schema (Postgres-backed)", () => {
  let fx: GivingFixture;
  let appDb: typeof import("@/lib/db").db;
  let armGivingWrite: typeof import("@/lib/testing/giving-fixture").armGivingWrite;

  let orgA: string;
  let orgB: string;
  let connA: string;
  let fundA: string;
  let fundB: string;
  let donorA: string;
  let donorB: string;
  let recorder: string;
  let recorderUser: string;

  async function q(query: ReturnType<typeof sql>): Promise<Row[]> {
    return fx.rowsOf(await fx.platform.execute(query));
  }

  /** Run `fn` on the presby_app connection with `org` as the verified context. */
  async function asTenant<T>(org: string | null, fn: (tx: Parameters<Parameters<typeof appDb.transaction>[0]>[0]) => Promise<T>) {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${org ?? ""}, true)`);
      return fn(tx);
    });
  }

  /** Drizzle wraps the Postgres error ("Failed query: ...") - match the whole cause chain. */
  async function expectRaise(p: Promise<unknown>, pattern: RegExp) {
    let caught: unknown = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught, `expected a raise matching ${pattern}`).not.toBeNull();
    const messages: string[] = [];
    for (let e = caught as { message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
      messages.push(String(e.message ?? e));
    }
    expect(messages.join(" | ")).toMatch(pattern);
  }

  beforeAll(async () => {
    ({ db: appDb } = await import("@/lib/db"));
    const mod = await import("@/lib/testing/giving-fixture");
    armGivingWrite = mod.armGivingWrite;
    fx = await mod.createGivingFixture("giving-db-test");

    orgA = await fx.makeOrg("a", { givingToggle: true });
    orgB = await fx.makeOrg("b", { givingToggle: true });
    connA = await fx.makeConnection(orgA);
    await fx.makeConnection(orgB);
    fundA = await fx.makeFund(orgA, "General Fund");
    fundB = await fx.makeFund(orgB, "General Fund");
    donorA = await fx.makeDonor(orgA, "Fixture Donor A", { email: "donor.a@example.invalid" });
    donorB = await fx.makeDonor(orgB, "Fixture Donor B");
    recorder = await fx.makePerson("Orrin", "Talbridge");
    await fx.enroll(orgA, recorder, ["giving.record"]);
    recorderUser = await fx.linkUser(recorder, "recorder");
  }, 60_000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  }, 60_000);

  // -------------------------------------------------------------------------
  describe("P3-8: the organization-teardown cascade premise (mandatory empirical test)", () => {
    it("one `delete from organizations` of a deletable fixture org removes every giving row, guards and all", async () => {
      const org = await fx.makeOrg("teardown", { givingToggle: true });
      const conn = await fx.makeConnection(org);
      const fund = await fx.makeFund(org, "Teardown Fund");
      const donor = await fx.makeDonor(org, "Teardown Donor");
      const merged = await fx.makeDonor(org, "Teardown Duplicate");
      await q(sql`update giving_donors set merged_into_id = ${donor}, merged_at = now() where id = ${merged}`);
      const gift = await fx.makeOfflineGift(org, donor, fund, 5000);
      // An inbox row, an intent, an online gift tied to both, an identity and a reversal.
      const intent = String(
        (await q(sql`
          insert into giving_checkout_intents (organization_id, connection_id, fund_id, frequency, method_choice,
                 gift_amount_cents, total_cents, livemode, idempotency_key, status, checkout_session_id, expires_at)
          values (${org}, ${conn}, ${fund}, 'once', 'card', 2500, 2500, false, gen_random_uuid()::text, 'completed',
                  'cs_test_teardown000001', now() + interval '1 day') returning id`))[0]!.id,
      );
      const event = String(
        (await q(sql`
          insert into giving_provider_events (organization_id, connection_id, provider, external_event_id, event_type,
                 livemode, raw_body) values (${org}, ${conn}, 'stripe', 'evt_teardown000001', 'checkout.session.completed',
                 false, '{}') returning id`))[0]!.id,
      );
      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        await tx.execute(sql`
          insert into giving_gifts (organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
                 external_transaction_id, amount_cents, status, occurred_on, occurred_at, livemode, source_event_id)
          values (${org}, ${donor}, ${fund}, 'online', 'stripe', ${conn}, ${intent}, 'pi_teardown0000001', 2500,
                  'succeeded', current_date, now(), false, ${event})`);
        await tx.execute(sql`
          insert into giving_gift_reversals (organization_id, gift_id, kind, amount_cents, reason, occurred_on,
                 recorded_by, livemode)
          values (${org}, ${gift}, 'void', 5000, 'teardown fixture', current_date, ${fx.actingUserId}, true)`);
      });
      await q(sql`
        insert into giving_donor_identities (organization_id, donor_id, connection_id, external_customer_id)
        values (${org}, ${donor}, ${conn}, 'cus_teardown000001')`);

      // The guards are live for this org's rows on the owner path...
      await expectRaise(q(sql`delete from giving_gifts where id = ${gift}`), /giving records are permanent/);
      await expectRaise(q(sql`delete from giving_provider_events where id = ${event}`), /giving records are permanent/);

      // ...and the sanctioned teardown passes through all of them.
      await q(sql`delete from organizations where id = ${org}`);

      const remaining = await q(sql`
        select (select count(*) from giving_gifts where organization_id = ${org})
             + (select count(*) from giving_gift_reversals where organization_id = ${org})
             + (select count(*) from giving_donors where organization_id = ${org})
             + (select count(*) from giving_provider_events where organization_id = ${org})
             + (select count(*) from giving_checkout_intents where organization_id = ${org})
             + (select count(*) from giving_donor_identities where organization_id = ${org})
             + (select count(*) from giving_provider_connections where organization_id = ${org})
             + (select count(*) from giving_funds where organization_id = ${org}) as n`);
      expect(Number(remaining[0]!.n)).toBe(0);
    });

    it("an org WITHOUT deletable_until still cannot be deleted (0044's guard is upstream of ours)", async () => {
      await expectRaise(
        q(sql`delete from organizations where id = '22222222-2222-2222-2222-222222222222'`),
        /an organization is permanent/,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("the guards fire on the OWNER path (F44)", () => {
    it("a gift insert without the marker is refused, even for the owner", async () => {
      await expectRaise(
        q(sql`
          insert into giving_gifts (organization_id, donor_id, fund_id, source, method, amount_cents, status,
                 occurred_on, livemode, recorded_by)
          values (${orgA}, ${donorA}, ${fundA}, 'offline', 'cash', 100, 'succeeded', current_date, true, ${fx.actingUserId})`),
        /gifts are written only by the giving functions/,
      );
    });

    it("with the marker armed, a gift's amount is still frozen", async () => {
      const gift = await fx.makeOfflineGift(orgA, donorA, fundA, 1000);
      await expectRaise(
        fx.platform.transaction(async (tx) => {
          await armGivingWrite(tx);
          await tx.execute(sql`update giving_gifts set amount_cents = amount_cents + 1 where id = ${gift}`);
        }),
        /a gift is frozen/,
      );
      await expectRaise(
        q(sql`update giving_gifts set memo = 'edited' where id = ${gift}`),
        /gifts are written only by the giving functions/,
      );
    });

    it("status moves pending -> succeeded|failed only; fee/net and method are set once", async () => {
      const make = async (status: string, pi: string) =>
        fx.platform.transaction(async (tx) => {
          await armGivingWrite(tx);
          const intent = fx.rowsOf(
            await tx.execute(sql`
              insert into giving_checkout_intents (organization_id, connection_id, fund_id, frequency, method_choice,
                     gift_amount_cents, total_cents, livemode, idempotency_key, status, expires_at)
              values (${orgA}, ${connA}, ${fundA}, 'once', 'bank', 1000, 1000, false, gen_random_uuid()::text,
                      'completed', now() + interval '1 day') returning id`),
          )[0]!.id;
          return String(
            fx.rowsOf(
              await tx.execute(sql`
                insert into giving_gifts (organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
                       external_transaction_id, amount_cents, status, occurred_on, occurred_at, livemode)
                values (${orgA}, ${donorA}, ${fundA}, 'online', 'stripe', ${connA}, ${String(intent)}, ${pi}, 1000,
                        ${status}, current_date, now(), false) returning id`),
            )[0]!.id,
          );
        });
      const update = (gift: string, set: ReturnType<typeof sql>) =>
        fx.platform.transaction(async (tx) => {
          await armGivingWrite(tx);
          await tx.execute(sql`update giving_gifts set ${set} where id = ${gift}`);
        });

      const pending = await make("pending", `pi_ownerpath${Date.now()}a`);
      await update(pending, sql`status = 'succeeded'`);
      const after = await q(sql`select status, status_changed_at > created_at - interval '1 second' as stamped from giving_gifts where id = ${pending}`);
      expect(after[0]!.status).toBe("succeeded");
      await expectRaise(update(pending, sql`status = 'failed'`), /status may only move pending/);
      await expectRaise(update(pending, sql`status = 'pending'`), /status may only move pending/);

      const failed = await make("pending", `pi_ownerpath${Date.now()}b`);
      await update(failed, sql`status = 'failed', failure_code = 'insufficient_funds'`);
      await expectRaise(update(failed, sql`status = 'succeeded'`), /status may only move pending/);

      await update(pending, sql`fee_cents = 30, net_cents = 970, method = 'us_bank_account'`);
      await expectRaise(update(pending, sql`fee_cents = 31, net_cents = 969`), /fee and net are set once/);
      await expectRaise(update(pending, sql`method = 'card'`), /method is set once/);
      await expectRaise(update(pending, sql`donor_id = ${donorA}, fund_id = ${fundA}, amount_cents = 999`), /a gift is frozen/);
    });

    it("a reversal is insert-only (UPDATE raises even with the marker) and needs the marker to insert", async () => {
      const gift = await fx.makeOfflineGift(orgA, donorA, fundA, 2000);
      await expectRaise(
        q(sql`
          insert into giving_gift_reversals (organization_id, gift_id, kind, amount_cents, reason, occurred_on, recorded_by, livemode)
          values (${orgA}, ${gift}, 'void', 2000, 'no marker', current_date, ${fx.actingUserId}, true)`),
        /reversals are written only by the giving functions/,
      );
      const reversal = await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        return fx.rowsOf(
          await tx.execute(sql`
            insert into giving_gift_reversals (organization_id, gift_id, kind, amount_cents, reason, occurred_on, recorded_by, livemode)
            values (${orgA}, ${gift}, 'void', 2000, 'entered twice', current_date, ${fx.actingUserId}, true) returning id`),
        )[0]!.id;
      });
      await expectRaise(
        fx.platform.transaction(async (tx) => {
          await armGivingWrite(tx);
          await tx.execute(sql`update giving_gift_reversals set reason = 'edited' where id = ${String(reversal)}`);
        }),
        /a reversal is immutable/,
      );
    });

    it("the reversal bound refuses over-reversal and a void of an online gift, on the owner path", async () => {
      const gift = await fx.makeOfflineGift(orgA, donorA, fundA, 500);
      await expectRaise(
        fx.platform.transaction(async (tx) => {
          await armGivingWrite(tx);
          await tx.execute(sql`
            insert into giving_gift_reversals (organization_id, gift_id, kind, amount_cents, reason, occurred_on, recorded_by, livemode)
            values (${orgA}, ${gift}, 'void', 501, 'too much', current_date, ${fx.actingUserId}, true)`);
        }),
        /net reversed/,
      );
    });

    it("DELETE is refused on gifts, reversals, donors and events - and permitted inside deletable_until", async () => {
      const gift = await fx.makeOfflineGift(orgA, donorA, fundA, 700);
      await expectRaise(q(sql`delete from giving_gifts where id = ${gift}`), /giving records are permanent/);
      const lone = await fx.makeDonor(orgA, "Lonely Donor");
      await expectRaise(q(sql`delete from giving_donors where id = ${lone}`), /giving records are permanent/);

      const deletable = await fx.makeOfflineGift(orgA, donorA, fundA, 800, {
        deletableUntil: new Date(Date.now() + 60 * 60 * 1000),
      });
      await q(sql`delete from giving_gifts where id = ${deletable}`);
      expect(await q(sql`select 1 from giving_gifts where id = ${deletable}`)).toHaveLength(0);

      const expired = await fx.makeOfflineGift(orgA, donorA, fundA, 900, {
        deletableUntil: new Date(Date.now() - 60 * 1000),
      });
      await expectRaise(q(sql`delete from giving_gifts where id = ${expired}`), /giving records are permanent/);
    });

    it("the composite FK refuses an owner-path gift naming ANOTHER org's fund (marker armed, so the FK is what refuses)", async () => {
      await expectRaise(
        fx.platform.transaction(async (tx) => {
          await armGivingWrite(tx);
          await tx.execute(sql`
            insert into giving_gifts (organization_id, donor_id, fund_id, source, method, amount_cents, status,
                   occurred_on, livemode, recorded_by)
            values (${orgA}, ${donorA}, ${fundB}, 'offline', 'cash', 100, 'succeeded', current_date - 1, true, ${fx.actingUserId})`);
        }),
        /giving_gifts_fund_fk/,
      );
    });

    it("a disconnected connection is terminal, even for the owner", async () => {
      const org = await fx.makeOrg("terminal");
      const conn = await fx.makeConnection(org);
      await q(sql`update giving_provider_connections set status = 'disconnected', disconnected_at = now(),
                  disconnected_reason = 'treasurer', public_enabled_at = null where id = ${conn}`);
      await expectRaise(
        q(sql`update giving_provider_connections set status = 'active', disconnected_at = null, disconnected_reason = null where id = ${conn}`),
        /terminal/,
      );
    });

    it("whole-database: no role outside the two templates and fixture/test roles carries a giving key (46m)", async () => {
      const rows = await q(sql`
        select distinct r.id::text, r.organization_id::text, r.key
          from app_role_permissions rp
          join permissions pm on pm.key = rp.permission_key and pm.module = 'giving'
          join app_roles r on r.id = rp.role_id`);
      const fixtureOrgs = new Set(
        (await q(sql`select id::text from organizations where deletable_until is not null`)).map((r) => String(r.id)),
      );
      const unexpected = rows.filter(
        (r) =>
          !["00000000-0000-0000-0000-000000000005", "00000000-0000-0000-0000-000000000006"].includes(String(r.id)) &&
          !["f0000000-0000-0000-0000-000000000007", "d9100000-0000-0000-0000-000000000001"].includes(String(r.id)) &&
          !fixtureOrgs.has(String(r.organization_id)),
      );
      expect(unexpected).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("the DEFINER family derives the org and rejects cross-org references (presby_app)", () => {
    it("record_offline_gift: org comes from the context; another org's donor or fund is refused", async () => {
      const gift = await asTenant(orgA, async (tx) =>
        fx.rowsOf(
          await tx.execute(sql`select presby_giving_record_offline_gift(${donorA}, ${fundA}, current_date - 1, 'cash',
                                 2500, null, null, null, 'fixture', ${recorderUser}) as id`),
        )[0]!.id,
      );
      const row = await q(sql`select organization_id::text as org from giving_gifts where id = ${String(gift)}`);
      expect(row[0]!.org).toBe(orgA);

      await expectRaise(
        asTenant(orgA, (tx) =>
          tx.execute(sql`select presby_giving_record_offline_gift(${donorB}, ${fundA}, current_date - 1, 'cash',
                           2500, null, null, null, null, ${recorderUser})`),
        ),
        /donor_unavailable/,
      );
      await expectRaise(
        asTenant(orgA, (tx) =>
          tx.execute(sql`select presby_giving_record_offline_gift(${donorA}, ${fundB}, current_date - 1, 'cash',
                           2500, null, null, null, null, ${recorderUser})`),
        ),
        /fund_unavailable/,
      );
      // The recorder is a member of A only: from B's context the claim is refused.
      await expectRaise(
        asTenant(orgB, (tx) =>
          tx.execute(sql`select presby_giving_record_offline_gift(${donorB}, ${fundB}, current_date - 1, 'cash',
                           2500, null, null, null, null, ${recorderUser})`),
        ),
        /not permitted/,
      );
      await expectRaise(
        asTenant(null, (tx) =>
          tx.execute(sql`select presby_giving_record_offline_gift(${donorA}, ${fundA}, current_date - 1, 'cash',
                           2500, null, null, null, null, ${recorderUser})`),
        ),
        /not permitted/,
      );
    });

    it("ingest + apply: org from the connection; another org's session is ignored and nothing is written", async () => {
      const [conn] = await q(sql`select external_account_id from giving_provider_connections where id = ${connA}`);
      const intentB = await asTenant(null, async (tx) => {
        const created = fx.rowsOf(
          await tx.execute(sql`select * from presby_giving_create_intent_public(
                   (select slug from organizations where id = ${orgB}), ${fundB}, 2500, false, 'card', 'once',
                   gen_random_uuid()::text)`),
        )[0]!;
        expect(created.outcome).toBe("created");
        await tx.execute(sql`select presby_giving_attach_session(${String(created.intent_id)}, 'cs_test_dbtestorgb0001')`);
        return String(created.intent_id);
      });
      const outcome = await asTenant(null, async (tx) => {
        const ev = fx.rowsOf(
          await tx.execute(sql`select * from presby_giving_ingest_event('stripe', ${String(conn!.external_account_id)},
                                 ${`evt_dbtest${Date.now()}`}, false, 'checkout.session.completed', '{}')`),
        )[0]!;
        expect(ev.outcome).toBe("accepted");
        await tx.execute(sql`select * from presby_giving_claim_event(${String(ev.inbox_id)})`);
        return fx.rowsOf(
          await tx.execute(sql`select presby_giving_apply_gift(${String(ev.inbox_id)}, 'succeeded', 'cs_test_dbtestorgb0001',
                   null, null, 'pi_dbtestcrossorg01', 2500, now(), null, null, 'X', null, null, null, null, null, null,
                   null, 'card') as r`),
        )[0]!.r;
      });
      expect(outcome).toBe("ignored:no_intent");
      expect(await q(sql`select 1 from giving_gifts where external_transaction_id = 'pi_dbtestcrossorg01'`)).toHaveLength(0);
      const [b] = await q(sql`select organization_id::text as org from giving_checkout_intents where id = ${intentB}`);
      expect(b!.org).toBe(orgB);
    });

    it("create_intent_member: a membership of another org is invalid; no context is refused", async () => {
      const member = await fx.makePerson("Ysolde", "Farrant");
      await fx.enroll(orgB, member, []);
      const membershipB = await fx.membershipOf(orgB, member);
      const r = await asTenant(orgA, async (tx) =>
        fx.rowsOf(
          await tx.execute(sql`select * from presby_giving_create_intent_member(${membershipB}, ${fundA}, 2500, false,
                                 'card', 'once', gen_random_uuid()::text)`),
        )[0]!,
      );
      expect(r.outcome).toBe("invalid");
      await expectRaise(
        asTenant(null, (tx) =>
          tx.execute(sql`select * from presby_giving_create_intent_member(${membershipB}, ${fundB}, 2500, false,
                           'card', 'once', gen_random_uuid()::text)`),
        ),
        /not permitted/,
      );
    });

    it("the owner-only functions are not executable by presby_app", async () => {
      await expectRaise(asTenant(null, (tx) => tx.execute(sql`select * from presby_giving_ingest_health()`)), /permission denied/);
      await expectRaise(asTenant(null, (tx) => tx.execute(sql`select * from presby_giving_dead_letters()`)), /permission denied/);
      await expectRaise(asTenant(orgA, (tx) => tx.execute(sql`select * from presby_giving_dead_letters(5)`)), /permission denied/);
      await expectRaise(
        asTenant(null, (tx) => tx.execute(sql`select presby_giving_requeue_event(gen_random_uuid())`)),
        /permission denied/,
      );
      const health = await q(sql`select * from presby_giving_ingest_health() where connection_id = ${connA}`);
      expect(health).toHaveLength(1);
      expect(Object.keys(health[0]!)).not.toContain("raw_body");
      // The full owner-only set, and that its ACL names the owner alone (no PUBLIC, no presby_platform).
      const acl = await q(sql`
        select p.proname::text as f, p.proacl::text as acl from pg_proc p
         where p.proname in ('presby_giving_ingest_health', 'presby_giving_dead_letters', 'presby_giving_requeue_event')
         order by 1`);
      expect(acl.map((r) => r.f)).toEqual(["presby_giving_dead_letters", "presby_giving_ingest_health", "presby_giving_requeue_event"]);
      for (const r of acl) expect(r.acl).toMatch(/^\{[a-z_]+=X\/[a-z_]+\}$/);
    });

    /** Ingests a fresh event on connA as presby_app (the webhook's path) and returns its inbox id. */
    async function ingestOnA(eventId: string, type = "charge.refunded", body = '{"fixture":"giving.db.test"}') {
      const [conn] = await q(sql`select external_account_id from giving_provider_connections where id = ${connA}`);
      const ev = await asTenant(null, async (tx) =>
        fx.rowsOf(
          await tx.execute(sql`select * from presby_giving_ingest_event('stripe', ${String(conn!.external_account_id)},
                                 ${eventId}, false, ${type}, ${body})`),
        )[0]!,
      );
      expect(ev.outcome).toBe("accepted");
      return String(ev.inbox_id);
    }

    it("claim_event returns external_event_id and organization_id, appended after the original seven (C1)", async () => {
      const eventId = `evt_dbtestclaim${Date.now()}`;
      const inbox = await ingestOnA(eventId, "charge.refunded", '{"claim":"c1"}');
      const row = await asTenant(null, async (tx) =>
        fx.rowsOf(await tx.execute(sql`select * from presby_giving_claim_event(${inbox})`))[0]!,
      );
      expect(Object.keys(row)).toEqual([
        "raw_body", "event_type", "attempts", "body_purged", "connection_id", "external_account_id", "livemode",
        "external_event_id", "organization_id",
      ]);
      expect(row.external_event_id).toBe(eventId);
      expect(row.organization_id).toBe(orgA);
      expect(row.connection_id).toBe(connA);
      expect(row.raw_body).toBe('{"claim":"c1"}');
      expect(row.attempts).toBe(1);
      // Leave it terminal so nothing sweeps it before teardown.
      await asTenant(null, (tx) => tx.execute(sql`select presby_giving_finish_event(${inbox}, 'ignored', 'fixture')`));
    });

    it("dead_letters lists a dead-lettered event - ids, type, attempts, error code - never a body, and feeds requeue (C2)", async () => {
      const eventId = `evt_dbtestdead${Date.now()}`;
      const inbox = await ingestOnA(eventId, "charge.dispute.created", '{"secret_body":"never listed"}');
      await asTenant(null, async (tx) => {
        await tx.execute(sql`select * from presby_giving_claim_event(${inbox})`);
        const [f] = fx.rowsOf(await tx.execute(sql`select presby_giving_finish_event(${inbox}, 'dead', 'normalize_bad_shape') as s`));
        expect(f!.s).toBe("dead_letter");
      });
      // A received, not-yet-processed event of the same connection is NOT a dead letter.
      const live = await ingestOnA(`evt_dbtestlive${Date.now()}`);

      const rows = await q(sql`select * from presby_giving_dead_letters() where connection_id = ${connA}`);
      expect(rows).toHaveLength(1);
      const [d] = rows;
      expect(Object.keys(d!)).toEqual([
        "event_id", "connection_id", "organization_id", "external_event_id", "event_type", "received_at", "attempts",
        "last_error_class",
      ]);
      expect(d!.event_id).toBe(inbox);
      expect(d!.organization_id).toBe(orgA);
      expect(d!.external_event_id).toBe(eventId);
      expect(d!.event_type).toBe("charge.dispute.created");
      expect(d!.attempts).toBe(1);
      expect(d!.last_error_class).toBe("normalize_bad_shape");
      expect(JSON.stringify(rows)).not.toContain("secret_body");
      expect(rows.map((r) => r.event_id)).not.toContain(live);

      // Bounded: the limit is clamped to 1..100.
      expect((await q(sql`select * from presby_giving_dead_letters(0)`)).length).toBeLessThanOrEqual(1);
      expect((await q(sql`select * from presby_giving_dead_letters(10000)`)).length).toBeLessThanOrEqual(100);

      // The id it returns is what the owner-only replay takes; once requeued it is no longer listed.
      const [r] = await q(sql`select presby_giving_requeue_event(${String(d!.event_id)}) as outcome`);
      expect(r!.outcome).toBe("requeued");
      expect(await q(sql`select 1 from presby_giving_dead_letters() where event_id = ${inbox}`)).toHaveLength(0);
      // Leave both terminal so nothing sweeps them before teardown.
      await q(sql`update giving_provider_events set status = 'ignored', processed_at = now(), last_error = 'fixture'
                   where id in (${inbox}, ${live})`);
    });
  });

  // -------------------------------------------------------------------------
  describe("public states the presby_app suite cannot stage", () => {
    it("unavailable needs a LIVE published site; an onboarding connection is not live", async () => {
      const org = await fx.makeOrg("public", { givingToggle: true });
      const [{ slug }] = (await q(sql`select slug from organizations where id = ${org}`)) as [{ slug: string }];
      const config = async () =>
        asTenant(null, async (tx) => fx.rowsOf(await tx.execute(sql`select * from presby_public_giving_config(${slug})`))[0]!);
      const absent = await asTenant(null, async (tx) =>
        fx.rowsOf(await tx.execute(sql`select (c)::text as t from presby_public_giving_config('no-such-slug-dbtest') c`))[0]!.t,
      );
      const asText = async () =>
        asTenant(null, async (tx) => fx.rowsOf(await tx.execute(sql`select (c)::text as t from presby_public_giving_config(${slug}) c`))[0]!.t);

      // No site, no connection: absent, byte-identical to an unknown slug.
      expect(await asText()).toBe(absent);

      await q(sql`insert into organization_sites (organization_id, repo, status) values (${org}, ${`fixture-sites/giving-dbtest-${org}`}, 'live')`);
      expect((await config()).state).toBe("unavailable");

      const conn = await fx.makeConnection(org, { status: "onboarding" });
      await fx.makeFund(org, "Online Fund");
      expect((await config()).state).toBe("unavailable");
      const refused = await asTenant(null, async (tx) =>
        fx.rowsOf(
          await tx.execute(sql`select * from presby_giving_create_intent_public(${slug},
                   (select id from giving_funds where organization_id = ${org} limit 1), 2500, false, 'card', 'once',
                   gen_random_uuid()::text)`),
        )[0]!,
      );
      expect(refused.outcome).toBe("unavailable");

      await fx.platform.transaction(async (tx) => {
        await armGivingWrite(tx);
        await tx.execute(sql`update giving_provider_connections set status = 'active', charges_enabled = true,
                  payouts_enabled = true, card_enabled = true, payouts_attested_at = now(), public_enabled_at = now()
                  where id = ${conn}`);
      });
      const live = await config();
      expect(live.state).toBe("live");
      expect(JSON.stringify(live)).not.toMatch(/acct_/);
    });
  });

  // -------------------------------------------------------------------------
  describe("another member's rows are not returned (the confirmed-link read shape, R14)", () => {
    it("a viewer's linked donor yields only their gifts; a proposal-only email match and other members yield none", async () => {
      const viewer = await fx.makePerson("Brannoc", "Wylde");
      const other = await fx.makePerson("Isembard", "Corve");
      await fx.enroll(orgA, viewer, []);
      await fx.enroll(orgA, other, []);
      const viewerM = await fx.membershipOf(orgA, viewer);
      const otherM = await fx.membershipOf(orgA, other);
      const mine = await fx.makeDonor(orgA, "Brannoc Wylde", { linkedMembershipId: viewerM });
      const theirs = await fx.makeDonor(orgA, "Isembard Corve", { linkedMembershipId: otherM });
      const proposalOnly = await fx.makeDonor(orgA, "B. Wylde", { email: "b.wylde@example.invalid" });
      const myGift = await fx.makeOfflineGift(orgA, mine, fundA, 1111);
      await fx.makeOfflineGift(orgA, theirs, fundA, 2222);
      await fx.makeOfflineGift(orgA, proposalOnly, fundA, 3333);

      const selfRead = async (membershipId: string) =>
        asTenant(orgA, async (tx) =>
          fx.rowsOf(
            await tx.execute(sql`
              select g.id::text from giving_gifts g
                join giving_donors d on d.id = g.donor_id
               where coalesce(d.merged_into_id, d.id) in (
                       select dd.id from giving_donors dd
                        where dd.linked_membership_id = ${membershipId} and dd.merged_into_id is null)
                  or d.linked_membership_id = ${membershipId}`),
          ).map((r) => String(r.id)),
        );

      expect(await selfRead(viewerM)).toEqual([myGift]);
      expect(await selfRead(otherM)).not.toContain(myGift);
      // From ANOTHER org's context, the viewer's membership resolves to nothing at all.
      const crossOrg = await asTenant(orgB, async (tx) =>
        fx.rowsOf(await tx.execute(sql`select count(*)::int as n from giving_gifts g join giving_donors d on d.id = g.donor_id
                                         where d.linked_membership_id = ${viewerM}`))[0]!.n,
      );
      expect(crossOrg).toBe(0);
    });
  });
});
