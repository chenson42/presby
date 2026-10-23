/**
 * The TypeScript routing rule and the SQL reader agree (ER11, ER12,
 * DECISION-216). The same fixture rows run through `chooseEmail()` (over the
 * rows `listActiveEmails()` reads) and through `presby_person_email()` (via
 * `getPersonEmail()`), for every purpose, and the answers must be identical.
 * SQL is authoritative for any credential; this test is what keeps the
 * TypeScript copy honest for UI previews and RLS-side senders.
 *
 * Also pinned: the shared order constant equals the SQL `order by` (ER1a), an
 * unknown purpose raises in both languages (R35), the reader is org-scoped
 * (an invoker function: another organization sees nothing), and ended rows are
 * invisible to both.
 *
 * Run (serial): npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/contact-methods/matrix.db.test.ts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";
import { EMAIL_DISPLAY_ORDER_SQL, EMAIL_PROMOTION_ORDER_SQL, EMAIL_PURPOSES, chooseEmail } from "./email-routing";
import type { EmailSubtype } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

interface Seed {
  value: string;
  subtype?: EmailSubtype | null;
  main?: boolean;
  dnc?: boolean;
  /** Seconds after a fixed epoch; equal values are a created_at tie. */
  at: number;
  ended?: boolean;
  /** Force an id (to decide tie order independently of luck). */
  id?: string;
}

/** `LOW` / `HIGH` stand for two fresh uuids in ascending order, per seeded person, so a created_at tie has a known winner. */
const LOW = "LOW";
const HIGH = "HIGH";

const SCENARIOS: Array<{ label: string; rows: Seed[] }> = [
  { label: "no rows", rows: [] },
  { label: "a single Work main", rows: [{ value: "w", subtype: "work", main: true, at: 1 }] },
  {
    label: "Personal main plus Work",
    rows: [
      { value: "p", subtype: "personal", main: true, at: 2 },
      { value: "w", subtype: "work", at: 1 },
    ],
  },
  {
    label: "Work main plus Personal",
    rows: [
      { value: "w", subtype: "work", main: true, at: 1 },
      { value: "p", subtype: "personal", at: 2 },
    ],
  },
  {
    label: "Work main, Personal do-not-contact, Other",
    rows: [
      { value: "w", subtype: "work", main: true, at: 1 },
      { value: "p", subtype: "personal", dnc: true, at: 2 },
      { value: "o", subtype: "other", at: 3 },
    ],
  },
  {
    label: "every address do-not-contact",
    rows: [
      { value: "m", subtype: "personal", main: true, dnc: true, at: 1 },
      { value: "w", subtype: "work", dnc: true, at: 2 },
    ],
  },
  {
    label: "null labels: a null main and a Work address",
    rows: [
      { value: "m", subtype: null, main: true, at: 2 },
      { value: "w", subtype: "work", at: 1 },
    ],
  },
  {
    label: "a Work address that is do-not-contact, and a Personal main",
    rows: [
      { value: "p", subtype: "personal", main: true, at: 2 },
      { value: "w", subtype: "work", dnc: true, at: 1 },
    ],
  },
  {
    label: "ended rows are invisible: an ended Work row beside an active Personal main",
    rows: [
      { value: "p", subtype: "personal", main: true, at: 3 },
      { value: "w", subtype: "work", ended: true, at: 1 },
      { value: "o", subtype: "other", ended: true, at: 2 },
    ],
  },
  {
    label: "only ended rows",
    rows: [{ value: "x", subtype: "personal", ended: true, at: 1 }],
  },
  {
    label: "created_at ties among Work rows fall to id order",
    rows: [
      { value: "m", subtype: "personal", main: true, at: 9 },
      { value: "w-high", subtype: "work", at: 5, id: HIGH },
      { value: "w-low", subtype: "work", at: 5, id: LOW },
    ],
  },
  {
    label: "created_at ties among Other rows behind a Work main fall to id order",
    rows: [
      { value: "w", subtype: "work", main: true, at: 9 },
      { value: "o-high", subtype: "other", at: 5, id: HIGH },
      { value: "o-low", subtype: "other", at: 5, id: LOW },
    ],
  },
  {
    label: "several Work addresses: the oldest wins for role",
    rows: [
      { value: "m", subtype: "personal", main: true, at: 9 },
      { value: "w-new", subtype: "work", at: 7 },
      { value: "w-old", subtype: "work", at: 3 },
    ],
  },
  {
    label: "a Work main with an older Other and a newer Personal",
    rows: [
      { value: "w", subtype: "work", main: true, at: 5 },
      { value: "o", subtype: "other", at: 1 },
      { value: "p", subtype: "personal", at: 8 },
    ],
  },
];

