/**
 * Recent operator changes against the real database on the platform connection.
 * docs/work-log/2026-10-25-platform-admin-redesign-inc1.md, E17: the reader
 * returns a closed list of actions, resolves the organization name, narrows the
 * two invitation keys by their metadata flag, and never carries a revoke
 * reason or any other metadata. Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/admin-portal/dashboard/recent-changes.db.test.ts
 *
 * The fixture rows are dated two days ahead so they are the newest ten whatever
 * else is in the development log, and are deleted by id afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("recent operator changes (Postgres-backed, platform connection)", () => {
  let fx: CalendarFixture;
  let reader: typeof import("./recent-changes");
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  const q = async (query: SQL) => rowsOf(await fx.platform.execute(query));

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const actor = `recent-changes-${stamp}@example.invalid`;
  const MARKER = `REASON-MARKER-${stamp}`;
  const flagKey = `fixture.flag.${stamp}`;
  const auditIds: string[] = [];
  let orgId: string;
  let orgName: string;

  async function audit(action: string, opts: { resourceId?: string; metadata?: Record<string, unknown>; minutesAhead: number }) {
    const [r] = await q(sql`
      insert into audit_events (action, actor_email, resource_type, resource_id, metadata, created_at)
      values (${action}, ${actor}, 'fixture', ${opts.resourceId ?? null}, ${JSON.stringify(opts.metadata ?? {})}::jsonb,
              now() + interval '2 days' + (${opts.minutesAhead} * interval '1 minute'))
      returning id`);
    auditIds.push(String(r!.id));
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("recent-changes");
    reader = await import("./recent-changes");
    orgId = await fx.makeOrg("recent");
    const [o] = await q(sql`select name from organizations where id = ${orgId}`);
    orgName = String(o!.name);

    // Newest first by minutesAhead.
    await audit("org.founding_administrator.revoked", {
      resourceId: orgId,
      metadata: { organizationId: orgId, slot: "founding_administrator", reason: MARKER },
      minutesAhead: 10,
    });
    await audit("invitation.created", { resourceId: "inv-a", metadata: { organizationId: orgId, selfAddressed: true, recipient: MARKER }, minutesAhead: 9 });
    await audit("invitation.created", { resourceId: "inv-b", metadata: { organizationId: orgId, selfAddressed: false }, minutesAhead: 8 });
    await audit("invitation.accepted", { resourceId: "inv-c", metadata: { organizationId: orgId, inviterIsInvitee: true }, minutesAhead: 7 });
    await audit("invitation.accepted", { resourceId: "inv-d", metadata: { organizationId: orgId, inviterIsInvitee: false }, minutesAhead: 6 });
    await audit("feature_flag.toggled", { resourceId: flagKey, metadata: { from: false, to: true }, minutesAhead: 5 });
    await audit("user.role.assigned", { resourceId: "00000000-0000-0000-0000-000000000000", metadata: { roleKey: MARKER }, minutesAhead: 4 });
    await audit("totp.enrolled", { resourceId: "x", metadata: {}, minutesAhead: 3 });
    await audit("org.treasurer.revoked", { resourceId: crypto.randomUUID(), metadata: {}, minutesAhead: 2 });
  }, 120_000);

  afterAll(async () => {
    if (!fx) return;
    for (const id of auditIds) await q(sql`delete from audit_events where id = ${id}`);
    await fx.cleanup();
  }, 90_000);

  async function mine() {
    const result = await reader.readRecentChangesCard();
    if (result.kind !== "ok") throw new Error("expected ok");
    return result.rows.filter((r) => r.actorEmail === actor);
  }

  it("returns the closed list newest first, with names resolved and the invitation keys narrowed by their flag", async () => {
    expect((await mine()).map((r) => [r.action, r.subject])).toEqual([
      ["org.founding_administrator.revoked", orgName],
      ["invitation.created", orgName],
      ["invitation.accepted", orgName],
      ["feature_flag.toggled", flagKey],
      ["user.role.assigned", null],
      ["org.treasurer.revoked", "Unknown organization"],
    ]);
  });

  it("is bounded to ten rows", async () => {
    const result = await reader.readRecentChangesCard();
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.rows.length).toBeLessThanOrEqual(10);
  });

  it("never carries a revoke reason, a recipient, a role key or any other metadata (E17)", async () => {
    const result = await reader.readRecentChangesCard();
    const text = JSON.stringify(result);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("slot");
    expect(text).not.toContain("metadata");
    if (result.kind !== "ok") throw new Error("expected ok");
    for (const r of result.rows) expect(Object.keys(r).sort()).toEqual(["action", "actorEmail", "at", "subject"]);
  });

  it("a non-uuid resource id (a flag key) cannot raise a cast error in the join", async () => {
    const result = await reader.readRecentChangesCard();
    expect(result.kind).toBe("ok");
  });
});
