/**
 * contact-methods/store.ts against a REAL Postgres connection
 * (docs/work-log/2026-10-23-person-emails.md, Phase 3 test plan, Batch 2).
 * Every save path in the planner table runs through the `presby_app`
 * connection with an organization context (`withOrgContext`), so RLS, the 0064
 * guard, the unique indexes and the deferred main-address check are all live.
 *
 *   - each planner outcome, against the real database;
 *   - audit rows by key and metadata, with NO address (and no `@`) in any value;
 *   - refusals and stale forms write nothing (snapshots of rows and audit rows);
 *   - two simultaneous saves from one snapshot: exactly one ok, one
 *     `emails_changed`, and no unique violation;
 *   - removal is `ended_at` (the rows survive), resurrection is a NEW unverified row;
 *   - phone: end-and-replace, never a delete;
 *   - the shared-address note (ER23b): the same predicate 2b's `address_shared`
 *     (R29) will use.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/contact-methods/store.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";
import type { EmailRowInput } from "./types";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("contact-methods/store.ts (Postgres-backed)", { timeout: 120_000 }, () => {
  let fx: InvitationFixture;
  let store: typeof import("./store");
  let authz: typeof import("@/lib/authz");
  let orgA: string;
  let orgB: string;
  let editor: string;
  let stamp: string;
  /** People this suite merged: un-merged at teardown (merged_into_id is an FK). */
  const mergedPeople: string[] = [];

  const q = (query: SQL): Promise<Row[]> => fx.q(query);
  const ctx = () => ({
    organizationId: orgA,
    actor: { userId: fx.actingUserId, email: "editor@example.invalid" },
  });
  const inOrgA = <T,>(fn: (tx: import("@/lib/authz").OrgTx) => Promise<T>) =>
    authz.withOrgContext(editor, orgA, fn);

  let counter = 0;
  const addr = (tag: string) => {
    counter += 1;
    return `cm-store-${tag}-${stamp}-${counter}@example.invalid`;
  };
  const row = (value: string, over: Partial<EmailRowInput> = {}): EmailRowInput => ({
    value,
    subtype: null,
    isPrimary: false,
    doNotContact: false,
    ...over,
  });

  async function person(first: string, last = "Fixture", org = orgA): Promise<string> {
    const id = await fx.makePerson(first, `${last}${stamp}`);
    await fx.addMember(org, id);
    return id;
  }

  /** Owner-side email insert (the guard lets the owner set every column). */
  async function seedEmail(
    personId: string,
    value: string,
    o: { main?: boolean; subtype?: string | null; dnc?: boolean; createdAt?: string; endedAt?: boolean; verified?: boolean } = {},
  ): Promise<string> {
    const [r] = await q(sql`
      insert into contact_methods (person_id, kind, value, subtype, is_primary, do_not_contact, created_at, ended_at, verified_at)
      values (${personId}, 'email', ${value}, ${o.subtype ?? null}, ${o.main ?? false}, ${o.dnc ?? false},
              ${o.createdAt ?? new Date().toISOString()}::timestamptz,
              ${o.endedAt ? new Date().toISOString() : null}::timestamptz,
              ${o.verified ? new Date().toISOString() : null}::timestamptz)
      returning id`);
    return String(r!.id);
  }

  const rowsOf = (personId: string, kind = "email") =>
    q(sql`select id, value, subtype, is_primary, do_not_contact, verified_at, ended_at from contact_methods
           where person_id = ${personId} and kind = ${kind} order by created_at, id`);
  const activeOf = async (personId: string) => (await rowsOf(personId)).filter((r) => r.ended_at === null);
  const auditOf = (personId: string) =>
    q(sql`select action, metadata from audit_events
           where resource_id = ${personId} and action like 'tenant.person_email.%' order by action, id`);
  const snapshot = async (personId: string) => ({
    rows: await q(sql`select * from contact_methods where person_id = ${personId} order by id`),
    audit: await q(sql`select id from audit_events where resource_id = ${personId} order by id`),
  });

  /** Read the active set and save a list derived from it, in one organization transaction. */
  async function save(
    personId: string,
    build: (active: import("./types").ActiveEmailRow[]) => EmailRowInput[],
    knownIdsOverride?: (active: import("./types").ActiveEmailRow[]) => string[],
  ) {
    return inOrgA(async (tx) => {
      const active = await store.listActiveEmails(tx, personId);
      return store.saveEmails(tx, ctx(), personId, {
        rows: build(active),
        knownIds: (knownIdsOverride ?? ((a) => a.map((r) => r.id)))(active),
      });
    });
  }
  const same = (r: import("./types").ActiveEmailRow, over: Partial<EmailRowInput> = {}): EmailRowInput => ({
    id: r.id,
    value: r.value,
    subtype: r.subtype,
    isPrimary: r.isPrimary,
    doNotContact: r.doNotContact,
    ...over,
  });

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("cm-store");
    store = await import("./store");
    authz = await import("@/lib/authz");
    stamp = `${Date.now()}`;
    orgA = await fx.makeOrg("a");
    orgB = await fx.makeOrg("b");
    await q(sql`
      insert into permissions (key, module, description, sensitivity_tier)
      values ('people.manage', 'people', 'Create and edit people, households, and contact/address detail', 1)
      on conflict do nothing`);
    editor = await fx.makePerson("Cassandra", `Editor${stamp}`);
    await fx.enroll(orgA, editor, ["people.manage"]);
  }, 180_000);

  afterAll(async () => {
    if (!fx) return;
    try {
      for (const id of mergedPeople) {
        await q(sql`update people set merged_into_id = null where id = ${id}`);
      }
      for (const id of [orgA, orgB]) {
        if (id) await q(sql`delete from audit_events where metadata->>'organizationId' = ${id}`);
      }
    } finally {
      await fx.cleanup();
    }
  }, 180_000);

  // -------------------------------------------------------------------------
  describe("saveEmails: each planner outcome against the real database", () => {
    it("the first address becomes the main address and is audited as added (no previous main, so no primary_changed)", async () => {
      const p = await person("First");
      const a = addr("first");
      const r = await save(p, () => [row(a)]);
      expect(r).toEqual({ kind: "ok", changed: true, insertedAddresses: [a] });

      const active = await activeOf(p);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ value: a, is_primary: true, verified_at: null, ended_at: null });

      const audit = await auditOf(p);
      expect(audit.map((x) => String(x.action))).toEqual(["tenant.person_email.added"]);
      expect(audit[0]!.metadata).toEqual({
        organizationId: orgA,
        contactMethodId: active[0]!.id,
        subtype: null,
        isPrimary: true,
      });
    });

    it("adding a non-main address leaves the main alone; the Work label is stored", async () => {
      const p = await person("Adds");
      const main = addr("main");
      await seedEmail(p, main, { main: true, subtype: "personal" });
      const work = addr("work");
      const r = await save(p, (act) => [...act.map((x) => same(x)), row(work, { subtype: "work" })]);
      expect(r).toMatchObject({ kind: "ok", changed: true, insertedAddresses: [work] });
      const active = await activeOf(p);
      expect(active.map((x) => [x.value, x.is_primary, x.subtype])).toEqual([
        [main, true, "personal"],
        [work, false, "work"],
      ]);
      const audit = await auditOf(p);
      expect(audit.map((x) => String(x.action))).toEqual(["tenant.person_email.added"]);
      expect(audit[0]!.metadata).toMatchObject({ subtype: "work", isPrimary: false });
    });

    it("an explicit main change demotes and promotes in the right order (the partial unique index cannot be deferred)", async () => {
      const p = await person("Swap");
      const a = await seedEmail(p, addr("a"), { main: true, createdAt: "2026-01-01T00:00:00Z" });
      const b = await seedEmail(p, addr("b"), { createdAt: "2026-01-02T00:00:00Z" });
      const r = await save(p, (act) => act.map((x) => same(x, { isPrimary: x.id === b })));
      expect(r).toMatchObject({ kind: "ok", changed: true });
      expect((r as { promoted?: unknown }).promoted).toBeUndefined();
      const active = await activeOf(p);
      expect(active.filter((x) => x.is_primary).map((x) => x.id)).toEqual([b]);
      const audit = await auditOf(p);
      expect(audit.map((x) => String(x.action))).toEqual(["tenant.person_email.primary_changed"]);
      expect(audit[0]!.metadata).toEqual({
        organizationId: orgA,
        fromContactMethodId: a,
        toContactMethodId: b,
        automatic: false,
      });
    });

    it("removing the main promotes the OLDEST remaining address automatically and says which (Q3)", async () => {
      const p = await person("Promote");
      const main = await seedEmail(p, addr("main"), { main: true, createdAt: "2026-01-03T00:00:00Z" });
      const oldest = await seedEmail(p, addr("oldest"), { subtype: "work", createdAt: "2026-01-01T00:00:00Z" });
      const newer = await seedEmail(p, addr("newer"), { createdAt: "2026-01-02T00:00:00Z" });
      let oldestValue = "";
      const r = await save(p, (act) => {
        oldestValue = act.find((x) => x.id === oldest)!.value;
        return act.filter((x) => x.id !== main).map((x) => same(x, { isPrimary: false }));
      });
      expect(r).toMatchObject({ kind: "ok", changed: true, promoted: { address: oldestValue } });

      const all = await rowsOf(p);
      expect(all.find((x) => x.id === main)).toMatchObject({ is_primary: false });
      expect(all.find((x) => x.id === main)!.ended_at).not.toBeNull();
      expect(all.filter((x) => x.ended_at === null && x.is_primary).map((x) => x.id)).toEqual([oldest]);
      expect(all.find((x) => x.id === newer)!.is_primary).toBe(false);

      const audit = await auditOf(p);
      expect(audit.map((x) => String(x.action)).sort()).toEqual(["tenant.person_email.ended", "tenant.person_email.primary_changed"]);
      expect(audit.find((x) => String(x.action).endsWith("ended"))!.metadata).toEqual({
        organizationId: orgA,
        contactMethodId: main,
        subtype: null,
        wasPrimary: true,
      });
      expect(audit.find((x) => String(x.action).endsWith("primary_changed"))!.metadata).toEqual({
        organizationId: orgA,
        fromContactMethodId: main,
        toContactMethodId: oldest,
        automatic: true,
      });
    });

    it("removing every address ends them all; the rows and their values survive (removal is soft)", async () => {
      const p = await person("Gone");
      const a = addr("a");
      const b = addr("b");
      await seedEmail(p, a, { main: true, createdAt: "2026-01-01T00:00:00Z" });
      await seedEmail(p, b, { createdAt: "2026-01-02T00:00:00Z" });
      const r = await save(p, () => []);
      expect(r).toMatchObject({ kind: "ok", changed: true });
      expect(await activeOf(p)).toHaveLength(0);
      const all = await rowsOf(p);
      expect(all.map((x) => x.value).sort()).toEqual([a, b].sort());
      expect(all.every((x) => x.ended_at !== null && x.is_primary === false)).toBe(true);
      const audit = await auditOf(p);
      expect(audit.map((x) => String(x.action))).toEqual(["tenant.person_email.ended", "tenant.person_email.ended"]);
    });

    it("a typo fix ends the row and inserts a replacement: label and flag carry as submitted, verified_at NEVER travels (F214)", async () => {
      const p = await person("Typo");
      const old = await seedEmail(p, addr("typo"), { main: true, subtype: "work", dnc: true, verified: true });
      const fixed = addr("fixed");
      const r = await save(p, (act) => [same(act[0]!, { value: fixed.toUpperCase() })]);
      expect(r).toMatchObject({ kind: "ok", changed: true, insertedAddresses: [fixed] });

      const all = await rowsOf(p);
      const ended = all.find((x) => x.id === old)!;
      const fresh = all.find((x) => x.id !== old)!;
      expect(ended.ended_at).not.toBeNull();
      expect(ended.is_primary).toBe(false);
      expect(ended.verified_at).not.toBeNull(); // the ended row keeps its history
      expect(fresh).toMatchObject({ value: fixed, subtype: "work", do_not_contact: true, is_primary: true, verified_at: null, ended_at: null });

      const audit = await auditOf(p);
      expect(audit.map((x) => String(x.action)).sort()).toEqual([
        "tenant.person_email.added",
        "tenant.person_email.ended",
        "tenant.person_email.primary_changed",
      ]);
      expect(audit.find((x) => String(x.action).endsWith(".ended"))!.metadata).toMatchObject({ replacedById: fresh.id, wasPrimary: true });
      expect(audit.find((x) => String(x.action).endsWith(".added"))!.metadata).toMatchObject({ replacesId: old, isPrimary: true });
      expect(audit.find((x) => String(x.action).endsWith("primary_changed"))!.metadata).toMatchObject({
        fromContactMethodId: old,
        toContactMethodId: fresh.id,
        automatic: false,
      });
    });

    it("swapping two addresses in one save passes the unique index (rows end before the replacements insert)", async () => {
      const p = await person("Swapper");
      const one = addr("one");
      const two = addr("two");
      await seedEmail(p, one, { main: true, createdAt: "2026-01-01T00:00:00Z" });
      await seedEmail(p, two, { createdAt: "2026-01-02T00:00:00Z" });
      const r = await save(p, (act) => [
        same(act.find((x) => x.value === one)!, { value: two }),
        same(act.find((x) => x.value === two)!, { value: one }),
      ]);
      expect(r).toMatchObject({ kind: "ok", changed: true });
      const active = await activeOf(p);
      expect(active.map((x) => x.value).sort()).toEqual([one, two].sort());
      expect(active.filter((x) => x.is_primary)).toHaveLength(1);
      expect((await rowsOf(p)).filter((x) => x.ended_at !== null)).toHaveLength(2);
    });

    it("a label or do-not-contact change is in place and audited as updated, with the field names only", async () => {
      const p = await person("Label");
      const id = await seedEmail(p, addr("label"), { main: true });
      const r = await save(p, (act) => [same(act[0]!, { subtype: "other", doNotContact: true })]);
      expect(r).toMatchObject({ kind: "ok", changed: true, insertedAddresses: [] });
      const active = await activeOf(p);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id, subtype: "other", do_not_contact: true, ended_at: null });
      const audit = await auditOf(p);
      expect(audit.map((x) => String(x.action))).toEqual(["tenant.person_email.updated"]);
      expect(audit[0]!.metadata).toEqual({ organizationId: orgA, contactMethodId: id, fields: ["subtype", "doNotContact"] });
    });

    it("resurrection: ending then re-adding the same address is a NEW row with verified_at null; the verified one stays ended", async () => {
      const p = await person("Back");
      const a = addr("again");
      const first = await seedEmail(p, a, { main: true, verified: true });
      await save(p, () => []);
      const r = await save(p, () => [row(a)]);
      expect(r).toMatchObject({ kind: "ok", changed: true, insertedAddresses: [a] });
      const all = await rowsOf(p);
      expect(all).toHaveLength(2);
      const old = all.find((x) => x.id === first)!;
      const fresh = all.find((x) => x.id !== first)!;
      expect(old.ended_at).not.toBeNull();
      expect(old.verified_at).not.toBeNull();
      expect(fresh).toMatchObject({ value: a, is_primary: true, verified_at: null, ended_at: null });
    });

    it("submitting the list as loaded writes nothing: no rows changed, no audit row", async () => {
      const p = await person("Idle");
      await seedEmail(p, addr("idle"), { main: true });
      await seedEmail(p, addr("idle2"), { subtype: "work" });
      const before = await snapshot(p);
      const r = await save(p, (act) => act.map((x) => same(x)));
      expect(r).toEqual({ kind: "ok", changed: false, insertedAddresses: [] });
      expect(await snapshot(p)).toEqual(before);
    });

    it("an unflagged submission with the old main kept leaves the main where it is (no change, no audit)", async () => {
      const p = await person("Legacy");
      const only = await seedEmail(p, addr("legacy"), { main: true });
      const before = await snapshot(p);
      const r = await save(p, (act) => act.map((x) => same(x, { isPrimary: false })));
      expect(r).toMatchObject({ kind: "ok", changed: false });
      expect((await activeOf(p)).map((x) => [x.id, x.is_primary])).toEqual([[only, true]]);
      expect(await snapshot(p)).toEqual(before);
      // The legacy shape (active addresses, no main) cannot be committed any more: the
      // deferred check refuses it (contact-methods.db.test.ts); the planner's rule for it
      // is pinned in email-plan.test.ts.
    });
  });

  // -------------------------------------------------------------------------
  describe("refusals and stale forms write nothing", () => {
    const refusals: Array<[string, (a: import("./types").ActiveEmailRow[]) => EmailRowInput[]]> = [
      ["invalid_shape", (a) => [...a.map((x) => same(x)), row("not-an-address")]],
      ["duplicate", (a) => [...a.map((x) => same(x)), row(a[0]!.value.toUpperCase())]],
      ["multiple_primary", (a) => [...a.map((x) => same(x)), row("second@example.invalid", { isPrimary: true })]],
      ["bad_subtype", (a) => [...a.map((x) => same(x)), row("x@example.invalid", { subtype: "home" as never })]],
      ["too_long", (a) => [...a.map((x) => same(x)), row(`${"a".repeat(250)}@b.co`)]],
      [
        "too_many",
        (a) => [...a.map((x) => same(x)), ...Array.from({ length: 10 }, (_v, i) => row(`m${i}@example.invalid`))],
      ],
    ];

    it.each(refusals)("%s: nothing is written to the rows or the audit trail", async (reason, build) => {
      const p = await person(`Refuse-${reason}`);
      await seedEmail(p, addr("keep"), { main: true });
      const before = await snapshot(p);
      const r = await save(p, build);
      expect(r).toMatchObject({ kind: "refused", refusal: { reason } });
      expect(await snapshot(p)).toEqual(before);
    });

    it("emails_changed: a stale form (an address added since it loaded) is refused and nothing is written (D4)", async () => {
      const p = await person("Stale");
      const a = await seedEmail(p, addr("a"), { main: true });
      const loaded = [a];
      await seedEmail(p, addr("added-meanwhile"), { createdAt: new Date(Date.now() + 1000).toISOString() });
      const before = await snapshot(p);
      const r = await save(
        p,
        (act) => act.filter((x) => x.id === a).map((x) => same(x)),
        () => loaded,
      );
      expect(r).toEqual({ kind: "refused", refusal: { reason: "emails_changed" } });
      expect(await snapshot(p)).toEqual(before);
    });

    it("emails_changed: a row id that belongs to ANOTHER person is refused, and that person's row is untouched", async () => {
      const mine = await person("Mine");
      const theirs = await person("Theirs");
      const myRow = await seedEmail(mine, addr("mine"), { main: true });
      const theirRow = await seedEmail(theirs, addr("theirs"), { main: true });
      const before = await snapshot(theirs);
      const r = await save(
        mine,
        (act) => [same(act[0]!), { id: theirRow, value: addr("hijack"), subtype: null, isPrimary: false, doNotContact: false }],
        (act) => [...act.map((x) => x.id), theirRow],
      );
      expect(r).toEqual({ kind: "refused", refusal: { reason: "emails_changed" } });
      expect(await snapshot(theirs)).toEqual(before);
      expect((await activeOf(mine)).map((x) => x.id)).toEqual([myRow]);
    });

    it("knownIds repeated or missing is the same refusal", async () => {
      const p = await person("Known");
      const a = await seedEmail(p, addr("a"), { main: true });
      const dup = await save(p, (act) => act.map((x) => same(x)), () => [a, a]);
      expect(dup).toEqual({ kind: "refused", refusal: { reason: "emails_changed" } });
      const none = await save(p, (act) => act.map((x) => same(x)), () => []);
      expect(none).toEqual({ kind: "refused", refusal: { reason: "emails_changed" } });
    });
  });

  // -------------------------------------------------------------------------
  describe("concurrency: the person lock serializes saves", () => {
    it("two simultaneous saves from one snapshot: exactly one ok, one emails_changed, no unique violation", async () => {
      const p = await person("Race");
      const a = await seedEmail(p, addr("race"), { main: true });
      const snapshotIds = [a];
      const attempt = (tag: string) =>
        inOrgA(async (tx) => {
          const active = await store.listActiveEmails(tx, p);
          return store.saveEmails(tx, ctx(), p, {
            rows: [...active.map((x) => same(x)), row(addr(tag), { subtype: "work" })],
            knownIds: snapshotIds,
          });
        });
      const settled = await Promise.allSettled([attempt("left"), attempt("right")]);
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
      const results = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof attempt>>>).value);
      expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
      const refused = results.filter((r) => r.kind === "refused");
      expect(refused).toEqual([{ kind: "refused", refusal: { reason: "emails_changed" } }]);
      const active = await activeOf(p);
      expect(active).toHaveLength(2);
      expect(active.filter((x) => x.is_primary)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("the audit trail never carries an address (ER20)", () => {
    it("across every save path, no metadata value contains an @, a domain, or any part of an address", async () => {
      const p = await person("Quiet");
      const m = addr("quiet-main");
      const w = addr("quiet-work");
      await save(p, () => [row(m), row(w, { subtype: "work" })]);
      await save(p, (act) => act.map((x) => same(x, { doNotContact: x.value === w })));
      await save(p, (act) => act.map((x) => same(x, { isPrimary: x.value === w })));
      await save(p, (act) => act.map((x) => (x.value === m ? same(x, { value: addr("quiet-fixed") }) : same(x))));
      await save(p, (act) => act.filter((x) => x.isPrimary === false).map((x) => same(x)));
      const audit = await auditOf(p);
      expect(audit.length).toBeGreaterThanOrEqual(6);
      const json = JSON.stringify(audit.map((x) => x.metadata));
      expect(json).not.toContain("@");
      expect(json).not.toContain("example.invalid");
      expect(json).not.toContain("cm-store-");
      // every metadata carries the acting organization, and ids/labels/flags only
      for (const a of audit) {
        const md = a.metadata as Record<string, unknown>;
        expect(md.organizationId).toBe(orgA);
        for (const [key, value] of Object.entries(md)) {
          expect(["string", "boolean", "object"], key).toContain(typeof value);
          if (typeof value === "string") expect(value, key).not.toMatch(/@|\./);
        }
      }
      expect(audit.every((a) => String(a.action).startsWith("tenant.person_email."))).toBe(true);
    });

    it("the audit row is in the SAME transaction: a failing audit insert rolls the whole save back", async () => {
      const p = await person("AllOrNothing");
      await seedEmail(p, addr("keep"), { main: true });
      const before = await snapshot(p);
      await expect(
        inOrgA(async (tx) => {
          const active = await store.listActiveEmails(tx, p);
          const saved = await store.saveEmails(tx, ctx(), p, {
            rows: [...active.map((x) => same(x)), row(addr("lost"))],
            knownIds: active.map((x) => x.id),
          });
          expect(saved.kind).toBe("ok");
          throw new Error("force a rollback after the store wrote its rows and audit rows");
        }),
      ).rejects.toThrow(/force a rollback/);
      expect(await snapshot(p)).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  describe("phones: end-and-replace, never a delete", () => {
    it("set, change (the label carries), unchanged (no-op), clear: every old row survives as an ended row", async () => {
      const p = await person("Phone");
      const phone = (v: string | undefined) => inOrgA((tx) => store.savePrimaryPhone(tx, p, v));

      expect(await phone("555-0100")).toEqual({ changed: true });
      expect(await phone("  555-0100 ")).toEqual({ changed: false });
      await q(sql`update contact_methods set subtype = 'mobile' where person_id = ${p} and kind = 'phone'`);
      expect(await phone("555-0101")).toEqual({ changed: true });
      let rows = await rowsOf(p, "phone");
      expect(rows).toHaveLength(2);
      const active = rows.filter((x) => x.ended_at === null);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ value: "555-0101", subtype: "mobile", is_primary: true });
      expect(rows.find((x) => x.ended_at !== null)).toMatchObject({ value: "555-0100", is_primary: false });

      expect(await phone(undefined)).toEqual({ changed: true });
      expect(await phone("")).toEqual({ changed: false });
      rows = await rowsOf(p, "phone");
      expect(rows).toHaveLength(2);
      expect(rows.every((x) => x.ended_at !== null)).toBe(true);
      expect(await inOrgA((tx) => store.getPrimaryPhone(tx, p))).toBeNull();
    });

    it("getPrimaryPhone returns the active primary", async () => {
      const p = await person("PhoneRead");
      await inOrgA((tx) => store.savePrimaryPhone(tx, p, "555-0123"));
      expect(await inOrgA((tx) => store.getPrimaryPhone(tx, p))).toBe("555-0123");
    });
  });

  // -------------------------------------------------------------------------
  describe("createContactsForNewPerson (before the membership exists, D11)", () => {
    it("is exercised end to end by createPerson in src/lib/people.test.ts; here: an invalid list is refused before any write", async () => {
      const p = await fx.makePerson("Newcomer", `Fresh${stamp}`); // no membership: the create-time window
      const result = await inOrgA((tx) =>
        store.createContactsForNewPerson(tx, ctx(), p, { emails: [row("nope")] }),
      );
      expect(result).toEqual({ kind: "refused", refusal: { reason: "invalid_shape", index: 0 } });
      expect(await rowsOf(p)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("findSharedAddressNotes: R29's predicate (ER23b), inside this organization only", () => {
    const notes = (personId: string, addresses: string[]) =>
      inOrgA((tx) => store.findSharedAddressNotes(tx, personId, addresses));

    it("names another LIVE person in this organization who holds the address as an active email", async () => {
      const me = await person("Me");
      const other = await fx.makePerson("Winifred", `Shared${stamp}`);
      await fx.addMember(orgA, other);
      const a = addr("shared");
      await seedEmail(other, a, { main: true });
      expect(await notes(me, [a])).toEqual([{ address: a, names: [`Winifred Shared${stamp}`], more: 0 }]);
    });

    it("uses the preferred name when there is one", async () => {
      const me = await person("Me2");
      const other = await fx.makePerson("Winifred", `Pref${stamp}`);
      await q(sql`update people set preferred_name = 'Winnie' where id = ${other}`);
      await fx.addMember(orgA, other);
      const a = addr("pref");
      await seedEmail(other, a, { main: true });
      expect((await notes(me, [a]))[0]!.names).toEqual([`Winnie Pref${stamp}`]);
    });

    it("never names: the person themself, an ENDED holder, an ended membership, a merged person, or another organization's person", async () => {
      const me = await person("Solo");
      const a = addr("solo");
      await seedEmail(me, a, { main: true });

      const endedRow = await person("EndedRow");
      await seedEmail(endedRow, a, { endedAt: true });

      const endedMembership = await person("EndedMembership");
      await seedEmail(endedMembership, a, { main: true });
      await q(sql`update memberships set ended_on = current_date, ended_reason = 'transferred'
                   where organization_id = ${orgA} and person_id = ${endedMembership}`);

      const merged = await person("Merged");
      await seedEmail(merged, a, { main: true });
      await q(sql`update people set merged_into_id = ${me} where id = ${merged}`);
      mergedPeople.push(merged);

      const elsewhere = await fx.makePerson("Elsewhere", `OrgB${stamp}`);
      await fx.addMember(orgB, elsewhere);
      await seedEmail(elsewhere, a, { main: true });

      expect(await notes(me, [a])).toEqual([]);
    });

    it("caps the names at three, ordered by last then first name, and counts the rest", async () => {
      const me = await person("Capped");
      const a = addr("cap");
      for (const [first, last] of [["Dee", "Zed"], ["Abe", "Able"], ["Cy", "Baker"], ["Bo", "Baker"], ["Eve", "Young"]] as const) {
        const id = await fx.makePerson(first, `${last}${stamp}`);
        await fx.addMember(orgA, id);
        await seedEmail(id, a, { main: true });
      }
      const [note] = await notes(me, [a]);
      expect(note!.names).toEqual([`Abe Able${stamp}`, `Bo Baker${stamp}`, `Cy Baker${stamp}`]);
      expect(note!.more).toBe(2);
    });

    it("answers several addresses in one call, in the order given, skipping the unshared", async () => {
      const me = await person("Several");
      const a = addr("sev-a");
      const b = addr("sev-b");
      const c = addr("sev-c");
      const other = await person("Other", "Sev");
      await seedEmail(other, c, { main: true });
      await seedEmail(other, a, {});
      const result = await notes(me, [c, b, a, a]);
      expect(result.map((n) => n.address)).toEqual([c, a]);
    });

    it("an empty list is no query and no note", async () => {
      expect(await notes(await person("Empty"), [])).toEqual([]);
    });
  });
});