describe("the order constants are the SQL's text (ER1a)", () => {
  const read = (...parts: string[]) => readFileSync(path.resolve(__dirname, ...parts), "utf8");
  it("sql.ts, the shared fragments, order by exactly the display order", () => {
    const text = read("sql.ts").replace(/\s+/g, " ");
    const orders = text.match(/order by (?:cmw\.)?is_primary desc, (?:cmw\.)?created_at, (?:cmw\.)?id/g) ?? [];
    expect(orders.length).toBeGreaterThanOrEqual(3);
    expect(EMAIL_DISPLAY_ORDER_SQL).toBe("is_primary desc, created_at, id");
  });
  it("store.ts reads active rows in that order and promotes by created_at then id", () => {
    const text = read("store.ts").replace(/\s+/g, " ");
    expect(text).toContain("orderBy(desc(contactMethods.isPrimary), asc(contactMethods.createdAt), asc(contactMethods.id))");
    expect(EMAIL_PROMOTION_ORDER_SQL).toBe("created_at, id");
  });
});

describe.skipIf(!hasDb)("chooseEmail() and presby_person_email() agree (Postgres-backed)", { timeout: 120_000 }, () => {
  let fx: InvitationFixture;
  let store: typeof import("./store");
  let reader: typeof import("./reader");
  let authz: typeof import("@/lib/authz");
  let orgA: string;
  let orgB: string;
  let viewerA: string;
  let viewerB: string;
  let stamp: string;
  const q = (query: SQL): Promise<Row[]> => fx.q(query);

  async function seedPerson(rows: Seed[]): Promise<{ personId: string; ids: Map<string, string> }> {
    const personId = await fx.makePerson("Matrix", `Fixture${stamp}${Math.floor(Math.random() * 1e6)}`);
    await fx.addMember(orgA, personId);
    const ids = new Map<string, string>();
    const [low, high] = [randomUUID(), randomUUID()].sort();
    // the main address first: the deferred check needs a main whenever an active address exists
    const ordered = [...rows].sort((a, b) => Number(b.main ?? false) - Number(a.main ?? false));
    for (const r of ordered) {
      const id = r.id === LOW ? low! : r.id === HIGH ? high! : randomUUID();
      ids.set(r.value, id);
      const value = `${r.value}-${stamp}-${id.slice(0, 8)}@example.invalid`;
      await q(sql`
        insert into contact_methods (id, person_id, kind, value, subtype, is_primary, do_not_contact, created_at, ended_at)
        values (${id}, ${personId}, 'email', ${value}, ${r.subtype ?? null}, ${r.main ?? false}, ${r.dnc ?? false},
                '2026-01-01T00:00:00Z'::timestamptz + make_interval(secs => ${r.at}),
                ${r.ended ? "2026-02-01T00:00:00Z" : null}::timestamptz)`);
    }
    return { personId, ids };
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("cm-matrix");
    store = await import("./store");
    reader = await import("./reader");
    authz = await import("@/lib/authz");
    stamp = `${Date.now()}`;
    orgA = await fx.makeOrg("a");
    orgB = await fx.makeOrg("b");
    viewerA = await fx.makePerson("Viewer", `A${stamp}`);
    await fx.addMember(orgA, viewerA);
    viewerB = await fx.makePerson("Viewer", `B${stamp}`);
    await fx.addMember(orgB, viewerB);
  }, 180_000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  }, 180_000);

  for (const scenario of SCENARIOS) {
    it(`${scenario.label}: identical for credential, role and personal`, async () => {
      const { personId } = await seedPerson(scenario.rows);
      await authz.withOrgContext(viewerA, orgA, async (tx) => {
        const active = await store.listActiveEmails(tx, personId);
        for (const purpose of EMAIL_PURPOSES) {
          const fromTs = chooseEmail(active, purpose);
          const fromSql = await reader.getPersonEmail(tx, personId, purpose);
          expect(fromSql?.contactMethodId ?? null, `${scenario.label} / ${purpose}`).toBe(fromTs?.id ?? null);
          if (fromTs && fromSql) {
            expect(fromSql).toEqual({
              contactMethodId: fromTs.id,
              address: fromTs.value,
              subtype: fromTs.subtype,
              doNotContact: fromTs.doNotContact,
            });
          }
        }
      });
    });
  }

  it("the matrix is not vacuous: the scenarios produce several distinct answers", async () => {
    const answers = new Set<string>();
    for (const scenario of SCENARIOS.slice(0, 8)) {
      const { personId, ids } = await seedPerson(scenario.rows);
      await authz.withOrgContext(viewerA, orgA, async (tx) => {
        for (const purpose of EMAIL_PURPOSES) {
          const got = await reader.getPersonEmail(tx, personId, purpose);
          const label = [...ids.entries()].find(([, id]) => id === got?.contactMethodId)?.[0] ?? "none";
          answers.add(`${purpose}:${label}`);
        }
      });
    }
    expect(answers.has("role:w")).toBe(true);
    expect(answers.has("personal:p")).toBe(true);
    expect(answers.has("credential:w")).toBe(true);
    expect(answers.has("personal:none")).toBe(true);
    expect(answers.has("role:none")).toBe(true);
  });

  it("the tie scenarios choose the lower id, in SQL and in TypeScript", async () => {
    const tie = SCENARIOS.find((s) => s.label.startsWith("created_at ties among Work"))!;
    const { personId, ids } = await seedPerson(tie.rows);
    await authz.withOrgContext(viewerA, orgA, async (tx) => {
      const got = await reader.getPersonEmail(tx, personId, "role");
      expect(got?.contactMethodId).toBe(ids.get("w-low"));
      const active = await store.listActiveEmails(tx, personId);
      expect(chooseEmail(active, "role")?.id).toBe(ids.get("w-low"));
    });
  });

  it("an ended row is never returned, whatever the purpose", async () => {
    const { personId } = await seedPerson([{ value: "gone", subtype: "work", ended: true, at: 1 }]);
    await authz.withOrgContext(viewerA, orgA, async (tx) => {
      for (const purpose of EMAIL_PURPOSES) {
        expect(await reader.getPersonEmail(tx, personId, purpose)).toBeNull();
      }
    });
  });

  it("an unknown purpose raises in both languages (R35); it is never a fallback", async () => {
    const { personId } = await seedPerson([{ value: "m", main: true, at: 1 }]);
    await authz.withOrgContext(viewerA, orgA, async (tx) => {
      await expect(reader.getPersonEmail(tx, personId, "marketing" as never)).rejects.toThrow(/unknown purpose/);
    });
    // the SQL function itself, called directly as presby_app
    let message = "";
    try {
      await authz.withOrgContext(viewerA, orgA, (tx) =>
        tx.execute(sql`select * from presby_person_email(${personId}::uuid, 'marketing')`),
      );
    } catch (err) {
      message = JSON.stringify(err, Object.getOwnPropertyNames(err)) + String((err as { cause?: unknown }).cause ?? "");
    }
    expect(message).toMatch(/unknown purpose marketing/);
  });

  it("the function body orders by the display order the TypeScript constant states (ER1a)", async () => {
    const [def] = await q(sql`select pg_get_functiondef('presby_person_email(uuid,text)'::regprocedure) as d`);
    const body = String(def!.d).replace(/\bcm\./g, "").replace(/\s+/g, " ").toLowerCase();
    expect(body).toContain(EMAIL_DISPLAY_ORDER_SQL);
    // role: a Work address sorts first (coalesce, because DESC sorts NULLs first), then the display order
    expect(body).toContain(
      `order by case when p_purpose = 'role' then coalesce(subtype = 'work', false) else false end desc, ${EMAIL_DISPLAY_ORDER_SQL}`,
    );
  });

  it("is an invoker: another organization's context sees nothing, even for a person who has addresses", async () => {
    const { personId } = await seedPerson([{ value: "m", main: true, at: 1 }]);
    await authz.withOrgContext(viewerA, orgA, async (tx) => {
      expect(await reader.getPersonEmail(tx, personId, "credential")).not.toBeNull();
    });
    await authz.withOrgContext(viewerB, orgB, async (tx) => {
      for (const purpose of EMAIL_PURPOSES) {
        expect(await reader.getPersonEmail(tx, personId, purpose)).toBeNull();
      }
      expect(await store.listActiveEmails(tx, personId)).toEqual([]);
    });
  });
});
