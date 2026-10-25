/**
 * Every dashboard reader against the real database on the platform connection:
 * the SQL runs, returns the contract's shape, and agrees with a direct count
 * (E21). Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/admin-portal/dashboard/readers.db.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("dashboard readers (Postgres-backed, platform connection)", () => {
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  async function direct(query: ReturnType<typeof sql>): Promise<Row> {
    const { getPlatformDb } = await import("@/lib/db");
    return rowsOf(await getPlatformDb().execute(query))[0] ?? {};
  }
  const num = (v: unknown) => Number(v);

  it("tickets: new, unassigned open and the age of the oldest new ticket agree with the table", async () => {
    const { readTicketsCard } = await import("./tickets");
    const result = await readTicketsCard();
    if (result.kind !== "ok") throw new Error("expected ok");
    const d = await direct(sql`
      select count(*) filter (where status = 'new')::int as n,
             count(*) filter (where status in ('new', 'triaged', 'in_progress') and assignee_user_id is null)::int as u
        from tickets`);
    expect(result.newCount).toBe(num(d.n));
    expect(result.unassignedOpen).toBe(num(d.u));
    if (result.newCount === 0) expect(result.oldestNewSeconds).toBeNull();
    else expect(result.oldestNewSeconds).toBeGreaterThanOrEqual(0);
  });

  it("feedback: new count agrees with the table", async () => {
    const { readFeedbackCard } = await import("./feedback");
    const result = await readFeedbackCard();
    const d = await direct(sql`select count(*)::int as n from feedback where status = 'new'`);
    expect(result).toEqual({ kind: "ok", newCount: num(d.n) });
  });

  it("email: failed and overdue are non-negative integers; failed agrees with the table", async () => {
    const { readEmailCard } = await import("./email");
    const result = await readEmailCard();
    if (result.kind !== "ok") throw new Error("expected ok");
    const d = await direct(sql`select count(*)::int as n from email_queue where status = 'failed'`);
    expect(result.failed).toBe(num(d.n));
    expect(Number.isInteger(result.overdue) && result.overdue >= 0).toBe(true);
  });

  it("accounts: locked agrees with the table", async () => {
    const { readAccountsCard } = await import("./accounts");
    const d = await direct(sql`select count(*)::int as n from users where locked_until > now()`);
    expect(await readAccountsCard()).toEqual({ kind: "ok", locked: num(d.n) });
  });

  it("organizations: totals, types and statuses agree with the table and each other", async () => {
    const { readOrganizationsCard } = await import("./organizations");
    const result = await readOrganizationsCard();
    if (result.kind !== "ok") throw new Error("expected ok");
    const d = await direct(sql`
      select count(*)::int as total,
             count(*) filter (where lifecycle_status <> 'active')::int as inactive,
             count(*) filter (where id not in (select organization_id from organization_brands))::int as plain
        from organizations`);
    expect(result.total).toBe(num(d.total));
    expect(result.inactive).toBe(num(d.inactive));
    expect(result.defaultPalette).toBe(num(d.plain));
    expect(Object.values(result.byType).reduce((a, b) => a + b, 0)).toBe(result.total);
    expect(Object.values(result.byStatus).reduce((a, b) => a + b, 0)).toBe(result.total);
  });

  it("sites: the counts add up to the destination list", async () => {
    const { readSitesCard } = await import("./sites");
    const { listSitesForAdmin } = await import("@/lib/sites");
    const [result, sites] = await Promise.all([readSitesCard(), listSitesForAdmin()]);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.live + result.provisioning + result.suspended).toBe(sites.length);
  });

  it("two-factor, domains and giving: each returns ok with non-negative integers", async () => {
    const [{ readTwoFactorCard }, { readDomainsCard }, { readGivingCard }] = await Promise.all([
      import("./two-factor"),
      import("./domains"),
      import("./giving"),
    ]);
    const [tf, dom, giv] = await Promise.all([readTwoFactorCard(), readDomainsCard(), readGivingCard()]);
    expect(tf.kind).toBe("ok");
    expect(dom.kind).toBe("ok");
    expect(giv.kind).toBe("ok");
    if (tf.kind === "ok") expect(tf.notEnrolled).toBeGreaterThanOrEqual(0);
    if (dom.kind === "ok") expect(dom.needAttention).toBeGreaterThanOrEqual(0);
    if (giv.kind === "ok") for (const n of [giv.connections, giv.waiting, giv.deadLetters, giv.restricted]) expect(n).toBeGreaterThanOrEqual(0);
  });
});
