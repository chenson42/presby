/**
 * D3: src/lib/committees/store.ts against a REAL Postgres connection
 * (docs/work-log/2026-11-19-presbytery-committees.md, Phase 3 "Test plan" D3 and
 * "Edge Cases & Risks"). Every write runs on the `presby_app` connection with an
 * organization context (`withOrgContext`), so RLS, the 0090 guards and the CHECKs
 * are all live. Pinned here:
 *
 *   - each write: a missing key (or an organization that is not a presbytery)
 *     writes nothing and audits nothing; success writes the expected audit row
 *     with EXACTLY the allowlisted metadata; no audit row carries a name or free
 *     text (sentinels in every free-text field are found in none);
 *   - the audit is IN THE SAME TRANSACTION: an audit insert that fails leaves the
 *     data unchanged, and an audit insert that succeeded and then has the
 *     transaction fail leaves NO audit row (the two sabotages that each catches:
 *     an after-commit audit, and an audit on another connection);
 *   - an unchanged edit writes and audits nothing;
 *   - `not_found` is byte-identical for another presbytery's committee, a choir, a
 *     derived group, a congregation's committee and a nonexistent UUID;
 *   - THE ATOMIC ROLE CHANGE: old `ends_on` and new `starts_on` are the same date,
 *     a planned end is preserved, one audit row, a stale form is refused, a legacy
 *     `leader` row is changeable, a person holds exactly one role at the instants
 *     just before, at and after the effective date, and a failure after both writes
 *     leaves neither;
 *   - the public listing is carried to the new row of a role change;
 *   - dissolve: every seat ended, a seat that has not started is zero-length at its
 *     own start, a future date and one before a begun seat are refused, no seat is
 *     left open, one audit row with the count, a later add refused;
 *   - interval overlap: adjacent seats do not overlap, a back-dated seat next to an
 *     open one is accepted when disjoint, zero-length rows are ignored, co-chairs
 *     are allowed;
 *   - concurrency: two simultaneous creates of one name (one row, one
 *     `duplicate_name`); two simultaneous adds of one person (one seat); a dissolve
 *     racing an add leaves NO open seat on a dissolved committee; a role change
 *     racing an end term ends consistent.
 *
 *   - INCREMENT 2, commission records (the last describe): each of the six writes (key,
 *     audit row with ids only, no title/charge/minute in any audit row, the audit in the
 *     SAME transaction, nothing written to a group or to the downward tables); the
 *     congregation resolver (another presbytery's, a non-congregation, a departed one, a
 *     nonexistent and a malformed id, and the 0045 trigger's refusal all give ONE
 *     byte-identical answer; a closing congregation is accepted); `stale`; interval
 *     overlap; the live-parent guard (an add racing an end or a removal); end-of-record
 *     ends every member.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/committees/store.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";
import { todayInOrgZone } from "@/lib/shared/org-time";
// Enter the domain cycle through the canonical entry point first (see oversight/store.db.test.ts);
// ./committees is re-exported from domain/index.ts only at integration (Rule 16).
import "@/lib/db/schema";
import type { CommitteesCtx, Outcome } from "./contract";
import { addYears } from "./derive";
import { dateText, refusalMessage, REFUSAL, VALIDATION } from "./copy";
import {
  parseCommission,
  parseCommissionMember,
  parseCommittee,
  parseEndCommission,
  parseSeat,
  type CommissionValues,
  type CommitteeValues,
  type SeatValues,
} from "./validate";

vi.mock("server-only", () => ({}));
// audit.ts imports @/auth (next-auth), which this test environment cannot load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// A switch in front of the real audit insert.
const hooks = vi.hoisted(() => ({
  mode: "ok" as "ok" | "fail_before" | "fail_after",
  /** An organization the stand-in `resolveMemberCongregation` pretends is a member (the about-org trigger case). */
  pretendMember: null as null | string,
}));
vi.mock("@/lib/presbytery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presbytery")>();
  return {
    ...actual,
    resolveMemberCongregation: async (...args: Parameters<typeof actual.resolveMemberCongregation>) =>
      hooks.pretendMember && args[2] === hooks.pretendMember
        ? { id: hooks.pretendMember, name: "Pretend member", platformStatus: "unmanaged" }
        : actual.resolveMemberCongregation(...args),
  };
});
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (hooks.mode === "fail_before") throw new Error("audit store unavailable");
      await actual.insertAuditRow(...args);
      // The audit insert SUCCEEDED; now the transaction fails. In the same transaction both roll back.
      if (hooks.mode === "fail_after") throw new Error("transaction failed after the audit insert");
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;

const rowsOf = (result: unknown): Row[] => {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
};

/** The organization's default zone (these fixtures have no settings row), the same day the store reads. */
const TODAY = todayInOrgZone(new Date(), "America/New_York");
const ENV = { today: TODAY };

/** `iso` shifted by whole days (UTC arithmetic on a date-only string). */
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ok<T>(parsed: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!parsed.ok) throw new Error(`fixture input did not parse: ${parsed.message}`);
  return parsed.value;
}

