import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const execute = vi.fn();
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ execute }) }));

import { CHANGE_ACTIONS, CHANGE_LABELS } from "./change-labels";
import { readRecentChangesCard } from "./recent-changes";

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const at = new Date("2026-10-25T12:00:00.000Z");

describe("readRecentChangesCard", () => {
  it("one statement; maps each row to action, subject, actor and an ISO time (E22)", async () => {
    execute.mockResolvedValue({
      rows: [
        { action: "org.treasurer.revoked", actor_email: "ops@example.invalid", created_at: at, org_ref: "x", flag_key: null, org_name: "First Example Church" },
        { action: "feature_flag.toggled", actor_email: "ops@example.invalid", created_at: at, org_ref: null, flag_key: "demo.flag", org_name: null },
        { action: "user.deactivated", actor_email: null, created_at: "2026-10-24T08:00:00.000Z", org_ref: null, flag_key: null, org_name: null },
      ],
    });
    const result = await readRecentChangesCard();
    expect(result).toEqual({
      kind: "ok",
      rows: [
        { action: "org.treasurer.revoked", subject: "First Example Church", actorEmail: "ops@example.invalid", at: "2026-10-25T12:00:00.000Z" },
        { action: "feature_flag.toggled", subject: "demo.flag", actorEmail: "ops@example.invalid", at: "2026-10-25T12:00:00.000Z" },
        { action: "user.deactivated", subject: null, actorEmail: null, at: "2026-10-24T08:00:00.000Z" },
      ],
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("an organization that no longer resolves reads as Unknown organization, never an id", async () => {
    execute.mockResolvedValue({
      rows: [{ action: "invitation.created", actor_email: "a@example.invalid", created_at: at, org_ref: "11111111-1111-1111-1111-111111111111", flag_key: null, org_name: null }],
    });
    const result = await readRecentChangesCard();
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.rows[0]!.subject).toBe("Unknown organization");
    expect(JSON.stringify(result)).not.toContain("11111111");
  });

  it("drops a row whose action is not on the closed list or whose time is unreadable", async () => {
    execute.mockResolvedValue({
      rows: [
        { action: "totp.reset", actor_email: "a@example.invalid", created_at: at },
        { action: "user.reactivated", actor_email: "a@example.invalid", created_at: "not a date" },
        { action: "user.reactivated", actor_email: "a@example.invalid", created_at: at },
      ],
    });
    const result = await readRecentChangesCard();
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.rows.map((r) => r.action)).toEqual(["user.reactivated"]);
  });

  it("no matching rows is an empty list, not an error", async () => {
    execute.mockResolvedValue({ rows: [] });
    expect(await readRecentChangesCard()).toEqual({ kind: "ok", rows: [] });
  });

  it("never selects metadata whole, only the three paths it needs (E17)", async () => {
    execute.mockResolvedValue({ rows: [] });
    await readRecentChangesCard();
    const text = (execute.mock.calls[0]![0] as { queryChunks: unknown[] }).queryChunks
      .map((c) => (typeof c === "object" && c !== null && "value" in c ? (c as { value: string[] }).value.join("") : ""))
      .join("");
    expect(text).toContain("metadata->>'organizationId'");
    expect(text.replace(/metadata->>'(organizationId|selfAddressed|inviterIsInvitee)'/g, "")).not.toMatch(/metadata/);
    expect(text).toMatch(/limit/i);
  });

  it("a failed read is kind: error, never an empty list (E5)", async () => {
    execute.mockRejectedValue(new Error("x"));
    expect(await readRecentChangesCard()).toEqual({ kind: "error" });
  });
});

describe("the closed list", () => {
  it("every action has exactly one label", () => {
    expect(Object.keys(CHANGE_LABELS).sort()).toEqual([...CHANGE_ACTIONS].sort());
    for (const label of Object.values(CHANGE_LABELS)) expect(label.length).toBeGreaterThan(0);
  });

  it("every key exists in AUDIT_ACTIONS (a renamed audit key must fail here, not silently empty the card)", async () => {
    vi.doMock("@/auth", () => ({ auth: vi.fn() }));
    vi.doMock("@/lib/db", () => ({ db: {}, getPlatformDb: () => ({}) }));
    const { AUDIT_ACTIONS } = await import("@/lib/audit");
    const known = new Set<string>(Object.values(AUDIT_ACTIONS));
    for (const action of CHANGE_ACTIONS) expect(known.has(action)).toBe(true);
    vi.doUnmock("@/auth");
  });
});
