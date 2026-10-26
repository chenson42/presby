/**
 * drizzle/0073_presby_reimbursements.sql, the TRIGGER half, proven on the
 * OWNER connection (getPlatformDb(), neondb_owner, BYPASSRLS): the path where
 * no grant and no policy binds, so the triggers are the only backstop (F44).
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 Edge Cases EC4, EC6,
 * EC7, EC8, EC13, EC30, EC32, EC33, EC34, EC36 (owner halves).
 *
 * The definer half (presby_app) is reimbursement-definers.db.test.ts; the
 * presby_app isolation suite is scripts/treasury/test-rls-73.sql.
 *
 * Owner writes that must not persist run in a transaction that is always
 * rolled back (`rolledBack`); writes that must reach COMMIT (the deferred
 * constraint triggers) run in `committed` and are cleaned up by the fixture
 * organization's teardown cascade.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/reimbursement.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { ReimbursementFixture, Row } from "@/lib/testing/reimbursement-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const M73 = readFileSync(path.join(process.cwd(), "drizzle", "0073_presby_reimbursements.sql"), "utf8");

const STATUSES = ["draft", "submitted", "returned", "not_approved", "approved", "paid", "withdrawn", "voided"] as const;
type Status = (typeof STATUSES)[number];

/** The transition table as written in 0073's section 4c comment (the arrows). */
function transitionsFromMigration(): Set<string> {
  const block = M73.slice(M73.indexOf("-- 4c. THE TRANSITION TABLE"), M73.indexOf("create or replace function presby_reimbursement_request_update_guard"));
  const allowed = new Set<string>();
  for (const m of block.matchAll(/^--\s+([a-z_]+)\s+->\s+([a-z_ |]+?)\s*(?:\(.*)?$/gm)) {
    for (const to of m[2]!.split("|").map((s) => s.trim()).filter(Boolean)) allowed.add(`${m[1]}->${to}`);
  }
  return allowed;
}

class Rollback extends Error {}

describe.skipIf(!hasDb)("drizzle/0073 reimbursement triggers, owner path (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let rowsOf: (r: unknown) => Row[];
  let pgError: (e: unknown) => { code: string | undefined; message: string };
  type Tx = Parameters<Parameters<ReimbursementFixture["platform"]["transaction"]>[0]>[0];

  let org: string;
  let presbytery: string;
  let committee: string;
  let creator: { userId: string; personId: string };
  let chair: { userId: string; personId: string };
  let payer: { userId: string; personId: string };
  let other: { userId: string; personId: string };

  async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
    await fx.platform
      .transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  }

  async function committed(fn: (tx: Tx) => Promise<void>): Promise<void> {
    await fx.platform.transaction(async (tx) => {
      await fn(tx);
    });
  }

  async function x(tx: Tx, query: SQL): Promise<Row[]> {
    return rowsOf(await tx.execute(query));
  }

  /** Expect `run` to raise; returns the SQLSTATE and message. A savepoint keeps the outer tx usable. */
  async function raises(tx: Tx, run: (sp: Tx) => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => {
        await run(sp as unknown as Tx);
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, "expected a refusal").toBeDefined();
    return pgError(caught);
  }

  async function event(tx: Tx, id: string, kind: string, from: string | null, to: string, actor = creator) {
    await x(tx, sql`
      insert into reimbursement_events (organization_id, request_id, kind, from_status, to_status,
                                        actor_user_id, actor_person_id, request_revision)
      select organization_id, id, ${kind}, ${from}, ${to}, ${actor.userId}, ${actor.personId}, revision
        from reimbursement_requests where id = ${id}`);
  }

  /** An app-origin draft with its 'created' event. */
  async function draft(tx: Tx, opts: { amount?: number; noReceipt?: boolean; beneficiary?: string } = {}): Promise<string> {
    const [row] = await x(tx, sql`
      insert into reimbursement_requests (organization_id, kind, client_key, created_by_user, created_by_person_id,
             group_id, beneficiary_person_id, amount_cents, expense_date, purpose, no_receipt_claimed)
      values (${org}, 'reimburse', ${`k${Math.random().toString(36).slice(2, 14)}`}, ${creator.userId}, ${creator.personId},
              ${committee}, ${opts.beneficiary ?? creator.personId}, ${opts.amount ?? 1500},
              presby_reimbursement__local_date(${org}, now()) - 3, 'Fixture purpose', ${opts.noReceipt ?? true})
      returning id`);
    const id = String(row!.id);
    await event(tx, id, "created", null, "draft");
    return id;
  }

  async function submit(tx: Tx, id: string) {
    await x(tx, sql`update reimbursement_requests set status = 'submitted' where id = ${id}`);
    await event(tx, id, "submitted", "draft", "submitted");
  }

  async function approve(tx: Tx, id: string, by = chair) {
    await x(tx, sql`
      update reimbursement_requests
         set status = 'approved', approved_at = now(), approved_by_user = ${by.userId},
             approved_by_person_id = ${by.personId}, approval_path = 'seat', approved_revision = revision
       where id = ${id}`);
    await event(tx, id, "approved", "submitted", "approved", by);
  }

  async function waive(tx: Tx, id: string, by = payer) {
    await x(tx, sql`
      update reimbursement_requests
         set receipt_waived_at = now(), receipt_waived_by_user = ${by.userId}, receipt_waived_by_person_id = ${by.personId}
       where id = ${id}`);
  }

  async function pay(tx: Tx, id: string, by = payer, opts: { selfPaid?: boolean } = {}): Promise<string> {
    const [row] = await x(tx, sql`
      insert into reimbursement_payments (organization_id, request_id, kind, method, reference, paid_on, amount_cents,
                                          paid_by_user, paid_by_person_id, self_paid)
      select organization_id, id, 'payment', 'check', '2001', presby_reimbursement__local_date(organization_id, now()),
             amount_cents, ${by.userId}, ${by.personId}, ${opts.selfPaid ?? false}
        from reimbursement_requests where id = ${id}
      returning id`);
    return String(row!.id);
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    rowsOf = mod.rowsOf;
    pgError = mod.pgError;
    fx = await mod.createReimbursementFixture("trg");
    org = await fx.makeOrg("main");
    presbytery = await fx.makeOrg("pby", { type: "presbytery" });
    committee = await fx.makeGroup(org, "Finance Committee");
    creator = await fx.member(org, "Creator");
    chair = await fx.member(org, "Chair");
    payer = await fx.member(org, "Payer");
    other = await fx.member(org, "Other");
    await fx.seat(org, committee, chair.personId);
    await fx.chargeable(org, committee, payer.userId);
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  // =========================================================================
  // Insert guard and the import door (EC36)
  // =========================================================================
  describe("insert guard and the import door", () => {
    it("an app request is born a draft at revision 1 (a submitted or approved app insert raises)", async () => {
      await rolledBack(async (tx) => {
        for (const extra of [sql`'submitted', 1`, sql`'draft', 2`]) {
          const err = await raises(tx, (sp) => x(sp, sql`
            insert into reimbursement_requests (organization_id, kind, status, revision, client_key, created_by_user,
                   created_by_person_id, group_id, beneficiary_person_id, amount_cents, expense_date, purpose)
            values (${org}, 'reimburse', ${extra}, 'clientkey01', ${creator.userId}, ${creator.personId}, ${committee},
                    ${creator.personId}, 100, current_date - 5, 'x')`));
          expect(err.message).toContain("born a draft");
        }
      });
    });

    it("EC36: an imported PAID row with null actors and a historical date commits from the owner connection", async () => {
      await committed(async (tx) => {
        const [row] = await x(tx, sql`
          insert into reimbursement_requests (organization_id, origin, kind, status, group_id, beneficiary_person_id,
                 amount_cents, expense_date, purpose, approved_at, approved_revision, created_at)
          values (${org}, 'import', 'reimburse', 'paid', ${committee}, ${creator.personId}, 4200, '2019-03-04',
                  'Imported historical request', '2019-03-10', 1, '2019-03-05')
          returning id`);
        const id = String(row!.id);
        await x(tx, sql`
          insert into reimbursement_payments (organization_id, request_id, kind, method, paid_on, amount_cents)
          values (${org}, ${id}, 'payment', 'cash', '2019-03-20', 4200)`);
        await x(tx, sql`
          insert into reimbursement_events (organization_id, request_id, kind, to_status, request_revision)
          values (${org}, ${id}, 'imported', 'paid', 1)`);
      });
    });

    it("EC36: the same null-actor shape with origin = 'app' is refused", async () => {
      await rolledBack(async (tx) => {
        const err = await raises(tx, (sp) => x(sp, sql`
          insert into reimbursement_requests (organization_id, origin, kind, status, client_key, group_id,
                 beneficiary_person_id, amount_cents, expense_date, purpose)
          values (${org}, 'app', 'reimburse', 'draft', 'clientkey02', ${committee}, ${creator.personId}, 100,
                  '2019-03-04', 'x')`));
        expect(err.code).toBe("23514");
        expect(err.message).toContain("reimbursement_requests_creator_shape");
      });
    });
  });

  // =========================================================================
  // The transition table (EC6)
  // =========================================================================
  describe("the transition table", () => {
    const allowed = transitionsFromMigration();

    it("the comment block lists the Phase 3 table exactly", () => {
      expect([...allowed].sort()).toEqual([
        "approved->paid", "approved->returned", "approved->voided", "approved->withdrawn",
        "draft->submitted", "draft->withdrawn",
        "not_approved->withdrawn",
        "paid->approved",
        "returned->submitted", "returned->voided", "returned->withdrawn",
        "submitted->approved", "submitted->not_approved", "submitted->returned", "submitted->voided", "submitted->withdrawn",
      ]);
    });

    it("EC6: every other (from, to) pair raises 'not a permitted transition' on the owner connection; every listed pair does not", async () => {
      const seen: string[] = [];
      await rolledBack(async (tx) => {
        for (const from of STATUSES) {
          for (const to of STATUSES) {
            if (from === to) continue;
            const key = `${from}->${to}`;
            let message = "";
            try {
              await tx.transaction(async (sp) => {
                // An imported row may be born in any status; the update guard applies to it all the same.
                const [row] = await x(sp as unknown as Tx, sql`
                  insert into reimbursement_requests (organization_id, origin, kind, status, group_id,
                         beneficiary_person_id, amount_cents, expense_date, purpose, no_receipt_claimed,
                         first_submitted_at, submitted_at, approved_at, approved_revision)
                  values (${org}, 'import', 'reimburse', ${from}, ${committee}, ${creator.personId}, 100, '2020-01-02',
                          'Matrix', true,
                          ${from === "draft" ? null : "2020-01-03"}::timestamptz,
                          ${from === "draft" ? null : "2020-01-03"}::timestamptz,
                          ${from === "approved" || from === "paid" ? "2020-01-04" : null}::timestamptz,
                          ${from === "approved" || from === "paid" ? 1 : null}::integer)
                  returning id`);
                await x(sp as unknown as Tx, sql`update reimbursement_requests set status = ${to} where id = ${row!.id}`);
                throw new Rollback();
              });
            } catch (err) {
              if (!(err instanceof Rollback)) message = pgError(err).message;
            }
            const refusedAsTransition = message.includes("is not a permitted transition");
            expect(refusedAsTransition, `${key}: ${message || "accepted"}`).toBe(!allowed.has(key));
            seen.push(key);
          }
        }
      });
      expect(seen).toHaveLength(56);
    });
  });

  // =========================================================================
  // Freeze, revision and the approver separation of duties (EC4, EC7, EC13)
  // =========================================================================
  describe("freeze, revision and approval", () => {
    it("EC4: a submitted request's amount, purpose and group are frozen on the owner connection", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        for (const change of [sql`amount_cents = 999`, sql`purpose = 'Changed'`, sql`group_id = ${await fx.derivedGroup(org, "session")}`]) {
          const err = await raises(tx, (sp) => x(sp, sql`update reimbursement_requests set ${change} where id = ${id}`));
          expect(err.code).toBe("23514");
        }
      });
    });

    it("P3-8: an edit while draft bumps the revision by exactly one whatever the caller writes; an arbitrary revision write raises", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        const [r1] = await x(tx, sql`update reimbursement_requests set amount_cents = 1600, revision = 40 where id = ${id} returning revision`);
        expect(Number(r1!.revision)).toBe(2);
        const err = await raises(tx, (sp) => x(sp, sql`update reimbursement_requests set revision = 9 where id = ${id}`));
        expect(err.message).toContain("revision moves by one");
      });
    });

    it("a returned request is editable again, but kind, group and payee stay frozen after the first submission", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        await x(tx, sql`update reimbursement_requests set status = 'returned' where id = ${id}`);
        const [r] = await x(tx, sql`update reimbursement_requests set amount_cents = 1700 where id = ${id} returning revision`);
        expect(Number(r!.revision)).toBe(2);
        const err = await raises(tx, (sp) => x(sp, sql`update reimbursement_requests set beneficiary_person_id = ${other.personId} where id = ${id}`));
        expect(err.message).toContain("frozen once a request has been submitted");
      });
    });

    it("EC7: the owner cannot approve as the creator, as the beneficiary, or as another person on the creator's login", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx, { beneficiary: other.personId });
        await submit(tx, id);
        // A second, unmerged person record on the creator's login (EC13: one login is one party).
        const twin = await fx.makePerson("Twin", creator.userId);
        await fx.addMembership(org, twin);
        for (const who of [creator, other, { userId: creator.userId, personId: twin }]) {
          const err = await raises(tx, (sp) => approve(sp as unknown as Tx, id, who));
          expect(err.code).toBe("42501");
          expect(err.message).toContain("no one approves a request they created or are paid by");
        }
      });
    });

    it("EC13: a person merged into the creator is the creator for separation of duties", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        const dupUser = await fx.makeUser("dup");
        const dup = await fx.makePerson("Duplicate", dupUser);
        await fx.addMembership(org, dup);
        await x(tx, sql`update people set merged_into_id = ${creator.personId} where id = ${dup}`);
        const err = await raises(tx, (sp) => approve(sp as unknown as Tx, id, { userId: dupUser, personId: dup }));
        expect(err.message).toContain("no one approves");
        const [chain] = await x(tx, sql`select presby_reimbursement__resolve_person(${dup}) as root,
          presby_reimbursement__same_party(${dup}, null, ${creator.personId}, null) as same,
          presby_reimbursement__same_party(${chair.personId}, ${chair.userId}, ${creator.personId}, ${creator.userId}) as different`);
        expect(String(chain!.root)).toBe(creator.personId);
        expect(chain!.same).toBe(true);
        expect(chain!.different).toBe(false);
      });
    });

    it("an approval must name its revision; the approval in force cannot be rewritten without a transition", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        const err = await raises(tx, (sp) => x(sp, sql`
          update reimbursement_requests set status = 'approved', approved_at = now(), approved_by_user = ${chair.userId},
                 approved_by_person_id = ${chair.personId}, approval_path = 'seat', approved_revision = revision + 1
           where id = ${id}`));
        expect(err.message).toContain("the revision it approves");
        await approve(tx, id);
        const err2 = await raises(tx, (sp) => x(sp, sql`update reimbursement_requests set approved_by_user = ${payer.userId} where id = ${id}`));
        expect(err2.message).toContain("change only with a transition");
      });
    });

    it("leaving approved for returned clears the approval and the waiver; the history keeps them", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        await approve(tx, id);
        await waive(tx, id);
        const [r] = await x(tx, sql`update reimbursement_requests set status = 'returned' where id = ${id}
          returning approved_at, approval_path, receipt_waived_at`);
        expect(r).toMatchObject({ approved_at: null, approval_path: null, receipt_waived_at: null });
      });
    });

    it("submit needs a receipt or no_receipt_claimed (the trigger, not only the definer)", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx, { noReceipt: false });
        const err = await raises(tx, (sp) => submit(sp as unknown as Tx, id));
        expect(err.message).toContain("with a receipt or with no_receipt_claimed");
      });
    });
  });

  // =========================================================================
  // Payments (EC8, EC32) and the deferred checks (EC32, EC33)
  // =========================================================================
  describe("payments and the deferred constraint triggers", () => {
    it("EC8: the approver in force cannot record the payment on the owner connection", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        await approve(tx, id);
        await waive(tx, id);
        const err = await raises(tx, (sp) => pay(sp as unknown as Tx, id, chair));
        expect(err.code).toBe("42501");
        expect(err.message).toContain("the person who approved a request does not record its payment");
      });
    });

    it("a payment needs an approved request, a receipt or a waiver, and the request amount", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        expect((await raises(tx, (sp) => pay(sp as unknown as Tx, id))).message).toContain("only an approved request is paid");
        await approve(tx, id);
        expect((await raises(tx, (sp) => pay(sp as unknown as Tx, id))).message).toContain("needs a receipt or a waiver");
        await waive(tx, id);
        const err = await raises(tx, (sp) => x(sp, sql`
          insert into reimbursement_payments (organization_id, request_id, kind, method, paid_on, amount_cents, paid_by_user, paid_by_person_id)
          values (${org}, ${id}, 'payment', 'cash', current_date - 1, 1, ${payer.userId}, ${payer.personId})`));
        expect(err.message).toContain("a payment is the request amount");
      });
    });

    it("self_paid is derived by the trigger: a caller's true is overwritten for a non-party, and the creator paying is stamped", async () => {
      await rolledBack(async (tx) => {
        const a = await draft(tx);
        await submit(tx, a);
        await approve(tx, a);
        await waive(tx, a);
        const pa = await pay(tx, a, payer, { selfPaid: true });
        const [ra] = await x(tx, sql`select self_paid from reimbursement_payments where id = ${pa}`);
        expect(ra!.self_paid).toBe(false);

        const b = await draft(tx);
        await submit(tx, b);
        await approve(tx, b);
        await waive(tx, b);
        const pb = await pay(tx, b, creator, { selfPaid: false });
        const [rb] = await x(tx, sql`select self_paid from reimbursement_payments where id = ${pb}`);
        expect(rb!.self_paid).toBe(true);
      });
    });

    it("payments and history are insert-only (UPDATE raises on the owner connection)", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        await approve(tx, id);
        await waive(tx, id);
        const pid = await pay(tx, id);
        expect((await raises(tx, (sp) => x(sp, sql`update reimbursement_payments set note = 'x' where id = ${pid}`))).message)
          .toContain("insert-only");
        expect((await raises(tx, (sp) => x(sp, sql`update reimbursement_events set note = 'x' where request_id = ${id}`))).message)
          .toContain("history is insert-only");
      });
    });

    it("EC32: a reversal offsets one payment, carries its amount, and only once", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        await approve(tx, id);
        await waive(tx, id);
        const pid = await pay(tx, id);
        await x(tx, sql`update reimbursement_requests set status = 'paid' where id = ${id}`);
        const reverse = (sp: Tx) => x(sp, sql`
          insert into reimbursement_payments (organization_id, request_id, kind, amount_cents, paid_by_user, paid_by_person_id,
                                              offsets_payment_id, reason)
          values (${org}, ${id}, 'reversal', 1500, ${payer.userId}, ${payer.personId}, ${pid}, 'Wrong check')`);
        await reverse(tx);
        await x(tx, sql`update reimbursement_requests set status = 'approved' where id = ${id}`);
        expect((await raises(tx, reverse)).message).toContain("only a paid request is reversed");
        // Paid again with a NEW payment: the old, already-reversed payment cannot be offset twice.
        await pay(tx, id);
        await x(tx, sql`update reimbursement_requests set status = 'paid' where id = ${id}`);
        expect((await raises(tx, reverse)).message).toContain("one un-reversed payment");
        const short = await raises(tx, (sp) => x(sp, sql`
          insert into reimbursement_payments (organization_id, request_id, kind, amount_cents, paid_by_user, paid_by_person_id,
                                              offsets_payment_id, reason)
          select ${org}, ${id}, 'reversal', 1, ${payer.userId}, ${payer.personId}, p.id, 'Short'
            from reimbursement_payments p where p.request_id = ${id} and p.kind = 'payment' and p.id <> ${pid}`));
        expect(short.message).toContain("carries the amount of the payment it offsets");
      });
    });

    it("EC32: a payment with no status flip fails at COMMIT (deferred)", async () => {
      let id = "";
      await committed(async (tx) => {
        id = await draft(tx);
        await submit(tx, id);
        await approve(tx, id);
        await waive(tx, id);
      });
      let caught: unknown;
      try {
        await committed(async (tx) => {
          await pay(tx, id);
        });
      } catch (err) {
        caught = err;
      }
      expect(pgError(caught).message).toContain("paid if and only if it has a live payment");
      const [r] = await fx.q(sql`select status, (select count(*) from reimbursement_payments where request_id = ${id})::int as n
                                   from reimbursement_requests where id = ${id}`);
      expect(r).toMatchObject({ status: "approved", n: 0 });
    });

    it("EC32: paid with no live payment is refused immediately by the update guard", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        await approve(tx, id);
        const err = await raises(tx, (sp) => x(sp, sql`update reimbursement_requests set status = 'paid' where id = ${id}`));
        expect(err.message).toContain("paid only with a live payment");
      });
    });

    it("EC33: a status change with no history event fails at COMMIT; with its event it commits", async () => {
      let id = "";
      await committed(async (tx) => {
        id = await draft(tx);
      });
      let caught: unknown;
      try {
        await committed(async (tx) => {
          await x(tx, sql`update reimbursement_requests set status = 'submitted' where id = ${id}`);
        });
      } catch (err) {
        caught = err;
      }
      expect(pgError(caught).message).toContain("has no history event in the same transaction");
      await committed(async (tx) => {
        await submit(tx, id);
      });
      const [r] = await fx.q(sql`select status from reimbursement_requests where id = ${id}`);
      expect(r!.status).toBe("submitted");
    });

    it("EC33: an inserted request with no 'created' event fails at COMMIT", async () => {
      let caught: unknown;
      try {
        await committed(async (tx) => {
          await x(tx, sql`
            insert into reimbursement_requests (organization_id, kind, client_key, created_by_user, created_by_person_id,
                   group_id, beneficiary_person_id)
            values (${org}, 'reimburse', 'noevent0001', ${creator.userId}, ${creator.personId}, ${committee}, ${creator.personId})`);
        });
      } catch (err) {
        caught = err;
      }
      expect(pgError(caught).message).toContain("has no history event");
    });
  });

  // =========================================================================
  // Receipts and configuration rows
  // =========================================================================
  describe("attachments and configuration guards", () => {
    it("at most 5 live receipts; attach only while draft or returned; each bumps the revision; detach is once", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        const ids: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          const b = await fx.blob(org);
          const [a] = await x(tx, sql`
            insert into reimbursement_attachments (organization_id, request_id, blob_key, content_sha256, content_type,
                   byte_size, display_name, created_by_user)
            values (${org}, ${id}, ${b.id}, ${b.sha}, 'image/jpeg', 3, ${`r${i}.jpg`}, ${creator.userId}) returning id`);
          ids.push(String(a!.id));
        }
        const [rev] = await x(tx, sql`select revision from reimbursement_requests where id = ${id}`);
        expect(Number(rev!.revision)).toBe(6);
        const sixth = await fx.blob(org);
        const err = await raises(tx, (sp) => x(sp, sql`
          insert into reimbursement_attachments (organization_id, request_id, blob_key, content_sha256, content_type,
                 byte_size, display_name, created_by_user)
          values (${org}, ${id}, ${sixth.id}, ${sixth.sha}, 'image/jpeg', 3, 'r6.jpg', ${creator.userId})`));
        expect(err.message).toContain("at most 5 live receipts");
        expect((await raises(tx, (sp) => x(sp, sql`update reimbursement_attachments set display_name = 'renamed.jpg' where id = ${ids[0]}`))).message)
          .toContain("one-time detach");
        await x(tx, sql`update reimbursement_attachments set detached_at = now(), detached_by_user = ${creator.userId} where id = ${ids[0]}`);
        expect((await raises(tx, (sp) => x(sp, sql`update reimbursement_attachments set detached_at = now() where id = ${ids[0]}`))).message)
          .toContain("one-time detach");
        await submit(tx, id);
        const late = await fx.blob(org);
        expect((await raises(tx, (sp) => x(sp, sql`
          insert into reimbursement_attachments (organization_id, request_id, blob_key, content_sha256, content_type,
                 byte_size, display_name, created_by_user)
          values (${org}, ${id}, ${late.id}, ${late.sha}, 'image/jpeg', 3, 'late.jpg', ${creator.userId})`))).message)
          .toContain("only while the request is draft or returned");
      });
    });

    it("configuration rows are born live and ended once; a category may be renamed until it is ended", async () => {
      await rolledBack(async (tx) => {
        const [c] = await x(tx, sql`insert into reimbursement_categories (organization_id, name, created_by_user)
                                    values (${org}, 'Supplies', ${payer.userId}) returning id`);
        await x(tx, sql`update reimbursement_categories set name = 'Office supplies', sort_order = 3 where id = ${c!.id}`);
        await x(tx, sql`update reimbursement_categories set ended_at = now(), ended_by_user = ${payer.userId} where id = ${c!.id}`);
        expect((await raises(tx, (sp) => x(sp, sql`update reimbursement_categories set name = 'Again' where id = ${c!.id}`))).message)
          .toContain("an ended row changes no more");
        expect((await raises(tx, (sp) => x(sp, sql`insert into reimbursement_chargeable_groups (organization_id, group_id,
                 created_by_user, ended_at, ended_by_user) values (${org}, ${committee}, ${payer.userId}, now(), ${payer.userId})`))).message)
          .toContain("born live");
        const [g] = await x(tx, sql`select id from reimbursement_chargeable_groups where group_id = ${committee} and ended_at is null`);
        expect((await raises(tx, (sp) => x(sp, sql`update reimbursement_chargeable_groups set group_id = ${presbytery} where id = ${g!.id}`))).code)
          .toBeDefined();
      });
    });
  });

  // =========================================================================
  // The receipt FK (F289's catalog rule, drizzle/0072 section 8; 0073 section
  // 1d; DECISION-277). On the OWNER connection no grant or policy binds, so
  // the FK is the whole guarantee here (F44).
  // =========================================================================
  describe("the receipt FK into blob_assets (F289)", () => {
    async function attachRaw(tx: Tx, requestId: string, blobKey: string, sha: string, opts: { audience?: string; orgOf?: string } = {}) {
      return x(tx, sql`
        insert into reimbursement_attachments (organization_id, request_id, blob_key, asset_audience, content_sha256,
               content_type, byte_size, display_name, created_by_user)
        values (${opts.orgOf ?? org}, ${requestId}, ${blobKey}, ${opts.audience ?? "private"}, ${sha}, 'image/jpeg', 3,
                'r.jpg', ${creator.userId})
        returning id`);
    }

    it("is (blob_key, organization_id, asset_audience) -> blob_assets_id_org_audience_key, NO ACTION both ways, validated, not deferrable", async () => {
      const [c] = await fx.q(sql`
        select c.confdeltype, c.confupdtype, c.convalidated, c.condeferrable,
               c.conindid = (select k.conindid from pg_constraint k where k.conname = 'blob_assets_id_org_audience_key') as on_audience_key,
               (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
               (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as fcols
          from pg_constraint c
         where c.conname = 'reimbursement_attachments_blob_fk' and c.conrelid = 'reimbursement_attachments'::regclass
           and c.confrelid = 'blob_assets'::regclass and c.contype = 'f'`);
      expect(c).toEqual({
        confdeltype: "a",
        confupdtype: "a",
        convalidated: true,
        condeferrable: false,
        on_audience_key: true,
        cols: ["blob_key", "organization_id", "asset_audience"],
        fcols: ["id", "organization_id", "audience"],
      });
    });

    it("refuses a public_site blob of the SAME organization on the owner connection; a private one of the same shape is accepted", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        const pub = await fx.blob(org, "image/jpeg", "public_site");
        const err = await raises(tx, (sp) => attachRaw(sp, id, pub.id, pub.sha));
        expect(err.code).toBe("23503");
        expect(err.message).toContain("reimbursement_attachments_blob_fk");
        const priv = await fx.blob(org);
        expect(await attachRaw(tx, id, priv.id, priv.sha)).toHaveLength(1);
      });
    });

    it("refuses another organization's private blob, and a key that names no blob", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        const foreign = await fx.blob(presbytery);
        const err = await raises(tx, (sp) => attachRaw(sp, id, foreign.id, foreign.sha));
        expect(err.code).toBe("23503");
        expect(err.message).toContain("reimbursement_attachments_blob_fk");
        const missing = await raises(tx, (sp) => attachRaw(sp, id, "00000000-0000-4000-8000-0000000000aa", "a".repeat(64)));
        expect(missing.code).toBe("23503");
      });
    });

    it("the constant cannot be set to public_site to match a public row (the CHECK fires first)", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        const pub = await fx.blob(org, "image/jpeg", "public_site");
        const err = await raises(tx, (sp) => attachRaw(sp, id, pub.id, pub.sha, { audience: "public_site" }));
        expect(err.code).toBe("23514");
        expect(err.message).toContain("reimbursement_attachments_asset_audience_private");
      });
    });

    it("NO ACTION: a referenced receipt's blob cannot be deleted on the owner connection, live or detached (F44)", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        const b = await fx.blob(org);
        const [a] = await attachRaw(tx, id, b.id, b.sha);
        const live = await raises(tx, (sp) => x(sp, sql`delete from blob_assets where id = ${b.id}`));
        expect(live.code).toBe("23503");
        expect(live.message).toContain("reimbursement_attachments_blob_fk");
        await x(tx, sql`update reimbursement_attachments set detached_at = now(), detached_by_user = ${creator.userId} where id = ${a!.id}`);
        const detached = await raises(tx, (sp) => x(sp, sql`delete from blob_assets where id = ${b.id}`));
        expect(detached.code).toBe("23503");
        // Not vacuous: an unreferenced blob of the same org deletes.
        const loose = await fx.blob(org);
        await x(tx, sql`delete from blob_assets where id = ${loose.id}`);
      });
    });

    it("the org-teardown cascade (the e2e fixtures' one `delete from organizations`) still removes an organization holding a receipt", async () => {
      const tOrg = await fx.makeOrg("teardown");
      const tCreator = await fx.member(tOrg, "Teardown");
      const tGroup = await fx.makeGroup(tOrg, "Teardown Committee");
      await fx.chargeable(tOrg, tGroup, tCreator.userId);
      const b = await fx.blob(tOrg);
      await rolledBack(async (tx) => {
        const [r] = await x(tx, sql`
          insert into reimbursement_requests (organization_id, kind, client_key, created_by_user, created_by_person_id,
                 group_id, beneficiary_person_id, amount_cents, expense_date, purpose, no_receipt_claimed)
          values (${tOrg}, 'reimburse', 'teardown-key-01', ${tCreator.userId}, ${tCreator.personId}, ${tGroup},
                  ${tCreator.personId}, 900, presby_reimbursement__local_date(${tOrg}, now()) - 1, 'Teardown', false)
          returning id`);
        await attachRaw(tx, String(r!.id), b.id, b.sha, { orgOf: tOrg });
        // The fixture cleanup's own shape (derived roster rows need the guard lifted).
        await x(tx, sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
        await x(tx, sql`delete from organizations where id = ${tOrg}`);
        const [left] = await x(tx, sql`
          select (select count(*) from reimbursement_attachments where organization_id = ${tOrg})::int as att,
                 (select count(*) from blob_assets where organization_id = ${tOrg})::int as blobs`);
        expect(left).toEqual({ att: 0, blobs: 0 });
      });
    });
  });

  // =========================================================================
  // No delete (EC34) and F301 (EC30), owner path
  // =========================================================================
  describe("delete guards and the downward guards", () => {
    it("EC34: DELETE on each of the six tables raises on the owner connection while the organization exists", async () => {
      await rolledBack(async (tx) => {
        const id = await draft(tx);
        await submit(tx, id);
        await approve(tx, id);
        await waive(tx, id);
        await pay(tx, id);
        await x(tx, sql`update reimbursement_requests set status = 'paid' where id = ${id}`);
        await event(tx, id, "payment_recorded", "approved", "paid", payer);
        await x(tx, sql`insert into reimbursement_categories (organization_id, name, created_by_user)
                        values (${org}, 'Doomed', ${payer.userId})`);
        const b = await fx.blob(org);
        const id2 = await draft(tx);
        await x(tx, sql`
          insert into reimbursement_attachments (organization_id, request_id, blob_key, content_sha256, content_type,
                 byte_size, display_name, created_by_user)
          values (${org}, ${id2}, ${b.id}, ${b.sha}, 'image/jpeg', 3, 'r.jpg', ${creator.userId})`);
        for (const table of ["reimbursement_payments", "reimbursement_events", "reimbursement_attachments",
          "reimbursement_requests", "reimbursement_categories", "reimbursement_chargeable_groups"]) {
          const err = await raises(tx, (sp) => x(sp, sql`delete from ${sql.identifier(table)} where organization_id = ${org}`));
          expect(err.code, table).toBe("42501");
          expect(err.message).toContain("reimbursement records are permanent");
        }
      });
    });

    it("EC30: a role carrying a reimbursement key cannot be used by an administrative commission (owner path), nor bound after", async () => {
      await rolledBack(async (tx) => {
        const viewerRole = await fx.makeRole(org, "viewer", ["reimbursement.view"]);
        const commissionGroup = await fx.makeGroup(presbytery, "Commission");
        const err = await raises(tx, (sp) => x(sp, sql`
          insert into administrative_commissions (parent_org_id, target_org_id, scope, role_id, starts_on, group_id)
          values (${presbytery}, ${org}, 'fixture', ${viewerRole}, current_date, ${commissionGroup})`));
        expect(err.code).toBe("42501");
        expect(err.message).toContain("reimbursement key cannot be granted through an administrative commission");

        const plainRole = await fx.makeRole(org, "plain", []);
        await x(tx, sql`
          insert into administrative_commissions (parent_org_id, target_org_id, scope, role_id, starts_on, group_id)
          values (${presbytery}, ${org}, 'fixture', ${plainRole}, current_date, ${commissionGroup})`);
        const err2 = await raises(tx, (sp) => x(sp, sql`
          insert into app_role_permissions (role_id, permission_key) values (${plainRole}, 'reimbursement.pay')`));
        expect(err2.message).toContain("reimbursement key cannot be bound to a role used by an administrative commission");
      });
    });
  });
});