describe.skipIf(!hasDb)("committees/store.ts (Postgres-backed)", { timeout: 240_000 }, () => {
  let fx: CalendarFixture;
  let store: typeof import("./store");
  let P: string; // the presbytery
  let P2: string; // another presbytery
  let C: string; // a congregation
  let stamp: string;
  let counter = 0;
  let clerk: string; // groups.manage at P
  let keyless: string; // a member of P with no role
  let clerkC: string; // groups.manage at the congregation C
  let clerkP2: string; // groups.manage at P2
  let people: string[] = []; // eight people with a CURRENT membership at P
  let gone: string; // a person whose membership at P has ended
  let congOnly: string; // a member of C only
  let choirP: string;
  let derivedP: string;
  let committeeC: string; // a committee group at the congregation
  let committeeP2: string; // a committee at the other presbytery

  const q = async (query: SQL): Promise<Row[]> => rowsOf(await fx.platform.execute(query));
  const ctxFor = (personId: string, organizationId = P): CommitteesCtx => ({
    personId,
    organizationId,
    actor: { userId: fx.actingUserId, email: "committees-test@example.invalid" },
  });
  const clerkCtx = () => ctxFor(clerk);

  const committeeIn = (over: Partial<CommitteeValues> = {}) =>
    ok(parseCommittee({ name: `Cmt90 ${stamp} ${(counter += 1)}`, kind: "standing", purpose: "", meetsWhen: "", ...over }));
  const seatIn = (personId: string, role = "member", startsOn = shift(TODAY, -30), endsOn = "") =>
    ok(parseSeat({ personId, role, startsOn, endsOn } satisfies SeatValues, ENV));

  async function mkCommittee(over: Partial<CommitteeValues> = {}): Promise<string> {
    const r = await store.createCommittee(clerkCtx(), committeeIn(over));
    if (r.kind !== "ok") throw new Error(`createCommittee fixture refused: ${JSON.stringify(r)}`);
    return r.data.id;
  }
  async function mkSeat(committeeId: string, personId: string, role = "member", startsOn = shift(TODAY, -30), endsOn = ""): Promise<string> {
    const r = await store.addCommitteeSeat(clerkCtx(), committeeId, seatIn(personId, role, startsOn, endsOn));
    if (r.kind !== "ok") throw new Error(`addCommitteeSeat fixture refused: ${JSON.stringify(r)}`);
    return r.data.id;
  }

  const seatRow = async (id: string): Promise<Row> => {
    const rows = await q(sql`select group_role, starts_on::text as starts_on, ends_on::text as ends_on, public_listed, public_listed_by, source from group_memberships where id = ${id}`);
    expect(rows, `seat ${id}`).toHaveLength(1);
    return rows[0]!;
  };
  const seatsOf = (committeeId: string) =>
    q(sql`select id, person_id, group_role, starts_on::text as starts_on, ends_on::text as ends_on from group_memberships where group_id = ${committeeId} order by starts_on, id`);
  const detailsOf = async (committeeId: string): Promise<Row | undefined> =>
    (await q(sql`select kind, dissolved_on::text as dissolved_on, dissolved_by from committee_details where group_id = ${committeeId}`))[0];
  const groupOf = async (committeeId: string): Promise<Row> =>
    (await q(sql`select name, description, meets_when, membership_source from groups where id = ${committeeId}`))[0]!;
  const auditRows = (resourceId: string) =>
    q(sql`select action, resource_type, resource_id, actor_user_id, metadata from audit_events where resource_id = ${resourceId} order by created_at, id`);
  const auditFor = (committeeId: string) =>
    q(sql`select action, resource_type, resource_id, metadata from audit_events
           where action like 'tenant.committee.%' and metadata->>'committeeId' = ${committeeId} order by created_at, id`);
  const holdsAt = async (committeeId: string, personId: string, day: string): Promise<number> =>
    Number(
      (
        await q(sql`select count(*)::int as n from group_memberships
                     where group_id = ${committeeId} and person_id = ${personId}
                       and starts_on <= ${day}::date and (ends_on is null or ends_on > ${day}::date)`)
      )[0]!.n,
    );

  /** A fingerprint of everything the store writes at both presbyteries, plus its audit rows. */
  async function snapshot(): Promise<unknown> {
    const tables: Row[] = [];
    for (const t of ["committee_details", "group_memberships", "groups"] as const) {
      tables.push(
        ...(await q(
          sql`select ${t}::text as t, count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x.id)), '') as h
                from ${sql.identifier(t)} x where x.organization_id in (${P}, ${P2}, ${C})`,
        )),
      );
    }
    const audit = await q(
      sql`select count(*)::int as n from audit_events where action like 'tenant.committee.%' and metadata->>'organizationId' in (${P}, ${P2}, ${C})`,
    );
    return { tables, audit };
  }
  const auditCount = async () =>
    Number((await q(sql`select count(*)::int as n from audit_events where action like 'tenant.committee.%' and metadata->>'organizationId' = ${P}`))[0]!.n);

  beforeAll(async () => {
    const { createCalendarFixture } = await import("@/lib/testing/calendar-fixture");
    fx = await createCalendarFixture("cmtstore");
    stamp = String(Date.now());
    P = await fx.makeOrg("Presbytery", { organizationType: "presbytery" });
    P2 = await fx.makeOrg("OtherPresbytery", { organizationType: "presbytery" });
    C = await fx.makeOrg("Congregation");

    clerk = await fx.makePerson("Clerk", `Cmt${stamp}`);
    await fx.enroll(P, clerk, ["groups.manage"]);
    keyless = await fx.makePerson("Keyless", `Cmt${stamp}`);
    await fx.enroll(P, keyless, []);
    clerkC = await fx.makePerson("Congclerk", `Cmt${stamp}`);
    await fx.enroll(C, clerkC, ["groups.manage"]);
    clerkP2 = await fx.makePerson("Otherclerk", `Cmt${stamp}`);
    await fx.enroll(P2, clerkP2, ["groups.manage"]);

    for (const [i, name] of ["Avery", "Blair", "Casey", "Devon", "Emery", "Finley", "Gray", "Harper"].entries()) {
      const id = await fx.makePerson(name, `Seat${i}${stamp}`);
      await fx.addMember(P, id, { roll: null });
      people.push(id);
    }
    gone = await fx.makePerson("Gone", `Away${stamp}`);
    await fx.addMember(P, gone, { roll: null });
    await fx.platform.execute(sql`alter table memberships disable trigger memberships_guard_end`);
    try {
      await q(sql`update memberships set ended_on = '2021-06-15' where person_id = ${gone} and organization_id = ${P}`);
    } finally {
      await fx.platform.execute(sql`alter table memberships enable trigger memberships_guard_end`);
    }
    congOnly = await fx.makePerson("Congonly", `Pew${stamp}`);
    await fx.addMember(C, congOnly);

    const group = async (org: string, typeKey: string, name: string) =>
      String(
        (
          await q(sql`insert into groups (organization_id, group_type_id, name)
                      values (${org}, (select id from group_types where key = ${typeKey}), ${name}) returning id`)
        )[0]!.id,
      );
    choirP = await group(P, "choir", `Cmt90 ${stamp} Choir`);
    committeeC = await group(C, "committee", `Cmt90 ${stamp} Congregation Committee`);
    derivedP = String((await q(sql`select id from groups where organization_id = ${P} and derived_from = 'active_membership'`))[0]!.id);

    store = await import("./store");
    const r = await store.createCommittee(ctxFor(clerkP2, P2), committeeIn());
    if (r.kind !== "ok") throw new Error(`the other presbytery's committee did not create: ${JSON.stringify(r)}`);
    committeeP2 = r.data.id;
  });

  afterAll(async () => {
    if (!fx) return;
    // The presbytery's cascade takes committee_details, groups and seats; the congregation is deleted by cleanup().
    await fx.cleanup();
  });

  beforeEach(() => {
    hooks.mode = "ok";
    hooks.pretendMember = null;
  });
  afterEach(() => vi.restoreAllMocks());

  // ---------------------------------------------------------------------------
  it("(precondition) the writer is presby_app and the fixture presbyteries are presbyteries", async () => {
    const { db } = await import("@/lib/db");
    const who = await db.transaction(async (tx) => rowsOf(await tx.execute(sql`select current_user as u`)));
    expect(who[0]).toEqual({ u: "presby_app" });
    const types = await q(sql`select organization_type from organizations where id in (${P}, ${P2}, ${C}) order by organization_type`);
    expect(types.map((t) => t.organization_type).sort()).toEqual(["congregation", "presbytery", "presbytery"]);
  });

  // ---------------------------------------------------------------------------
  describe("a missing key, or an organization that is not a presbytery, writes nothing and audits nothing", () => {
    it("every write refuses `forbidden` for a member with no key, and for the congregation's own clerk at the congregation", async () => {
      const committee = await mkCommittee();
      const seat = await mkSeat(committee, people[0]!, "member");
      const before = await snapshot();

      const calls: Array<[string, (ctx: CommitteesCtx) => Promise<{ kind: string }>]> = [
        ["createCommittee", (c) => store.createCommittee(c, committeeIn())],
        ["updateCommittee", (c) => store.updateCommittee(c, committee, committeeIn({ name: "Nope" }))],
        ["dissolveCommittee", (c) => store.dissolveCommittee(c, committee, TODAY)],
        ["addCommitteeSeat", (c) => store.addCommitteeSeat(c, committee, seatIn(people[1]!))],
        ["changeCommitteeSeatRole", (c) => store.changeCommitteeSeatRole(c, committee, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: TODAY })],
        ["endCommitteeSeat", (c) => store.endCommitteeSeat(c, committee, seat, { endsOn: TODAY })],
        ["setCommitteeSeatPublicListed", (c) => store.setCommitteeSeatPublicListed(c, committee, seat, true)],
      ];
      for (const [name, call] of calls) {
        expect(await call(ctxFor(keyless)), `${name} (no key)`).toEqual({ kind: "refused", reason: "forbidden" });
      }
      expect(await snapshot()).toEqual(before);

      // The congregation's clerk holds groups.manage AT the congregation: not a presbytery, so forbidden there.
      const beforeC = await snapshot();
      expect(await store.createCommittee(ctxFor(clerkC, C), committeeIn())).toEqual({ kind: "refused", reason: "forbidden" });
      expect(await store.addCommitteeSeat(ctxFor(clerkC, C), committeeC, seatIn(congOnly))).toEqual({ kind: "refused", reason: "forbidden" });
      expect(await snapshot()).toEqual(beforeC);
    });

    it("a person who is not a member of the presbytery at all is refused by the organization context, writing nothing", async () => {
      const before = await snapshot();
      const r = await store.createCommittee(ctxFor(congOnly, P), committeeIn());
      expect(r).toEqual({ kind: "refused", reason: "forbidden" });
      expect(await snapshot()).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------
  describe("createCommittee", () => {
    it("writes a managed committee group and its label, and exactly one audit row with only ids and the kind", async () => {
      const before = await auditCount();
      const r = await store.createCommittee(
        clerkCtx(),
        committeeIn({ name: `Cmt90 ${stamp} Ministry`, kind: "required", purpose: "Oversight of ministry.", meetsWhen: "First Tuesdays" }),
      );
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      const id = r.data.id;

      expect(await groupOf(id)).toMatchObject({
        name: `Cmt90 ${stamp} Ministry`,
        description: "Oversight of ministry.",
        meets_when: "First Tuesdays",
        membership_source: "managed",
      });
      expect(await detailsOf(id)).toMatchObject({ kind: "required", dissolved_on: null });
      const type = await q(sql`select gt.key from groups g join group_types gt on gt.id = g.group_type_id where g.id = ${id}`);
      expect(type[0]).toEqual({ key: "committee" });

      const rows = await auditFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "tenant.committee.created", resource_type: "committee", resource_id: id });
      expect(rows[0]!.metadata).toEqual({ organizationId: P, committeeId: id, kind: "required" });
      expect(await auditCount()).toBe(before + 1);
    });

    it("a duplicate name is refused (case-insensitive, trimmed), naming the stored spelling, and writes nothing", async () => {
      const name = `Cmt90 ${stamp} Finance Committee`;
      await mkCommittee({ name });
      const before = await snapshot();
      for (const dup of [name, name.toLowerCase(), name.toUpperCase(), `  ${name}  `]) {
        const r = await store.createCommittee(clerkCtx(), committeeIn({ name: dup }));
        expect(r, dup).toEqual({ kind: "refused", reason: "duplicate_name", detail: { existingName: name } });
      }
      expect(await snapshot()).toEqual(before);
      expect(refusalMessage("duplicate_name", { existingName: name })).toBe(`A committee named "${name}" already exists. Choose a different name.`);
    });

    it("the same name is free at another presbytery, and a DISSOLVED committee's name is reusable", async () => {
      const name = `Cmt90 ${stamp} Reusable`;
      const first = await mkCommittee({ name });
      expect((await store.createCommittee(ctxFor(clerkP2, P2), committeeIn({ name }))).kind).toBe("ok");
      expect((await store.createCommittee(clerkCtx(), committeeIn({ name }))).kind).toBe("refused");
      expect((await store.dissolveCommittee(clerkCtx(), first, TODAY)).kind).toBe("ok");
      expect((await store.createCommittee(clerkCtx(), committeeIn({ name }))).kind).toBe("ok");
    });

    it("a choir, a derived group and a congregation's committee with the same name do not count as duplicates", async () => {
      const r = await store.createCommittee(clerkCtx(), committeeIn({ name: `Cmt90 ${stamp} Choir` }));
      expect(r.kind).toBe("ok");
    });
  });

  // ---------------------------------------------------------------------------
  describe("updateCommittee", () => {
    it("an edit of the group's own fields writes `committee.updated` with only the changed FIELD NAMES", async () => {
      const id = await mkCommittee({ kind: "standing" });
      const r = await store.updateCommittee(clerkCtx(), id, committeeIn({ name: `Cmt90 ${stamp} Renamed`, kind: "standing", purpose: "New purpose", meetsWhen: "Mondays" }));
      expect(r).toEqual({ kind: "ok", data: { id } });
      expect(await groupOf(id)).toMatchObject({ name: `Cmt90 ${stamp} Renamed`, description: "New purpose", meets_when: "Mondays" });
      const rows = await auditFor(id);
      expect(rows.map((x) => x.action)).toEqual(["tenant.committee.created", "tenant.committee.updated"]);
      expect(rows[1]!.metadata).toEqual({ organizationId: P, committeeId: id, changed: ["name", "purpose", "meetsWhen"] });
    });

    it("changing only the label writes `committee.labelled` with the previous kind, and no `updated`", async () => {
      const id = await mkCommittee({ kind: "ad_hoc" });
      const group = await groupOf(id);
      const r = await store.updateCommittee(clerkCtx(), id, committeeIn({ name: String(group.name), kind: "required" }));
      expect(r.kind).toBe("ok");
      expect(await detailsOf(id)).toMatchObject({ kind: "required" });
      const rows = (await auditFor(id)).slice(1);
      expect(rows.map((x) => x.action)).toEqual(["tenant.committee.labelled"]);
      expect(rows[0]!.metadata).toEqual({ organizationId: P, committeeId: id, kind: "required", previousKind: "ad_hoc" });
    });

    it("a save that changes both writes BOTH audit rows; an unlabelled legacy committee is labelled lazily (previousKind null)", async () => {
      const legacy = String(
        (
          await q(sql`insert into groups (organization_id, group_type_id, name)
                      values (${P}, (select id from group_types where key = 'committee'), ${`Cmt90 ${stamp} Legacy`}) returning id`)
        )[0]!.id,
      );
      expect(await detailsOf(legacy)).toBeUndefined();
      const r = await store.updateCommittee(clerkCtx(), legacy, committeeIn({ name: `Cmt90 ${stamp} Legacy`, kind: "standing", meetsWhen: "Quarterly" }));
      expect(r.kind).toBe("ok");
      expect(await detailsOf(legacy)).toMatchObject({ kind: "standing" });
      // Both rows are written in ONE transaction, so they share a created_at: assert the set, not an order.
      const rows = await auditFor(legacy);
      const byAction = new Map(rows.map((x) => [String(x.action), x]));
      expect([...byAction.keys()].sort()).toEqual(["tenant.committee.labelled", "tenant.committee.updated"]);
      expect(byAction.get("tenant.committee.updated")!.metadata).toEqual({ organizationId: P, committeeId: legacy, changed: ["meetsWhen"] });
      expect(byAction.get("tenant.committee.labelled")!.metadata).toEqual({ organizationId: P, committeeId: legacy, kind: "standing", previousKind: null });
    });

    it("an edit that changes nothing writes nothing and audits nothing (`unchanged`)", async () => {
      const id = await mkCommittee({ kind: "required", purpose: "Same", meetsWhen: "Same" });
      const g = await groupOf(id);
      const before = await snapshot();
      const r = await store.updateCommittee(clerkCtx(), id, committeeIn({ name: String(g.name), kind: "required", purpose: "Same", meetsWhen: "Same" }));
      expect(r).toEqual({ kind: "ok", data: { id, unchanged: true } });
      expect(await snapshot()).toEqual(before);
    });

    it("a rename to another committee's name is `duplicate_name`; to its own name in another case is allowed", async () => {
      const a = await mkCommittee({ name: `Cmt90 ${stamp} Alpha` });
      await mkCommittee({ name: `Cmt90 ${stamp} Beta` });
      const clash = await store.updateCommittee(clerkCtx(), a, committeeIn({ name: `cmt90 ${stamp} beta` }));
      expect(clash).toEqual({ kind: "refused", reason: "duplicate_name", detail: { existingName: `Cmt90 ${stamp} Beta` } });
      expect((await store.updateCommittee(clerkCtx(), a, committeeIn({ name: `CMT90 ${stamp} ALPHA` }))).kind).toBe("ok");
    });

    it("a dissolved committee is `committee_dissolved` for an edit, with the edit wording, and is unchanged", async () => {
      const id = await mkCommittee();
      await store.dissolveCommittee(clerkCtx(), id, TODAY);
      const before = await snapshot();
      const r = await store.updateCommittee(clerkCtx(), id, committeeIn({ name: "Zzz renamed", kind: "required" }));
      expect(r).toEqual({ kind: "refused", reason: "committee_dissolved", detail: { during: "edit" } });
      expect(await snapshot()).toEqual(before);
      expect(refusalMessage("committee_dissolved", { during: "edit" })).toMatch(/kept as history/);
    });
  });

  // ---------------------------------------------------------------------------
  describe("not_found is byte-identical for every wrong kind of target (DECISION-040)", () => {
    it("another presbytery's committee, a choir, a derived group, a congregation's committee and a nonexistent UUID give one answer, in every write", async () => {
      const own = await mkCommittee();
      const ownSeat = await mkSeat(own, people[0]!);
      const targets = {
        otherPresbytery: committeeP2,
        choir: choirP,
        derived: derivedP,
        congregationCommittee: committeeC,
        nonexistent: "00000000-0000-4000-8000-0000000000ff",
      };
      const before = await snapshot();
      const calls: Array<[string, (committee: string) => Promise<Outcome<unknown>>]> = [
        ["updateCommittee", (id) => store.updateCommittee(clerkCtx(), id, committeeIn({ name: "Renamed", kind: "required" }))],
        ["dissolveCommittee", (id) => store.dissolveCommittee(clerkCtx(), id, TODAY)],
        ["addCommitteeSeat", (id) => store.addCommitteeSeat(clerkCtx(), id, seatIn(people[1]!))],
        ["changeCommitteeSeatRole", (id) => store.changeCommitteeSeatRole(clerkCtx(), id, ownSeat, { expectedRole: "member", newRole: "clerk", effectiveOn: TODAY })],
        ["endCommitteeSeat", (id) => store.endCommitteeSeat(clerkCtx(), id, ownSeat, { endsOn: TODAY })],
        ["setCommitteeSeatPublicListed", (id) => store.setCommitteeSeatPublicListed(clerkCtx(), id, ownSeat, true)],
      ];
      for (const [name, call] of calls) {
        const answers = await Promise.all(Object.values(targets).map(async (id) => JSON.stringify(await call(id))));
        expect(new Set(answers).size, `${name}: ${answers.join(" | ")}`).toBe(1);
        expect(JSON.parse(answers[0]!)).toEqual({ kind: "refused", reason: "not_found" });
      }
      expect(await snapshot()).toEqual(before);
      expect(REFUSAL.not_found).toBe("That committee could not be found.");
    });

    it("a seat of ANOTHER committee, or another presbytery's seat, is `seat_not_found` (one answer, a different string from the committee's)", async () => {
      const a = await mkCommittee();
      const b = await mkCommittee();
      const seatOfB = await mkSeat(b, people[0]!);
      const seatP2 = await (async () => {
        const r = await store.addCommitteeSeat(ctxFor(clerkP2, P2), committeeP2, ok(parseSeat({ personId: clerkP2, role: "member", startsOn: shift(TODAY, -5), endsOn: "" }, ENV)));
        return r.kind === "ok" ? r.data.id : "";
      })();
      const answers = new Set<string>();
      for (const seat of [seatOfB, seatP2, "00000000-0000-4000-8000-0000000000fe"]) {
        for (const call of [
          () => store.changeCommitteeSeatRole(clerkCtx(), a, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: TODAY }),
          () => store.endCommitteeSeat(clerkCtx(), a, seat, { endsOn: TODAY }),
          () => store.setCommitteeSeatPublicListed(clerkCtx(), a, seat, true),
        ]) {
          answers.add(JSON.stringify(await call()));
        }
      }
      expect([...answers]).toEqual([JSON.stringify({ kind: "refused", reason: "seat_not_found" })]);
      expect(REFUSAL.seat_not_found).toBe("That member could not be found.");
      expect(REFUSAL.seat_not_found).not.toBe(REFUSAL.not_found);
    });
  });

  // ---------------------------------------------------------------------------
  describe("addCommitteeSeat", () => {
    it("writes a managed seat with the role and dates, and one audit row with only ids, role and dates (no roleIds when no role is carried)", async () => {
      const id = await mkCommittee();
      const r = await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!, "vice_chair", shift(TODAY, -10), shift(TODAY, 400)));
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      expect(await seatRow(r.data.id)).toMatchObject({
        group_role: "vice_chair",
        starts_on: shift(TODAY, -10),
        ends_on: shift(TODAY, 400),
        source: "managed",
        public_listed: false,
      });
      const rows = (await auditFor(id)).slice(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "tenant.committee.member_added", resource_type: "committee_member", resource_id: r.data.id });
      expect(rows[0]!.metadata).toEqual({
        organizationId: P,
        committeeId: id,
        membershipId: r.data.id,
        personId: people[0],
        role: "vice_chair",
        startsOn: shift(TODAY, -10),
        endsOn: shift(TODAY, 400),
        grantsRole: false,
      });
      expect(Object.keys(rows[0]!.metadata as object)).not.toContain("roleIds");
    });

    it("a committee that carries a role: the audit row says so and names the role ids", async () => {
      const id = await mkCommittee();
      const roleId = await fx.makeRole(P, `cmt90_carried_${stamp}_${counter}`, ["directory.view"]);
      await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on, granted_by)
                  values (${P}, ${roleId}, ${id}, '2020-01-01', ${fx.actingUserId})`);
      const r = await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!));
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      const rows = (await auditFor(id)).slice(1);
      expect(rows[0]!.metadata).toMatchObject({ grantsRole: true, roleIds: [roleId] });
    });

    it("`not_a_member`: a person whose membership ended, one who never belonged, one at another organization only, and a nonexistent id: one answer", async () => {
      const id = await mkCommittee();
      const before = await snapshot();
      const answers = new Set<string>();
      for (const personId of [gone, congOnly, "00000000-0000-4000-8000-0000000000fd"]) {
        answers.add(JSON.stringify(await store.addCommitteeSeat(clerkCtx(), id, seatIn(personId))));
      }
      expect([...answers]).toEqual([JSON.stringify({ kind: "refused", reason: "not_a_member" })]);
      expect(await snapshot()).toEqual(before);
    });

    it("a dissolved committee refuses an add, writing nothing", async () => {
      const id = await mkCommittee();
      await store.dissolveCommittee(clerkCtx(), id, TODAY);
      const before = await snapshot();
      expect(await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!))).toEqual({ kind: "refused", reason: "committee_dissolved" });
      expect(await snapshot()).toEqual(before);
    });

    it("interval overlap: the same dates overlap (naming the person and the committee), adjacent seats do not, a back-dated disjoint seat is accepted next to an open one", async () => {
      const id = await mkCommittee({ name: `Cmt90 ${stamp} Overlap Committee` });
      await mkSeat(id, people[0]!, "member", shift(TODAY, -100));
      const same = await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!, "clerk", shift(TODAY, -10)));
      expect(same).toMatchObject({ kind: "refused", reason: "overlap", detail: { committeeName: `Cmt90 ${stamp} Overlap Committee` } });
      expect((same as { detail: { personName: string } }).detail.personName).toContain("Avery");

      // Back-dated and ending BEFORE the open seat begins: disjoint, accepted.
      expect((await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!, "member", shift(TODAY, -300), shift(TODAY, -200)))).kind).toBe("ok");
      // Adjacent: [a, b) then [b, c).
      const adj = await mkCommittee();
      await mkSeat(adj, people[1]!, "member", shift(TODAY, -60), shift(TODAY, -30));
      expect((await store.addCommitteeSeat(clerkCtx(), adj, seatIn(people[1]!, "chair", shift(TODAY, -30)))).kind).toBe("ok");
      // And a second open seat for a person already serving is the overlap the old open-row check caught.
      expect((await store.addCommitteeSeat(clerkCtx(), adj, seatIn(people[1]!, "member", shift(TODAY, -5)))).kind).toBe("refused");
    });

    it("a zero-length seat is ignored by the overlap check, and co-chairs are allowed", async () => {
      const id = await mkCommittee();
      // A zero-length row (a cancelled planned term) served no day.
      await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on, ends_on)
                  values (${P}, ${id}, ${people[2]}, 'member', 'managed', ${shift(TODAY, -20)}, ${shift(TODAY, -20)})`);
      expect((await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[2]!, "member", shift(TODAY, -30)))).kind).toBe("ok");
      await mkSeat(id, people[3]!, "chair");
      expect((await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[4]!, "chair"))).kind).toBe("ok");
    });

    it("a seat that starts later is accepted and shows as planned; a planned end is stored", async () => {
      const id = await mkCommittee();
      const r = await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!, "member", shift(TODAY, 30), shift(TODAY, 365)));
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      expect(await seatRow(r.data.id)).toMatchObject({ starts_on: shift(TODAY, 30), ends_on: shift(TODAY, 365) });
    });
  });

  // ---------------------------------------------------------------------------
  describe("changeCommitteeSeatRole: one atomic act", () => {
    it("the old seat's ends_on and the new seat's starts_on are the SAME date; a planned end carries over; one audit row", async () => {
      const id = await mkCommittee();
      const effective = shift(TODAY, -3);
      const seat = await mkSeat(id, people[0]!, "member", shift(TODAY, -90), shift(TODAY, 200));
      const r = await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: effective });
      if (r.kind !== "ok") throw new Error(JSON.stringify(r));
      const newSeat = r.data.newMembershipId;

      expect(await seatRow(seat)).toMatchObject({ group_role: "member", starts_on: shift(TODAY, -90), ends_on: effective });
      expect(await seatRow(newSeat)).toMatchObject({ group_role: "clerk", starts_on: effective, ends_on: shift(TODAY, 200) });
      expect((await seatsOf(id)).filter((s) => s.person_id === people[0])).toHaveLength(2);

      const rows = (await auditFor(id)).slice(2);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "tenant.committee.member_role_changed", resource_type: "committee_member", resource_id: seat });
      expect(rows[0]!.metadata).toEqual({
        organizationId: P,
        committeeId: id,
        membershipId: seat,
        newMembershipId: newSeat,
        personId: people[0],
        fromRole: "member",
        toRole: "clerk",
        effectiveOn: effective,
        grantsRole: false,
        publicListed: false,
      });
    });

    it("the person holds exactly one role at the instants just before, at and after the effective date (no gap, no double)", async () => {
      const id = await mkCommittee();
      const effective = shift(TODAY, -5);
      const seat = await mkSeat(id, people[1]!, "member", shift(TODAY, -60));
      expect((await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "secretary", effectiveOn: effective })).kind).toBe("ok");
      for (const day of [shift(effective, -1), effective, shift(effective, 1), TODAY]) {
        expect(await holdsAt(id, people[1]!, day), day).toBe(1);
      }
      const roleOn = async (day: string) =>
        (await q(sql`select group_role from group_memberships where group_id = ${id} and person_id = ${people[1]} and starts_on <= ${day}::date and (ends_on is null or ends_on > ${day}::date)`))[0]!.group_role;
      expect(await roleOn(shift(effective, -1))).toBe("member");
      expect(await roleOn(effective)).toBe("secretary");
    });

    it("a failure AFTER both writes leaves neither: the old seat is still open and no new seat exists (one transaction)", async () => {
      const id = await mkCommittee();
      const seat = await mkSeat(id, people[2]!, "member", shift(TODAY, -40));
      const before = await snapshot();
      hooks.mode = "fail_after";
      const r = await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "chair", effectiveOn: shift(TODAY, -1) });
      expect(r).toEqual({ kind: "refused", reason: "save_failed" });
      hooks.mode = "ok";
      expect((await seatRow(seat)).ends_on).toBeNull();
      expect(await seatsOf(id)).toHaveLength(1);
      expect(await snapshot()).toEqual(before);
    });

    it("a stale form (the role is no longer the one it was opened on) is `stale`; the same role is `same_role`; an ended seat is `already_ended`", async () => {
      const id = await mkCommittee();
      const seat = await mkSeat(id, people[3]!, "member", shift(TODAY, -40));
      const before = await snapshot();
      expect(await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "clerk", newRole: "chair", effectiveOn: TODAY })).toEqual({ kind: "refused", reason: "stale" });
      expect(await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "member", effectiveOn: TODAY })).toEqual({ kind: "refused", reason: "same_role" });
      expect(await snapshot()).toEqual(before);

      await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: shift(TODAY, -1) });
      expect(await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "chair", effectiveOn: TODAY })).toEqual({ kind: "refused", reason: "already_ended" });
    });

    it("a legacy `leader` row is changeable (to one of the six)", async () => {
      const id = await mkCommittee();
      const legacy = String(
        (
          await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
                      values (${P}, ${id}, ${people[4]}, 'leader', 'managed', ${shift(TODAY, -100)}) returning id`)
        )[0]!.id,
      );
      const r = await store.changeCommitteeSeatRole(clerkCtx(), id, legacy, { expectedRole: "leader", newRole: "chair", effectiveOn: shift(TODAY, -2) });
      expect(r.kind).toBe("ok");
      expect((await auditFor(id)).at(-1)!.metadata).toMatchObject({ fromRole: "leader", toRole: "chair" });
    });

    it("the effective date may equal the seat's start (a same-day correction leaves a zero-length old row) but not precede it, and must precede a planned end", async () => {
      const id = await mkCommittee();
      const start = shift(TODAY, -20);
      const seat = await mkSeat(id, people[5]!, "member", start, shift(TODAY, 100));
      const early = await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: shift(start, -1) });
      expect(early).toEqual({ kind: "invalid", field: "effectiveOn", message: VALIDATION.effectiveBeforeStart(start) });
      const late = await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: shift(TODAY, 100) });
      expect(late).toEqual({ kind: "invalid", field: "effectiveOn", message: VALIDATION.effectiveNotBeforeEnd(shift(TODAY, 100)) });
      const same = await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: start });
      if (same.kind !== "ok") throw new Error(JSON.stringify(same));
      expect(await seatRow(seat)).toMatchObject({ starts_on: start, ends_on: start }); // zero-length: it served no day
      expect((await seatRow(same.data.newMembershipId)).starts_on).toBe(start);
    });

    it("a role change that would meet the same person's OTHER later seat is `overlap`", async () => {
      const id = await mkCommittee();
      const seat = await mkSeat(id, people[6]!, "member", shift(TODAY, -50), shift(TODAY, 10));
      await mkSeat(id, people[6]!, "member", shift(TODAY, 10)); // adjacent later seat: starts the day the first ends
      // The change keeps the planned end (day 10), so [effective, 10) is still clear of the later seat.
      expect((await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: shift(TODAY, -1) })).kind).toBe("ok");
      // An OPEN seat that a later seat would sit under: the second change overlaps it.
      const id2 = await mkCommittee();
      const open = await mkSeat(id2, people[7]!, "member", shift(TODAY, -50));
      await q(sql`insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on, ends_on)
                  values (${P}, ${id2}, ${people[7]}, 'member', 'managed', ${shift(TODAY, 5)}, ${shift(TODAY, 50)})`);
      const r = await store.changeCommitteeSeatRole(clerkCtx(), id2, open, { expectedRole: "member", newRole: "clerk", effectiveOn: TODAY });
      expect(r).toMatchObject({ kind: "refused", reason: "overlap" });
      expect((await seatRow(open)).ends_on).toBeNull();
    });

    it("the public listing is CARRIED to the new row (listed stays listed, attributed to the actor); an unlisted seat stays unlisted", async () => {
      const id = await mkCommittee();
      const listed = await mkSeat(id, people[0]!, "member", shift(TODAY, -40));
      const unlisted = await mkSeat(id, people[1]!, "member", shift(TODAY, -40));
      expect((await store.setCommitteeSeatPublicListed(clerkCtx(), id, listed, true)).kind).toBe("ok");

      const a = await store.changeCommitteeSeatRole(clerkCtx(), id, listed, { expectedRole: "member", newRole: "chair", effectiveOn: shift(TODAY, -2) });
      const b = await store.changeCommitteeSeatRole(clerkCtx(), id, unlisted, { expectedRole: "member", newRole: "chair", effectiveOn: shift(TODAY, -2) });
      if (a.kind !== "ok" || b.kind !== "ok") throw new Error("role changes refused");
      expect(await seatRow(a.data.newMembershipId)).toMatchObject({ group_role: "chair", public_listed: true, public_listed_by: fx.actingUserId });
      expect(await seatRow(b.data.newMembershipId)).toMatchObject({ group_role: "chair", public_listed: false });
      const audit = (await auditFor(id)).filter((r) => r.action === "tenant.committee.member_role_changed");
      expect(audit.map((r) => (r.metadata as { publicListed: boolean }).publicListed).sort()).toEqual([false, true]);
    });

    it("a committee that carries a role: the change's audit row says `grantsRole`", async () => {
      const id = await mkCommittee();
      const roleId = await fx.makeRole(P, `cmt90_chg_${stamp}_${counter}`, ["directory.view"]);
      await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on, granted_by) values (${P}, ${roleId}, ${id}, '2020-01-01', ${fx.actingUserId})`);
      const seat = await mkSeat(id, people[0]!, "member", shift(TODAY, -40));
      await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: shift(TODAY, -1) });
      expect((await auditFor(id)).at(-1)!.metadata).toMatchObject({ grantsRole: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("endCommitteeSeat", () => {
    it("ends a serving term on the given date (half-open: ends_on is the first day it no longer applies) with one audit row", async () => {
      const id = await mkCommittee();
      const seat = await mkSeat(id, people[0]!, "clerk", shift(TODAY, -60));
      const r = await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: shift(TODAY, -1) });
      expect(r).toEqual({ kind: "ok", data: { id: seat, cancelled: false } });
      expect((await seatRow(seat)).ends_on).toBe(shift(TODAY, -1));
      const rows = (await auditFor(id)).slice(2);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toEqual({
        organizationId: P,
        committeeId: id,
        membershipId: seat,
        personId: people[0],
        role: "clerk",
        endsOn: shift(TODAY, -1),
        cancelled: false,
      });
    });

    it("moves a planned end (change end date); the same date again changes nothing and audits nothing", async () => {
      const id = await mkCommittee();
      const seat = await mkSeat(id, people[1]!, "member", shift(TODAY, -60), shift(TODAY, 100));
      expect((await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: shift(TODAY, 50) })).kind).toBe("ok");
      expect((await seatRow(seat)).ends_on).toBe(shift(TODAY, 50));
      const before = await snapshot();
      expect(await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: shift(TODAY, 50) })).toEqual({ kind: "ok", data: { id: seat, cancelled: false, unchanged: true } });
      expect(await snapshot()).toEqual(before);
    });

    it("a seat that has not started is ended AT ITS OWN START whatever the date field says (cancel planned term), zero-length and kept", async () => {
      const id = await mkCommittee();
      const start = shift(TODAY, 20);
      const seat = await mkSeat(id, people[2]!, "member", start);
      const r = await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: null });
      expect(r).toEqual({ kind: "ok", data: { id: seat, cancelled: true } });
      expect(await seatRow(seat)).toMatchObject({ starts_on: start, ends_on: start });
      expect((await auditFor(id)).at(-1)!.metadata).toMatchObject({ cancelled: true, endsOn: start });
      expect(await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: null })).toEqual({ kind: "refused", reason: "already_ended" });
    });

    it("refuses an ended seat (`already_ended`), a blank date on a serving seat, a date before the start and one more than ten years ahead", async () => {
      const id = await mkCommittee();
      const seat = await mkSeat(id, people[3]!, "member", shift(TODAY, -30));
      const before = await snapshot();
      expect(await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: null })).toEqual({ kind: "invalid", field: "endsOn", message: VALIDATION.dateInvalid });
      expect(await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: shift(TODAY, -31) })).toEqual({ kind: "invalid", field: "endsOn", message: VALIDATION.endBeforeStart });
      expect(await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: shift(addYears(TODAY, 10), 1) })).toEqual({ kind: "invalid", field: "endsOn", message: VALIDATION.endTooFar });
      expect(await snapshot()).toEqual(before);

      await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: TODAY });
      expect(await store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: TODAY })).toEqual({ kind: "refused", reason: "already_ended" });
    });
  });

  // ---------------------------------------------------------------------------
  describe("setCommitteeSeatPublicListed", () => {
    it("lists a serving seat and audits `member_listed` in the transaction; again is unchanged; unlisting audits `member_unlisted`", async () => {
      const id = await mkCommittee();
      const seat = await mkSeat(id, people[0]!, "member", shift(TODAY, -30));
      const on = await store.setCommitteeSeatPublicListed(clerkCtx(), id, seat, true);
      expect(on).toEqual({ kind: "ok", data: { id: seat, publicListed: true } });
      expect(await seatRow(seat)).toMatchObject({ public_listed: true, public_listed_by: fx.actingUserId });

      const before = await snapshot();
      expect(await store.setCommitteeSeatPublicListed(clerkCtx(), id, seat, true)).toEqual({ kind: "ok", data: { id: seat, publicListed: true, unchanged: true } });
      expect(await snapshot()).toEqual(before);

      expect((await store.setCommitteeSeatPublicListed(clerkCtx(), id, seat, false)).kind).toBe("ok");
      const rows = (await auditFor(id)).slice(2);
      expect(rows.map((r) => r.action)).toEqual(["tenant.committee.member_listed", "tenant.committee.member_unlisted"]);
      for (const row of rows) {
        expect(row).toMatchObject({ resource_type: "committee_member", resource_id: seat });
        expect(row.metadata).toEqual({ organizationId: P, committeeId: id, membershipId: seat, personId: people[0] });
      }
    });

    it("only a seat serving now can be listed: a planned or an ended seat is `seat_not_found`", async () => {
      const id = await mkCommittee();
      const planned = await mkSeat(id, people[1]!, "member", shift(TODAY, 10));
      const ended = await mkSeat(id, people[2]!, "member", shift(TODAY, -30), shift(TODAY, -5));
      const before = await snapshot();
      for (const seat of [planned, ended]) {
        expect(await store.setCommitteeSeatPublicListed(clerkCtx(), id, seat, true)).toEqual({ kind: "refused", reason: "seat_not_found" });
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------
  describe("dissolveCommittee", () => {
    it("ends every seat: open and planned-end seats at the date, a not-yet-started seat zero-length at its own start, a past seat untouched; no seat left open", async () => {
      const id = await mkCommittee({ kind: "ad_hoc" });
      const date = shift(TODAY, -2);
      const open = await mkSeat(id, people[0]!, "chair", shift(TODAY, -100));
      const plannedEnd = await mkSeat(id, people[1]!, "member", shift(TODAY, -100), shift(TODAY, 300));
      const later = await mkSeat(id, people[2]!, "member", shift(TODAY, 40), shift(TODAY, 90));
      const past = await mkSeat(id, people[3]!, "member", shift(TODAY, -200), shift(TODAY, -150));
      const r = await store.dissolveCommittee(clerkCtx(), id, date);
      expect(r).toEqual({ kind: "ok", data: { id, seatsEnded: 3 } });

      expect((await seatRow(open)).ends_on).toBe(date);
      expect((await seatRow(plannedEnd)).ends_on).toBe(date);
      expect(await seatRow(later)).toMatchObject({ starts_on: shift(TODAY, 40), ends_on: shift(TODAY, 40) });
      expect((await seatRow(past)).ends_on).toBe(shift(TODAY, -150));
      expect(Number((await q(sql`select count(*)::int as n from group_memberships where group_id = ${id} and ends_on is null`))[0]!.n)).toBe(0);
      expect(await detailsOf(id)).toMatchObject({ kind: "ad_hoc", dissolved_on: date, dissolved_by: fx.actingUserId });

      const rows = (await auditFor(id)).filter((x) => x.action === "tenant.committee.dissolved");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toEqual({ organizationId: P, committeeId: id, dissolvedOn: date, seatsEnded: 3, carriesRole: false });
      expect(await store.addCommitteeSeat(clerkCtx(), id, seatIn(people[4]!))).toEqual({ kind: "refused", reason: "committee_dissolved" });
    });

    it("a committee never labelled (no details row) dissolves: the row is created and dissolved; a second dissolve is `already_dissolved`", async () => {
      const legacy = String(
        (
          await q(sql`insert into groups (organization_id, group_type_id, name)
                      values (${P}, (select id from group_types where key = 'committee'), ${`Cmt90 ${stamp} Unlabelled`}) returning id`)
        )[0]!.id,
      );
      expect((await store.dissolveCommittee(clerkCtx(), legacy, TODAY)).kind).toBe("ok");
      expect(await detailsOf(legacy)).toMatchObject({ kind: null, dissolved_on: TODAY });
      expect(await store.dissolveCommittee(clerkCtx(), legacy, TODAY)).toEqual({ kind: "refused", reason: "already_dissolved" });
    });

    it("refuses a future date (against the organization's own day) and a date before the start of a seat that has begun, naming that date; writes nothing", async () => {
      const id = await mkCommittee();
      await mkSeat(id, people[0]!, "member", shift(TODAY, -10));
      const before = await snapshot();
      expect(await store.dissolveCommittee(clerkCtx(), id, shift(TODAY, 1))).toEqual({ kind: "invalid", field: "dissolvedOn", message: VALIDATION.dissolveFuture });
      expect(await store.dissolveCommittee(clerkCtx(), id, shift(TODAY, -11))).toEqual({ kind: "refused", reason: "date_before_start", detail: { date: shift(TODAY, -10) } });
      expect(await snapshot()).toEqual(before);
      expect(refusalMessage("date_before_start", { date: shift(TODAY, -10) })).toMatch(/A member started on .*\. The dissolve date can't be before that\./);
      // The day a seat began is allowed (a one-day-old committee dissolved at once).
      expect((await store.dissolveCommittee(clerkCtx(), id, shift(TODAY, -10))).kind).toBe("ok");
    });

    it("a committee that carries a role: the audit row says `carriesRole`", async () => {
      const id = await mkCommittee();
      const roleId = await fx.makeRole(P, `cmt90_dis_${stamp}_${counter}`, ["directory.view"]);
      await q(sql`insert into role_grants (organization_id, role_id, group_id, starts_on, granted_by) values (${P}, ${roleId}, ${id}, '2020-01-01', ${fx.actingUserId})`);
      await store.dissolveCommittee(clerkCtx(), id, TODAY);
      expect((await auditFor(id)).at(-1)!.metadata).toMatchObject({ carriesRole: true, seatsEnded: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  describe("the audit is in the SAME transaction (the two sabotages)", () => {
    type Write = [string, () => Promise<{ kind: string }>];
    async function setup() {
      const id = await mkCommittee({ kind: "standing" });
      const g = await groupOf(id);
      // One seat per write, so each can succeed on its own when the audit works.
      const toChange = await mkSeat(id, people[0]!, "member", shift(TODAY, -40));
      const toEnd = await mkSeat(id, people[1]!, "member", shift(TODAY, -40));
      const toList = await mkSeat(id, people[3]!, "member", shift(TODAY, -40));
      const planned = await mkSeat(id, people[4]!, "member", shift(TODAY, 15));
      const writes: Write[] = [
        ["createCommittee", () => store.createCommittee(clerkCtx(), committeeIn())],
        ["updateCommittee", () => store.updateCommittee(clerkCtx(), id, committeeIn({ name: String(g.name), kind: "required", purpose: "changed" }))],
        ["addCommitteeSeat", () => store.addCommitteeSeat(clerkCtx(), id, seatIn(people[2]!))],
        ["changeCommitteeSeatRole", () => store.changeCommitteeSeatRole(clerkCtx(), id, toChange, { expectedRole: "member", newRole: "chair", effectiveOn: TODAY })],
        ["endCommitteeSeat", () => store.endCommitteeSeat(clerkCtx(), id, toEnd, { endsOn: TODAY })],
        ["endCommitteeSeat (cancel)", () => store.endCommitteeSeat(clerkCtx(), id, planned, { endsOn: null })],
        ["setCommitteeSeatPublicListed", () => store.setCommitteeSeatPublicListed(clerkCtx(), id, toList, true)],
        // Last: a dissolved committee refuses everything after it.
        ["dissolveCommittee", () => store.dissolveCommittee(clerkCtx(), id, TODAY)],
      ];
      return writes;
    }

    it.each(["fail_before", "fail_after"] as const)(
      "%s: every write leaves the data and the audit table exactly as they were, and the caller is told `save_failed`",
      async (mode) => {
        const writes = await setup();
        const before = await snapshot();
        for (const [name, write] of writes) {
          hooks.mode = mode;
          const r = await write();
          hooks.mode = "ok";
          expect(r, name).toEqual({ kind: "refused", reason: "save_failed" });
          expect(await snapshot(), name).toEqual(before);
        }
      },
    );

    it("and with the audit working each of those writes does change the data (the sabotages above are not passing vacuously)", async () => {
      const writes = await setup();
      for (const [name, write] of writes) {
        const before = await snapshot();
        const r = await write();
        expect(r.kind, name).toBe("ok");
        expect(await snapshot(), name).not.toEqual(before);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe("no audit row carries a name or free text", () => {
    it("sentinel strings in the name, purpose and meets-when appear in no audit row of any committee write", async () => {
      const SENT = ["ZQ-NAME-SENTINEL", "ZQ-PURPOSE-SENTINEL", "ZQ-MEETS-SENTINEL"];
      const id = await mkCommittee({ name: `Cmt90 ${SENT[0]} ${stamp}`, purpose: SENT[1]!, meetsWhen: SENT[2]!, kind: "required" });
      const seat = await mkSeat(id, people[0]!, "member", shift(TODAY, -30));
      await store.updateCommittee(clerkCtx(), id, committeeIn({ name: `Cmt90 ${SENT[0]} ${stamp} v2`, purpose: `${SENT[1]} 2`, meetsWhen: `${SENT[2]} 2`, kind: "standing" }));
      await store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: shift(TODAY, -1) });
      await store.setCommitteeSeatPublicListed(clerkCtx(), id, seat, true).catch(() => undefined);
      await store.dissolveCommittee(clerkCtx(), id, TODAY);

      const rows = await auditFor(id);
      expect(rows.length).toBeGreaterThanOrEqual(5);
      const text = JSON.stringify(rows);
      for (const s of SENT) expect(text).not.toContain(s);
      // Nor a person's name.
      expect(text).not.toMatch(/Avery|Seat0/);
    });
  });

  // ---------------------------------------------------------------------------
  describe("concurrency", () => {
    it("two simultaneous creates of one name end with ONE group and one `duplicate_name`", async () => {
      for (let i = 0; i < 3; i += 1) {
        const name = `Cmt90 ${stamp} Race create ${i}`;
        const results = await Promise.all([store.createCommittee(clerkCtx(), committeeIn({ name })), store.createCommittee(clerkCtx(), committeeIn({ name }))]);
        expect(results.map((r) => r.kind === "ok" || (r as { reason?: string }).reason).sort(), name).toEqual(["duplicate_name", true]);
        const n = Number((await q(sql`select count(*)::int as n from groups where organization_id = ${P} and name = ${name}`))[0]!.n);
        expect(n, name).toBe(1);
      }
    });

    it("two simultaneous adds of one person end with ONE seat and one `overlap`", async () => {
      for (let i = 0; i < 3; i += 1) {
        const id = await mkCommittee();
        const results = await Promise.all([
          store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!, "member", shift(TODAY, -5))),
          store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!, "clerk", shift(TODAY, -5))),
        ]);
        expect(results.map((r) => (r.kind === "ok" ? "ok" : (r as { reason: string }).reason)).sort()).toEqual(["ok", "overlap"]);
        expect(await seatsOf(id)).toHaveLength(1);
      }
    });

    it("a dissolve racing an add leaves NO open seat on a dissolved committee", async () => {
      for (let i = 0; i < 6; i += 1) {
        const id = await mkCommittee();
        await mkSeat(id, people[1]!, "member", shift(TODAY, -30));
        const [dissolved, added] = await Promise.all([
          store.dissolveCommittee(clerkCtx(), id, TODAY),
          store.addCommitteeSeat(clerkCtx(), id, seatIn(people[0]!, "member", shift(TODAY, -3))),
        ]);
        expect(dissolved.kind, `iteration ${i}`).toBe("ok");
        expect(["ok", "refused"]).toContain(added.kind);
        const open = Number((await q(sql`select count(*)::int as n from group_memberships where group_id = ${id} and (ends_on is null or ends_on > ${TODAY}::date)`))[0]!.n);
        expect(open, `iteration ${i}: ${JSON.stringify(added)}`).toBe(0);
        expect(await detailsOf(id)).toMatchObject({ dissolved_on: TODAY });
      }
    });

    it("a role change racing an end term ends consistent: the person never holds two roles at once, and the seat is ended or changed, not both half-done", async () => {
      for (let i = 0; i < 6; i += 1) {
        const id = await mkCommittee();
        const seat = await mkSeat(id, people[2]!, "member", shift(TODAY, -30));
        const [changed, ended] = await Promise.all([
          store.changeCommitteeSeatRole(clerkCtx(), id, seat, { expectedRole: "member", newRole: "clerk", effectiveOn: shift(TODAY, -1) }),
          store.endCommitteeSeat(clerkCtx(), id, seat, { endsOn: shift(TODAY, -1) }),
        ]);
        const kinds = [changed.kind, ended.kind];
        expect(kinds.includes("ok"), `iteration ${i}: ${JSON.stringify([changed, ended])}`).toBe(true);
        for (const day of [shift(TODAY, -2), shift(TODAY, -1), TODAY]) {
          expect(await holdsAt(id, people[2]!, day), `iteration ${i} ${day}`).toBeLessThanOrEqual(1);
        }
        const rows = await seatsOf(id);
        // The old seat is always ended; if the change won there is exactly one new open seat, otherwise none.
        expect(rows.find((r) => r.id === seat)!.ends_on).toBe(shift(TODAY, -1));
        expect(rows.filter((r) => r.ends_on === null).length).toBe(changed.kind === "ok" ? 1 : 0);
      }
    });
  });

  // ===========================================================================
  // INCREMENT 2: commission records
  // ===========================================================================
  describe("commission records (Increment 2)", () => {
    let CG1: string; // a member congregation of P
    let CG2: string; // another member congregation of P
    let CGX: string; // a member congregation of the OTHER presbytery
    let CGN: string; // a congregation that never belonged to anyone
    let CGCLOSING: string; // a member congregation of P whose lifecycle is no longer active
    let CGDEPART: string; // a congregation that left P for the other presbytery
    let CGNWC: string; // a new worshiping community under P: a non-congregation child
    let stranger: string; // a person with no membership anywhere
    let commissionP2: string; // a commission record at the other presbytery
    const made: string[] = [];

    async function affiliate(subject: string, parent: string, type = "member_congregation") {
      await q(sql`
        insert into organization_affiliations
          (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
        values (${parent}, ${subject}, ${parent}, ${type}, '2000-01-01', 'recorded',
                'Fixture affiliation for the commission records of store.db.test.ts')`);
    }
    async function depart(subject: string, from: string, to: string) {
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select set_config('presby.affiliation_trigger_active', 'true', true)`);
        await tx.execute(sql`
          update organization_affiliations
             set effective_to = '2024-01-01', closed_by_org_id = ${from}, closed_on = '2024-01-01',
                 closed_minute_reference = 'Fixture departure for the commission records of store.db.test.ts'
           where subject_org_id = ${subject} and effective_to is null`);
        await tx.execute(sql`
          insert into organization_affiliations
            (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
          values (${to}, ${subject}, ${to}, 'member_congregation', '2024-01-01', 'recorded', 'Fixture arrival for the commission records of store.db.test.ts')`);
      });
    }
    async function cong(label: string, parent: string | null, type = "congregation", relationship = "member_congregation"): Promise<string> {
      const id = await fx.makeOrg(`${label}${(counter += 1)}`, { organizationType: type as never });
      made.push(id);
      if (parent) await affiliate(id, parent, relationship);
      return id;
    }

    beforeAll(async () => {
      CG1 = await cong("CmCong1", P);
      CG2 = await cong("CmCong2", P);
      CGX = await cong("CmCongX", P2);
      CGN = await cong("CmCongNever", null);
      CGCLOSING = await cong("CmCongClosing", P);
      await q(sql`update organizations set lifecycle_status = 'dissolved' where id = ${CGCLOSING}`);
      CGDEPART = await cong("CmCongDeparted", P);
      await depart(CGDEPART, P, P2);
      CGNWC = await cong("CmNwc", P, "new_worshiping_community", "member_nwc");
      stranger = await fx.makePerson("Stranger", `Nowhere${stamp}`);
      const r = await store.recordCommission(ctxFor(clerkP2, P2), commissionIn({ title: `Cm90 ${stamp} other presbytery` }));
      if (r.kind !== "ok") throw new Error(`the other presbytery's commission did not record: ${JSON.stringify(r)}`);
      commissionP2 = r.data.id;
    });

    afterAll(async () => {
      if (!fx) return;
      // about_org_id is NO ACTION: the record rows go before the congregations they name; cleanup() then takes the presbyteries.
      await q(sql`delete from commission_record_members where organization_id in (${P}, ${P2})`);
      await q(sql`delete from commission_records where organization_id in (${P}, ${P2})`);
      await q(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
      try {
        for (const id of made) await q(sql`delete from organizations where id = ${id}`);
      } finally {
        await q(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
      }
    });

    // --- helpers ----------------------------------------------------------
    const commissionIn = (over: Partial<CommissionValues> = {}) =>
      ok(
        parseCommission(
          {
            title: `Cm90 ${stamp} ${(counter += 1)}`,
            charge: "",
            aboutOrgId: "",
            appointedOn: shift(TODAY, -60),
            minuteReference: "",
            ...over,
          },
          ENV,
        ),
      );
    const memberIn = (personId: string, role = "member", startsOn = shift(TODAY, -30), endsOn = "") =>
      ok(parseCommissionMember({ personId, role, startsOn, endsOn } satisfies SeatValues, ENV));
    const endIn = (endedOn = TODAY, endedMinuteReference = "") => ok(parseEndCommission({ endedOn, endedMinuteReference }, ENV));

    async function mkCommission(over: Partial<CommissionValues> = {}): Promise<string> {
      const r = await store.recordCommission(clerkCtx(), commissionIn(over));
      if (r.kind !== "ok") throw new Error(`recordCommission fixture refused: ${JSON.stringify(r)}`);
      return r.data.id;
    }
    async function mkMember(commissionId: string, personId: string, role = "member", startsOn = shift(TODAY, -30), endsOn = ""): Promise<string> {
      const r = await store.addCommissionMember(clerkCtx(), commissionId, memberIn(personId, role, startsOn, endsOn));
      if (r.kind !== "ok") throw new Error(`addCommissionMember fixture refused: ${JSON.stringify(r)}`);
      return r.data.id;
    }
    const recordRow = async (id: string): Promise<Row> => {
      const rows = await q(sql`select title, charge, about_org_id, appointed_on::text as appointed_on, minute_reference, ended_on::text as ended_on,
                                      ended_minute_reference, ended_by, removed_at, removed_by, row_version, created_by, updated_by
                                 from commission_records where id = ${id}`);
      expect(rows, `commission ${id}`).toHaveLength(1);
      return rows[0]!;
    };
    const membersOf = (commissionId: string) =>
      q(sql`select id, person_id, role, starts_on::text as starts_on, ends_on::text as ends_on from commission_record_members
             where commission_record_id = ${commissionId} order by starts_on, id`);
    const commissionAudit = (commissionId: string) =>
      q(sql`select action, resource_type, resource_id, actor_user_id, metadata from audit_events
             where action like 'tenant.commission_record.%' and metadata->>'commissionId' = ${commissionId} order by created_at, id`);
    const commissionAuditCount = async () =>
      Number((await q(sql`select count(*)::int as n from audit_events where action like 'tenant.commission_record.%' and metadata->>'organizationId' in (${P}, ${P2})`))[0]!.n);

    /** Everything the commission writes touch at both presbyteries, plus their audit rows. */
    async function csnapshot(): Promise<unknown> {
      const tables: Row[] = [];
      for (const t of ["commission_records", "commission_record_members"] as const) {
        tables.push(
          ...(await q(
            sql`select ${t}::text as t, count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x.id)), '') as h
                  from ${sql.identifier(t)} x where x.organization_id in (${P}, ${P2})`,
          )),
        );
      }
      return { tables, audit: await commissionAuditCount() };
    }
    /** The downward tables, the role grants and every group row: a commission record writes none of them. */
    async function downward(): Promise<{ downward: unknown; groups: unknown }> {
      return {
        downward: await q(sql`select (select count(*) from administrative_commissions)::int as admin, (select count(*) from org_delegations)::int as deleg, (select count(*) from role_grants)::int as grants`),
        groups: await snapshot(),
      };
    }
    // Orchestrator ruling 1: a commission miss is `not_found` worded for a commission, one answer for every miss.
    const never = { kind: "refused", reason: "not_found", detail: { subject: "commission" } } as const;

    // --- the six writes -----------------------------------------------------
    describe("a missing key, or an organization that is not a presbytery, writes nothing and audits nothing", () => {
      it("every commission write refuses `forbidden` for a member with no key, and for a clerk of a congregation", async () => {
        const id = await mkCommission();
        const member = await mkMember(id, people[0]!);
        const before = await csnapshot();
        const calls: Array<[string, (c: CommitteesCtx) => Promise<{ kind: string }>]> = [
          ["recordCommission", (c) => store.recordCommission(c, commissionIn())],
          ["updateCommission", (c) => store.updateCommission(c, id, commissionIn(), 1)],
          ["addCommissionMember", (c) => store.addCommissionMember(c, id, memberIn(people[1]!))],
          ["endCommissionMember", (c) => store.endCommissionMember(c, id, member, { endsOn: TODAY })],
          ["endCommission", (c) => store.endCommission(c, id, endIn())],
          ["removeCommissionRecord", (c) => store.removeCommissionRecord(c, id)],
        ];
        for (const [name, call] of calls) {
          expect(await call(ctxFor(keyless)), `${name} (no key)`).toEqual({ kind: "refused", reason: "forbidden" });
        }
        expect(await csnapshot()).toEqual(before);
        // groups.manage AT a congregation is not a presbytery
        expect(await store.recordCommission(ctxFor(clerkC, C), commissionIn())).toEqual({ kind: "refused", reason: "forbidden" });
        expect(await csnapshot()).toEqual(before);
      });
    });

    describe("recordCommission", () => {
      it("writes the record and exactly one audit row with ONLY ids (no title, charge or minute), and writes no group, role or downward-table row", async () => {
        const before = await downward();
        const auditBefore = await commissionAuditCount();
        const r = await store.recordCommission(
          clerkCtx(),
          commissionIn({
            title: `Cm90 ${stamp} Commission on Alder Creek`,
            charge: "To review the session's records in general terms.",
            aboutOrgId: CG1,
            minuteReference: "2026-05-12, item 7",
          }),
        );
        if (r.kind !== "ok") throw new Error(JSON.stringify(r));
        const id = r.data.id;

        expect(await recordRow(id)).toMatchObject({
          title: `Cm90 ${stamp} Commission on Alder Creek`,
          charge: "To review the session's records in general terms.",
          about_org_id: CG1,
          minute_reference: "2026-05-12, item 7",
          ended_on: null,
          removed_at: null,
          row_version: 1,
          created_by: fx.actingUserId,
          updated_by: fx.actingUserId,
        });
        const rows = await commissionAudit(id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: "tenant.commission_record.recorded", resource_type: "commission_record", resource_id: id, actor_user_id: fx.actingUserId });
        expect(rows[0]!.metadata).toEqual({ organizationId: P, commissionId: id, aboutOrgId: CG1 });
        expect(await commissionAuditCount()).toBe(auditBefore + 1);
        // the hard rule: no group, no role grant, no downward row was written
        const after = await downward();
        expect(after.downward).toEqual(before.downward);
        expect(after.groups).toEqual(before.groups);
      });

      it("the appointment may not be after today in the ORGANIZATION'S day (orchestrator ruling 3): refused with the ruled sentence on a hand-built input, writing nothing; today is allowed", async () => {
        const before = await csnapshot();
        const tomorrow = { ...commissionIn(), appointedOn: shift(TODAY, 1) };
        expect(await store.recordCommission(clerkCtx(), tomorrow)).toEqual({
          kind: "invalid",
          field: "appointedOn",
          message: "The appointed date can't be after today.",
        });
        expect(await csnapshot()).toEqual(before);
        expect((await store.recordCommission(clerkCtx(), { ...commissionIn(), appointedOn: TODAY })).kind).toBe("ok");
      });

      it("a record about no congregation has a null congregation and audits `aboutOrgId: null`", async () => {
        const id = await mkCommission();
        expect((await recordRow(id)).about_org_id).toBeNull();
        expect((await commissionAudit(id))[0]!.metadata).toEqual({ organizationId: P, commissionId: id, aboutOrgId: null });
      });

      it("a CLOSING congregation (still this presbytery's, lifecycle no longer active) is accepted", async () => {
        const id = await mkCommission({ aboutOrgId: CGCLOSING });
        expect((await recordRow(id)).about_org_id).toBe(CGCLOSING);
      });

      it("a congregation id in upper case is stored and audited in its canonical (lower-case) form", async () => {
        const id = await mkCommission({ aboutOrgId: CG2.toUpperCase() });
        expect((await recordRow(id)).about_org_id).toBe(CG2);
        expect((await commissionAudit(id))[0]!.metadata).toMatchObject({ aboutOrgId: CG2 });
      });
    });

    describe("the congregation resolver: every miss is ONE byte-identical answer (DECISION-040)", () => {
      it("another presbytery's congregation, a non-congregation child, a departed congregation, the presbytery itself, a nonexistent id and a malformed one all read the same, and write nothing", async () => {
        const misses: Array<[string, string]> = [
          ["another presbytery's congregation", CGX],
          ["a new worshiping community under this presbytery (a non-congregation)", CGNWC],
          ["a congregation that left", CGDEPART],
          ["a congregation that never belonged to anyone", CGN],
          ["the presbytery itself", P],
          ["the other presbytery", P2],
          ["a nonexistent id", "00000000-0000-4090-8000-00000000ffff"],
          ["a malformed id", "not-a-uuid"],
          ["a truncated id", "00000000-0000-4090-8000-00000000fff"],
        ];
        const before = await csnapshot();
        const results = new Map<string, unknown>();
        for (const [label, id] of misses) results.set(label, await store.recordCommission(clerkCtx(), commissionIn({ aboutOrgId: id })));
        const [first] = [...results.values()];
        const stored = String((await q(sql`select name from organizations where id = ${P}`))[0]!.name);
        expect(first).toEqual({ kind: "refused", reason: "congregation_not_found", detail: { presbyteryName: stored } });
        for (const [label, result] of results) {
          expect(JSON.stringify(result), label).toBe(JSON.stringify(first));
        }
        // and the sentence a form shows is the same bytes
        const sentences = [...results.values()].map((r) => refusalMessage((r as { reason: "congregation_not_found" }).reason, (r as { detail: never }).detail));
        expect(new Set(sentences).size).toBe(1);
        expect(sentences[0]).toBe(`That congregation could not be found among ${stored}'s member congregations.`);
        expect(await csnapshot()).toEqual(before);
      });

      it("moving a record to such a congregation gives the same answer and changes nothing", async () => {
        const id = await mkCommission({ aboutOrgId: CG1 });
        const before = await csnapshot();
        const answers = [];
        for (const miss of [CGX, CGNWC, CGDEPART, "00000000-0000-4090-8000-00000000ffff", "nope"]) {
          answers.push(await store.updateCommission(clerkCtx(), id, commissionIn({ aboutOrgId: miss }), 1));
        }
        expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
        expect(answers[0]).toMatchObject({ kind: "refused", reason: "congregation_not_found" });
        expect(await csnapshot()).toEqual(before);
      });

      it("the 0045 trigger's refusal (the resolver passes, the affiliation history disagrees) is the SAME answer, with nothing written and nothing logged", async () => {
        hooks.pretendMember = CGN;
        vi.spyOn(console, "error").mockImplementation(() => {});
        const before = await csnapshot();
        const viaTrigger = await store.recordCommission(clerkCtx(), commissionIn({ aboutOrgId: CGN }));
        hooks.pretendMember = null;
        const viaResolver = await store.recordCommission(clerkCtx(), commissionIn({ aboutOrgId: CGX }));
        expect(JSON.stringify(viaTrigger)).toBe(JSON.stringify(viaResolver));
        expect(viaTrigger).toMatchObject({ kind: "refused", reason: "congregation_not_found" });
        expect(await csnapshot()).toEqual(before);
        expect(console.error).not.toHaveBeenCalled();
      });
    });

    describe("updateCommission", () => {
      it("writes `commission_record.updated` with only the changed FIELD NAMES, bumps the version and refuses a stale form", async () => {
        const id = await mkCommission({ title: `Cm90 ${stamp} Before`, charge: "first", aboutOrgId: CG1, minuteReference: "m1" });
        const r = await store.updateCommission(
          clerkCtx(),
          id,
          commissionIn({ title: `Cm90 ${stamp} After`, charge: "second", aboutOrgId: CG2, appointedOn: shift(TODAY, -90), minuteReference: "m2" }),
          1,
        );
        expect(r).toEqual({ kind: "ok", data: { id } });
        expect(await recordRow(id)).toMatchObject({ title: `Cm90 ${stamp} After`, charge: "second", about_org_id: CG2, appointed_on: shift(TODAY, -90), minute_reference: "m2", row_version: 2 });
        const rows = await commissionAudit(id);
        expect(rows.map((x) => x.action)).toEqual(["tenant.commission_record.recorded", "tenant.commission_record.updated"]);
        const metadata = rows[1]!.metadata as { changed: string[] };
        expect([...metadata.changed].sort()).toEqual(["appointedOn", "charge", "congregation", "minuteReference", "title"]);
        expect(Object.keys(rows[1]!.metadata as object).sort()).toEqual(["changed", "commissionId", "organizationId"]);

        // a form opened on version 1 is stale now, naming the record wording
        const before = await csnapshot();
        const stale = await store.updateCommission(clerkCtx(), id, commissionIn({ title: "Late" }), 1);
        expect(stale).toEqual({ kind: "refused", reason: "stale", detail: { subject: "commission" } });
        expect(refusalMessage("stale", { subject: "commission" })).toBe(
          "This record was changed by someone else after you opened it. Reload the page, then make your change again.",
        );
        expect(await csnapshot()).toEqual(before);
      });

      it("moving the appointment to after today is refused with the ruled sentence (orchestrator ruling 3); an unrelated edit of a record is not held to it", async () => {
        const id = await mkCommission({ appointedOn: shift(TODAY, -60) });
        const before = await csnapshot();
        expect(await store.updateCommission(clerkCtx(), id, { ...commissionIn({ appointedOn: shift(TODAY, -60) }), appointedOn: shift(TODAY, 1) }, 1)).toEqual({
          kind: "invalid",
          field: "appointedOn",
          message: "The appointed date can't be after today.",
        });
        expect(await csnapshot()).toEqual(before);
        // today is allowed
        expect((await store.updateCommission(clerkCtx(), id, { ...commissionIn({ appointedOn: shift(TODAY, -60) }), title: `Cm90 ${stamp} Today`, appointedOn: TODAY }, 1)).kind).toBe("ok");
      });

      it("an edit that changes nothing writes nothing, audits nothing and keeps the version (`unchanged`)", async () => {
        const id = await mkCommission({ title: `Cm90 ${stamp} Same`, charge: "c", aboutOrgId: CG1, minuteReference: "m" });
        const before = await csnapshot();
        const r = await store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${stamp} Same`, charge: "c", aboutOrgId: CG1.toUpperCase(), appointedOn: shift(TODAY, -60), minuteReference: "m" }), 1);
        expect(r).toEqual({ kind: "ok", data: { id, unchanged: true } });
        expect(await csnapshot()).toEqual(before);
        expect((await recordRow(id)).row_version).toBe(1);
      });

      it("clearing the congregation or the charge is a change; the congregation may be cleared without being resolved", async () => {
        const title = `Cm90 ${stamp} Clearing`;
        const id = await mkCommission({ title, aboutOrgId: CG1, charge: "c" });
        expect(await store.updateCommission(clerkCtx(), id, commissionIn({ title, aboutOrgId: "", charge: "", appointedOn: shift(TODAY, -60) }), 1)).toEqual({ kind: "ok", data: { id } });
        expect(await recordRow(id)).toMatchObject({ about_org_id: null, charge: null });
        const meta = (await commissionAudit(id))[1]!.metadata as { changed: string[] };
        expect([...meta.changed].sort()).toEqual(["charge", "congregation"]);
      });

      it("an ENDED record may still be corrected, but not given an appointment after its end", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const id = await mkCommission({ appointedOn: shift(TODAY, -60) });
        expect((await store.endCommission(clerkCtx(), id, endIn(shift(TODAY, -10)))).kind).toBe("ok");
        expect((await store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${stamp} Corrected`, appointedOn: shift(TODAY, -60) }), 2)).kind).toBe("ok");
        const r = await store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${stamp} Corrected`, appointedOn: shift(TODAY, -5) }), 3);
        // orchestrator ruling 2: the database's refusal (ended_after_appointed) is mapped to the ruled sentence, nothing is logged
        expect(r).toEqual({ kind: "invalid", field: "appointedOn", message: "The appointed date can't be after the end date." });
        expect((await recordRow(id)).appointed_on).toBe(shift(TODAY, -60));
        expect(console.error).not.toHaveBeenCalled();
      });

      it("a record whose congregation has LEFT the presbytery keeps it through an unrelated edit (R9), and may be moved to a member", async () => {
        const leaver = await cong("CmCongLeaver", P);
        const id = await mkCommission({ aboutOrgId: leaver });
        await depart(leaver, P, P2);
        expect((await store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${stamp} While gone`, aboutOrgId: leaver, appointedOn: shift(TODAY, -60) }), 1)).kind).toBe("ok");
        expect((await recordRow(id)).about_org_id).toBe(leaver);
        expect((await store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${stamp} While gone`, aboutOrgId: CG1, appointedOn: shift(TODAY, -60) }), 2)).kind).toBe("ok");
        expect((await recordRow(id)).about_org_id).toBe(CG1);
      });
    });

    describe("addCommissionMember", () => {
      it("writes a member row with the role and dates, and one audit row with only ids, role and dates; no group row exists", async () => {
        const id = await mkCommission();
        const before = await downward();
        const r = await store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "chair", shift(TODAY, -20), shift(TODAY, 40)));
        if (r.kind !== "ok") throw new Error(JSON.stringify(r));
        const rows = await membersOf(id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: r.data.id, person_id: people[0], role: "chair", starts_on: shift(TODAY, -20), ends_on: shift(TODAY, 40) });
        const audit = await commissionAudit(id);
        expect(audit.map((x) => x.action)).toEqual(["tenant.commission_record.recorded", "tenant.commission_record.member_added"]);
        expect(audit[1]).toMatchObject({ resource_type: "commission_record", resource_id: id });
        expect(audit[1]!.metadata).toEqual({
          organizationId: P,
          commissionId: id,
          memberId: r.data.id,
          personId: people[0],
          role: "chair",
          startsOn: shift(TODAY, -20),
          endsOn: shift(TODAY, 40),
        });
        const after = await downward();
        expect(after.downward).toEqual(before.downward);
        // a commission member is NOT a group seat: the committee tables are exactly as they were
        expect(after.groups).toEqual(before.groups);
      });

      it("`not_a_member`: a person whose membership ended, one who never belonged, one at another organization only, and a nonexistent id: one answer", async () => {
        const id = await mkCommission();
        const before = await csnapshot();
        const answers = [];
        for (const person of [gone, congOnly, stranger, "00000000-0000-4090-8000-00000000fffe"]) {
          answers.push(await store.addCommissionMember(clerkCtx(), id, memberIn(person)));
        }
        expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
        expect(answers[0]).toEqual({ kind: "refused", reason: "not_a_member" });
        expect(await csnapshot()).toEqual(before);
      });

      it("interval overlap: the same dates overlap (naming the person, in the commission wording), adjacent terms do not, a back-dated disjoint term is accepted next to an open one", async () => {
        const id = await mkCommission();
        // DATED terms: only the application's interval check sees these (the database's unique index covers open terms only)
        await mkMember(id, people[0]!, "member", shift(TODAY, -20), shift(TODAY, 30));
        const before = await csnapshot();
        const clash = await store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "clerk", TODAY, shift(TODAY, 60)));
        expect(clash).toMatchObject({ kind: "refused", reason: "overlap", detail: { subject: "commission" } });
        expect((clash as { detail: { personName: string } }).detail.personName).toBe(`Avery Seat0${stamp}`);
        expect(refusalMessage("overlap", (clash as unknown as { detail: never }).detail)).toBe(
          `Avery Seat0${stamp} already serves on this commission during those dates. End that term first.`,
        );
        // contained, enclosing, and open-ended starting inside
        for (const [start, end] of [[shift(TODAY, -5), shift(TODAY, 5)], [shift(TODAY, -40), shift(TODAY, 40)], [shift(TODAY, 10), ""]] as const) {
          expect((await store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "clerk", start, end))).kind, `${start}..${end}`).toBe("refused");
        }
        expect(await csnapshot()).toEqual(before);
        // adjacent: starts the day the first ends
        expect((await store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "clerk", shift(TODAY, 30), shift(TODAY, 90)))).kind).toBe("ok");
        // disjoint, before the first
        expect((await store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "member", shift(TODAY, -90), shift(TODAY, -20)))).kind).toBe("ok");
        // and an open one after both
        expect((await store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "member", shift(TODAY, 90)))).kind).toBe("ok");
        expect(await membersOf(id)).toHaveLength(4);
      });

      it("an open term for a person already serving is `overlap`; co-chairs and a zero-length term are fine", async () => {
        const id = await mkCommission();
        await mkMember(id, people[1]!, "chair", shift(TODAY, -30));
        expect(await store.addCommissionMember(clerkCtx(), id, memberIn(people[1]!, "clerk", shift(TODAY, -10)))).toMatchObject({ kind: "refused", reason: "overlap" });
        // co-chairs: another person, the same title
        expect((await store.addCommissionMember(clerkCtx(), id, memberIn(people[2]!, "chair", shift(TODAY, -30)))).kind).toBe("ok");
        // a zero-length term (it served no day) overlaps nothing
        const zero = await mkMember(id, people[3]!, "member", shift(TODAY, -5));
        expect((await store.endCommissionMember(clerkCtx(), id, zero, { endsOn: shift(TODAY, -5) })).kind).toBe("ok");
        expect((await store.addCommissionMember(clerkCtx(), id, memberIn(people[3]!, "clerk", shift(TODAY, -10)))).kind).toBe("ok");
      });

      it("an ENDED commission refuses (`commission_ended`); another presbytery's record is `not_found`; neither writes anything", async () => {
        const ended = await mkCommission();
        expect((await store.endCommission(clerkCtx(), ended, endIn(TODAY))).kind).toBe("ok");
        const before = await csnapshot();
        expect(await store.addCommissionMember(clerkCtx(), ended, memberIn(people[1]!))).toEqual({ kind: "refused", reason: "commission_ended" });
        expect(await store.addCommissionMember(clerkCtx(), commissionP2, memberIn(people[1]!))).toEqual(never);
        expect(await csnapshot()).toEqual(before);
      });

      it("a term that starts later is accepted (it shows as planned)", async () => {
        const id = await mkCommission();
        await mkMember(id, people[0]!, "member", shift(TODAY, 15), shift(TODAY, 45));
        expect((await membersOf(id))[0]).toMatchObject({ starts_on: shift(TODAY, 15), ends_on: shift(TODAY, 45) });
      });
    });

    describe("endCommissionMember", () => {
      it("ends a serving term on the given date (half-open) with one audit row; the same date again changes nothing", async () => {
        const id = await mkCommission();
        const member = await mkMember(id, people[0]!, "clerk", shift(TODAY, -30));
        const r = await store.endCommissionMember(clerkCtx(), id, member, { endsOn: shift(TODAY, 3) });
        expect(r).toEqual({ kind: "ok", data: { id: member, cancelled: false } });
        expect((await membersOf(id))[0]).toMatchObject({ ends_on: shift(TODAY, 3) });
        const audit = await commissionAudit(id);
        const row = audit[audit.length - 1]!;
        expect(row.action).toBe("tenant.commission_record.member_ended");
        expect(row.metadata).toEqual({ organizationId: P, commissionId: id, memberId: member, personId: people[0], role: "clerk", endsOn: shift(TODAY, 3), cancelled: false });
        const count = audit.length;
        expect(await store.endCommissionMember(clerkCtx(), id, member, { endsOn: shift(TODAY, 3) })).toEqual({ kind: "ok", data: { id: member, cancelled: false, unchanged: true } });
        expect((await commissionAudit(id)).length).toBe(count);
      });

      it("a term that has not started is ended AT ITS OWN START whatever the date field says (cancel); an ended term, a blank date, an early date and a far date are refused", async () => {
        const id = await mkCommission();
        const planned = await mkMember(id, people[0]!, "member", shift(TODAY, 20));
        expect(await store.endCommissionMember(clerkCtx(), id, planned, { endsOn: null })).toEqual({ kind: "ok", data: { id: planned, cancelled: true } });
        expect((await membersOf(id))[0]).toMatchObject({ starts_on: shift(TODAY, 20), ends_on: shift(TODAY, 20) });
        expect(await store.endCommissionMember(clerkCtx(), id, planned, { endsOn: TODAY })).toEqual({ kind: "refused", reason: "already_ended" });

        const serving = await mkMember(id, people[1]!, "member", shift(TODAY, -10));
        expect(await store.endCommissionMember(clerkCtx(), id, serving, { endsOn: null })).toMatchObject({ kind: "invalid", field: "endsOn", message: VALIDATION.dateInvalid });
        expect(await store.endCommissionMember(clerkCtx(), id, serving, { endsOn: shift(TODAY, -11) })).toMatchObject({ kind: "invalid", field: "endsOn", message: VALIDATION.endBeforeStart });
        expect(await store.endCommissionMember(clerkCtx(), id, serving, { endsOn: shift(addYears(TODAY, 10), 2) })).toMatchObject({ kind: "invalid", field: "endsOn", message: VALIDATION.endTooFar });
      });

      it("a member of ANOTHER commission, or no member at all, is `seat_not_found` (one answer)", async () => {
        const a = await mkCommission();
        const b = await mkCommission();
        const memberOfB = await mkMember(b, people[0]!);
        const before = await csnapshot();
        const results = [
          await store.endCommissionMember(clerkCtx(), a, memberOfB, { endsOn: TODAY }),
          await store.endCommissionMember(clerkCtx(), a, "00000000-0000-4090-8000-00000000fffd", { endsOn: TODAY }),
          await store.endCommissionMember(clerkCtx(), a, a, { endsOn: TODAY }),
        ];
        for (const r of results) expect(r).toEqual({ kind: "refused", reason: "seat_not_found" });
        expect(await csnapshot()).toEqual(before);
      });
    });

    describe("endCommission", () => {
      it("sets the end trio, ends EVERY member (open and longer ones at the date; a not-yet-started one zero-length at its own start; a past one untouched) and audits once with the count", async () => {
        const id = await mkCommission({ appointedOn: shift(TODAY, -100) });
        const open = await mkMember(id, people[0]!, "chair", shift(TODAY, -50));
        const longer = await mkMember(id, people[1]!, "clerk", shift(TODAY, -50), shift(TODAY, 90));
        const later = await mkMember(id, people[2]!, "member", shift(TODAY, 30));
        const past = await mkMember(id, people[3]!, "member", shift(TODAY, -80), shift(TODAY, -40));
        const sooner = await mkMember(id, people[4]!, "member", shift(TODAY, -50), shift(TODAY, -3));
        const endedOn = shift(TODAY, -2);

        const r = await store.endCommission(clerkCtx(), id, endIn(endedOn, "Reported 2026-11-01"));
        expect(r).toEqual({ kind: "ok", data: { id, membersEnded: 3 } });
        expect(await recordRow(id)).toMatchObject({ ended_on: endedOn, ended_minute_reference: "Reported 2026-11-01", ended_by: fx.actingUserId, row_version: 2 });
        const byId = new Map((await membersOf(id)).map((m) => [String(m.id), m]));
        expect(byId.get(open)!.ends_on).toBe(endedOn);
        expect(byId.get(longer)!.ends_on).toBe(endedOn);
        expect(byId.get(later)!.ends_on).toBe(shift(TODAY, 30)); // zero-length at its own start
        expect(byId.get(past)!.ends_on).toBe(shift(TODAY, -40));
        expect(byId.get(sooner)!.ends_on).toBe(shift(TODAY, -3));
        // no member is left open, or serving after the end date
        const openAfter = Number(
          (await q(sql`select count(*)::int as n from commission_record_members
                        where commission_record_id = ${id} and (ends_on is null or (ends_on > ${endedOn}::date and ends_on > starts_on))`))[0]!.n,
        );
        expect(openAfter).toBe(0);

        const audit = await commissionAudit(id);
        expect(audit.filter((x) => x.action === "tenant.commission_record.ended")).toHaveLength(1);
        expect(audit[audit.length - 1]!.metadata).toEqual({ organizationId: P, commissionId: id, endedOn, membersEnded: 3 });
      });

      it("refuses a future date, a date before the appointment (naming it) and one before the start of a member who has begun (naming it); writes nothing", async () => {
        const id = await mkCommission({ appointedOn: shift(TODAY, -100) });
        await mkMember(id, people[0]!, "chair", shift(TODAY, -20));
        const before = await csnapshot();
        // the parse refuses a future date before the store ever sees it, so the store's own backstop is reached with a hand-built input
        expect(await store.endCommission(clerkCtx(), id, { endedOn: shift(TODAY, 1), endedMinuteReference: null })).toMatchObject({ kind: "invalid", field: "endedOn", message: VALIDATION.endedFuture });
        expect(await store.endCommission(clerkCtx(), id, endIn(shift(TODAY, -101)))).toMatchObject({
          kind: "invalid",
          field: "endedOn",
          message: VALIDATION.endedBeforeAppointed(shift(TODAY, -100)),
        });
        const early = await store.endCommission(clerkCtx(), id, endIn(shift(TODAY, -30)));
        expect(early).toEqual({ kind: "refused", reason: "date_before_start", detail: { date: shift(TODAY, -20), subject: "commission" } });
        expect(refusalMessage("date_before_start", (early as unknown as { detail: never }).detail)).toBe(
          `A member started on ${dateText(shift(TODAY, -20))}. The end date can't be before that.`,
        );
        expect(await csnapshot()).toEqual(before);
        // a member who has NOT begun does not constrain the date
        await mkMember(id, people[1]!, "member", shift(TODAY, 40));
        expect((await store.endCommission(clerkCtx(), id, endIn(shift(TODAY, -20)))).kind).toBe("ok");
      });

      it("is one-way: ending twice is `already_ended` (the commission wording); nothing changes; no one can be added afterwards", async () => {
        const id = await mkCommission();
        await mkMember(id, people[0]!);
        expect((await store.endCommission(clerkCtx(), id, endIn(TODAY, "first"))).kind).toBe("ok");
        const before = await csnapshot();
        expect(await store.endCommission(clerkCtx(), id, endIn(shift(TODAY, -1), "second"))).toEqual({ kind: "refused", reason: "already_ended", detail: { subject: "commission" } });
        expect(refusalMessage("already_ended", { subject: "commission" })).toBe("This commission has already ended.");
        expect(await csnapshot()).toEqual(before);
        expect(await store.addCommissionMember(clerkCtx(), id, memberIn(people[1]!))).toEqual({ kind: "refused", reason: "commission_ended" });
      });
    });

    describe("removeCommissionRecord", () => {
      it("is a soft, one-way removal with one audit row; afterwards every act on the record is `not_found`, and removing again is too", async () => {
        const id = await mkCommission();
        const member = await mkMember(id, people[0]!);
        expect(await store.removeCommissionRecord(clerkCtx(), id)).toEqual({ kind: "ok", data: { id } });
        const row = await recordRow(id);
        expect(row.removed_at).not.toBeNull();
        expect(row.removed_by).toBe(fx.actingUserId);
        // history stays: the row and its member are still there
        expect(await membersOf(id)).toHaveLength(1);
        const audit = await commissionAudit(id);
        expect(audit[audit.length - 1]).toMatchObject({ action: "tenant.commission_record.removed", resource_type: "commission_record", resource_id: id });
        expect(audit[audit.length - 1]!.metadata).toEqual({ organizationId: P, commissionId: id });

        const before = await csnapshot();
        expect(await store.removeCommissionRecord(clerkCtx(), id)).toEqual(never);
        expect(await store.updateCommission(clerkCtx(), id, commissionIn(), 2)).toEqual(never);
        expect(await store.addCommissionMember(clerkCtx(), id, memberIn(people[1]!))).toEqual(never);
        expect(await store.endCommissionMember(clerkCtx(), id, member, { endsOn: TODAY })).toEqual(never);
        expect(await store.endCommission(clerkCtx(), id, endIn())).toEqual(never);
        expect(await csnapshot()).toEqual(before);
      });
    });

    describe("not_found is byte-identical for every wrong kind of target (DECISION-040)", () => {
      it("another presbytery's record, a committee's group id, a removed record, a congregation's id and a nonexistent UUID give one answer in every write", async () => {
        const committee = await mkCommittee();
        const removed = await mkCommission();
        await store.removeCommissionRecord(clerkCtx(), removed);
        const targets: Array<[string, string]> = [
          ["another presbytery's record", commissionP2],
          ["a committee's group id", committee],
          ["a removed record", removed],
          ["a nonexistent UUID", "00000000-0000-4090-8000-00000000fffc"],
          ["a congregation's id", CG1],
        ];
        const before = await csnapshot();
        for (const [label, id] of targets) {
          const answers = [
            await store.updateCommission(clerkCtx(), id, commissionIn(), 1),
            await store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!)),
            await store.endCommission(clerkCtx(), id, endIn()),
            await store.removeCommissionRecord(clerkCtx(), id),
            await store.endCommissionMember(clerkCtx(), id, "00000000-0000-4090-8000-00000000fffb", { endsOn: TODAY }),
          ];
          for (const a of answers) expect(a, label).toEqual(never);
        }
        expect(await csnapshot()).toEqual(before);
        expect(refusalMessage("not_found", never.detail)).toBe("That commission could not be found.");
        // the other presbytery's clerk cannot touch this presbytery's record
        const mine = await mkCommission();
        expect(await store.removeCommissionRecord(ctxFor(clerkP2, P2), mine)).toEqual(never);
        expect((await recordRow(mine)).removed_at).toBeNull();
      });
    });

    describe("the audit is in the SAME transaction (the two sabotages)", () => {
      type Write = [string, () => Promise<{ kind: string }>];
      async function setup() {
        const id = await mkCommission({ title: `Cm90 ${stamp} Sabotage` });
        const toEndMember = await mkMember(id, people[0]!, "member", shift(TODAY, -40));
        const planned = await mkMember(id, people[1]!, "member", shift(TODAY, 15));
        const target = await mkCommission({ title: `Cm90 ${stamp} Sabotage ended` });
        await mkMember(target, people[2]!, "member", shift(TODAY, -40));
        const removable = await mkCommission({ title: `Cm90 ${stamp} Sabotage removable` });
        const writes: Write[] = [
          ["recordCommission", () => store.recordCommission(clerkCtx(), commissionIn())],
          ["updateCommission", () => store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${stamp} Sabotage v2`, appointedOn: shift(TODAY, -60) }), 1)],
          ["addCommissionMember", () => store.addCommissionMember(clerkCtx(), id, memberIn(people[3]!))],
          ["endCommissionMember", () => store.endCommissionMember(clerkCtx(), id, toEndMember, { endsOn: TODAY })],
          ["endCommissionMember (cancel)", () => store.endCommissionMember(clerkCtx(), id, planned, { endsOn: null })],
          ["endCommission", () => store.endCommission(clerkCtx(), target, endIn(TODAY))],
          ["removeCommissionRecord", () => store.removeCommissionRecord(clerkCtx(), removable)],
        ];
        return writes;
      }

      it.each(["fail_before", "fail_after"] as const)(
        "%s: every commission write leaves the data and the audit table exactly as they were, and the caller is told `save_failed`",
        async (mode) => {
          const writes = await setup();
          vi.spyOn(console, "error").mockImplementation(() => {});
          const before = await csnapshot();
          for (const [name, write] of writes) {
            hooks.mode = mode;
            const r = await write();
            hooks.mode = "ok";
            expect(r, name).toEqual({ kind: "refused", reason: "save_failed" });
            expect(await csnapshot(), name).toEqual(before);
          }
        },
      );

      it("and with the audit working each of those writes does change the data (the sabotages above are not passing vacuously)", async () => {
        const writes = await setup();
        for (const [name, write] of writes) {
          const before = await csnapshot();
          const r = await write();
          expect(r.kind, name).toBe("ok");
          expect(await csnapshot(), name).not.toEqual(before);
        }
      });
    });

    describe("no audit row carries a title, a charge, a minute or a person's name", () => {
      it("sentinel strings in the title, charge, minute and end minute appear in no audit row of any commission write", async () => {
        const SENT = ["ZQ-TITLE-SENTINEL", "ZQ-CHARGE-SENTINEL", "ZQ-MINUTE-SENTINEL", "ZQ-ENDMINUTE-SENTINEL"];
        const id = await mkCommission({ title: `Cm90 ${SENT[0]} ${stamp}`, charge: SENT[1]!, minuteReference: SENT[2]!, aboutOrgId: CG1, appointedOn: shift(TODAY, -60) });
        const member = await mkMember(id, people[0]!, "member", shift(TODAY, -30));
        await mkMember(id, people[1]!, "chair", shift(TODAY, -30));
        await store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${SENT[0]} ${stamp} v2`, charge: `${SENT[1]} 2`, minuteReference: `${SENT[2]} 2`, aboutOrgId: CG2, appointedOn: shift(TODAY, -60) }), 1);
        await store.endCommissionMember(clerkCtx(), id, member, { endsOn: shift(TODAY, -1) });
        await store.endCommission(clerkCtx(), id, endIn(TODAY, SENT[3]));
        const removable = await mkCommission({ title: `Cm90 ${SENT[0]} removable ${stamp}`, charge: SENT[1]! });
        await store.removeCommissionRecord(clerkCtx(), removable);

        const rows = [...(await commissionAudit(id)), ...(await commissionAudit(removable))];
        expect(rows.length).toBeGreaterThanOrEqual(8);
        const text = JSON.stringify(rows);
        for (const sentinel of SENT) expect(text).not.toContain(sentinel);
        expect(text).not.toMatch(/Avery|Blair|Seat0|Seat1/);
        // and no audit row of any action, anywhere, carries one
        const anywhere = await q(sql`select count(*)::int as n from audit_events where metadata::text like '%ZQ-%SENTINEL%'`);
        expect(Number(anywhere[0]!.n)).toBe(0);
      });
    });

    describe("concurrency", () => {
      it("two simultaneous adds of one person end with ONE member and one `overlap`", async () => {
        for (let i = 0; i < 3; i += 1) {
          const id = await mkCommission();
          const results = await Promise.all([
            store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "member", shift(TODAY, -5))),
            store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "clerk", shift(TODAY, -5))),
          ]);
          expect(results.map((r) => (r.kind === "ok" ? "ok" : (r as { reason: string }).reason)).sort()).toEqual(["ok", "overlap"]);
          expect(await membersOf(id)).toHaveLength(1);
        }
      });

      it("two simultaneous edits of one version end with ONE write and one `stale`", async () => {
        for (let i = 0; i < 3; i += 1) {
          const id = await mkCommission({ title: `Cm90 ${stamp} Race edit ${i}` });
          const results = await Promise.all([
            store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${stamp} Race A ${i}`, appointedOn: shift(TODAY, -60) }), 1),
            store.updateCommission(clerkCtx(), id, commissionIn({ title: `Cm90 ${stamp} Race B ${i}`, appointedOn: shift(TODAY, -60) }), 1),
          ]);
          expect(results.map((r) => (r.kind === "ok" ? "ok" : (r as { reason: string }).reason)).sort()).toEqual(["ok", "stale"]);
          expect((await recordRow(id)).row_version).toBe(2);
        }
      });

      it("a member added racing the end of the commission: whichever order, NO member is left serving on an ended commission", async () => {
        for (let i = 0; i < 6; i += 1) {
          const id = await mkCommission({ appointedOn: shift(TODAY, -60) });
          await mkMember(id, people[1]!, "member", shift(TODAY, -30));
          const [ended, added] = await Promise.all([
            store.endCommission(clerkCtx(), id, endIn(TODAY)),
            store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "member", shift(TODAY, -3))),
          ]);
          expect(ended.kind, `iteration ${i}`).toBe("ok");
          expect(["ok", "refused"]).toContain(added.kind);
          if (added.kind === "refused") expect((added as { reason: string }).reason, `iteration ${i}`).toBe("commission_ended");
          const serving = Number(
            (await q(sql`select count(*)::int as n from commission_record_members where commission_record_id = ${id} and (ends_on is null or ends_on > ${TODAY}::date)`))[0]!.n,
          );
          expect(serving, `iteration ${i}: ${JSON.stringify(added)}`).toBe(0);
          expect((await recordRow(id)).ended_on).toBe(TODAY);
        }
      });

      it("THE LIVE-PARENT GUARD: an add that read the record as active but reaches the database after the end commits is refused by the guard, and writes no member", async () => {
        const id = await mkCommission({ appointedOn: shift(TODAY, -60) });
        // The end is held UNCOMMITTED on the owner connection: the store's plain read still sees an active record.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let held!: () => void;
        const holding = new Promise<void>((resolve) => (held = resolve));
        const ender = fx.platform.transaction(async (tx) => {
          await tx.execute(sql`update commission_records set ended_on = ${TODAY}::date, ended_by = ${fx.actingUserId}, ended_at = now() where id = ${id}`);
          held();
          await gate;
        });
        await holding;
        const adding = store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "member", shift(TODAY, -3)));
        // Give the add time to pass its own checks and block inside the guard's FOR SHARE.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        release();
        await ender;
        const result = await adding;
        expect(result).toEqual({ kind: "refused", reason: "commission_ended" });
        expect(await membersOf(id)).toHaveLength(0);
        expect((await recordRow(id)).ended_on).toBe(TODAY);
      });

      it("a member added racing the REMOVAL of the record: refused, or landed before the removal; never a member added after it", async () => {
        for (let i = 0; i < 6; i += 1) {
          const id = await mkCommission();
          const [removed, added] = await Promise.all([
            store.removeCommissionRecord(clerkCtx(), id),
            store.addCommissionMember(clerkCtx(), id, memberIn(people[0]!, "member", shift(TODAY, -3))),
          ]);
          expect(removed.kind, `iteration ${i}`).toBe("ok");
          if (added.kind === "refused") {
            expect(["commission_ended", "not_found"], `iteration ${i}`).toContain((added as { reason: string }).reason);
            expect(await membersOf(id), `iteration ${i}`).toHaveLength(0);
          } else {
            expect(await membersOf(id), `iteration ${i}`).toHaveLength(1);
          }
        }
      });

      it("ending a member racing the end of the commission ends consistent: the member is ended, never after the commission's own end", async () => {
        for (let i = 0; i < 6; i += 1) {
          const id = await mkCommission({ appointedOn: shift(TODAY, -60) });
          const member = await mkMember(id, people[2]!, "member", shift(TODAY, -30));
          const [ended, memberEnded] = await Promise.all([
            store.endCommission(clerkCtx(), id, endIn(shift(TODAY, -1))),
            store.endCommissionMember(clerkCtx(), id, member, { endsOn: shift(TODAY, -2) }),
          ]);
          expect(ended.kind, `iteration ${i}`).toBe("ok");
          expect(["ok", "refused"]).toContain(memberEnded.kind);
          const [row] = await membersOf(id);
          expect(row!.ends_on, `iteration ${i}`).not.toBeNull();
          expect(String(row!.ends_on) <= shift(TODAY, -1), `iteration ${i}: ${row!.ends_on}`).toBe(true);
        }
      });
    });
  });
});
