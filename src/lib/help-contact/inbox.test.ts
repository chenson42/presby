/**
 * inbox.ts with a fake transaction runner (no database). What this pins is the
 * contract the file owns: what a mutation writes, what it refuses, that the
 * audit row carries ids and statuses only (CA10, AF-5), and the cursor and
 * excerpt rules. The real guard, the real audit row and the real rollback are
 * inbox.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ transaction: () => Promise.reject(new Error("unexpected")) }) }));
const insertAuditRow = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit-tx", () => ({ insertAuditRow }));
// The real module imports @/auth (the whole NextAuth graph); the two keys are what inbox.ts reads, and the strings are pinned below.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    HELP_CONTACT_STATUS_CHANGED: "help_contact.status_changed",
    HELP_CONTACT_DETAILS_CLEARED: "help_contact.details_cleared",
  },
}));

import {
  clearMessageDetails,
  EXCERPT_CHARS,
  isMessageId,
  listMessages,
  parseCursor,
  readMessage,
  setMessageStatus,
  type PlatformExec,
} from "./inbox";

const ID = "11111111-2222-4333-8444-555555555555";
const ACTOR = { userId: "99999999-2222-4333-8444-555555555555", email: "operator@example.invalid" };

/** A thenable query chain: every builder method returns itself; awaiting it yields `result`. */
type Spy = Record<string, (...args: unknown[]) => unknown>;
function chain(result: unknown, spy?: Spy) {
  const self: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "leftJoin", "for"]) {
    self[m] = (...args: unknown[]) => {
      spy?.[m]?.(...args);
      return self;
    };
  }
  self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return self;
}

function fakeExec(opts: { selects: unknown[][]; spy?: Spy }) {
  const queue = [...opts.selects];
  const set = vi.fn();
  const tx = {
    select: vi.fn(() => chain(queue.shift() ?? [], opts.spy)),
    update: vi.fn(() => ({
      set: (v: unknown) => {
        set(v);
        return { where: () => Promise.resolve() };
      },
    })),
  };
  const exec: PlatformExec = (fn) => fn(tx as never);
  return { exec, tx, set };
}

beforeEach(() => insertAuditRow.mockClear());

describe("ids and cursors", () => {
  it("only a UUID is a message id", () => {
    expect(isMessageId(ID)).toBe(true);
    for (const bad of ["", "1", "../x", `${ID}x`, "'; drop table x;--", 5, null, undefined]) {
      expect(isMessageId(bad)).toBe(false);
    }
  });

  it("a cursor is trusted only in the exact microsecond shape the page produced", () => {
    expect(parseCursor("2026-10-31T12:00:00.123456Z")).toBe("2026-10-31T12:00:00.123456Z");
    for (const bad of ["2026-10-31", "2026-10-31T12:00:00.123Z", "now()", "2026-10-31T12:00:00.123456Z'; --", null, 3]) {
      expect(parseCursor(bad)).toBeNull();
    }
  });
});

describe("listMessages", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: ID,
    createdAt: new Date("2026-10-31T12:00:00Z"),
    topic: "signing_in",
    status: "new",
    name: "Pat Example",
    head: "Short note",
    clearedAt: null,
    cursor: "2026-10-31T12:00:00.000001Z",
    ...over,
  });

  it("reads limit + 1 and reports hasMore without a count", async () => {
    const limit = vi.fn();
    const rows = Array.from({ length: 26 }, (_, i) => row({ id: `${ID.slice(0, -2)}${String(i).padStart(2, "0")}` }));
    const { exec } = fakeExec({ selects: [rows], spy: { limit } });
    const page = await listMessages({ status: "new" }, exec);
    expect(limit).toHaveBeenCalledWith(26);
    expect(page.rows).toHaveLength(25);
    expect(page.hasMore).toBe(true);
  });

  it("is not 'more' when the page is not full", async () => {
    const { exec } = fakeExec({ selects: [[row()]] });
    const page = await listMessages({ status: "all" }, exec);
    expect(page.hasMore).toBe(false);
    expect(page.rows[0]).toMatchObject({ id: ID, cleared: false, cursor: "2026-10-31T12:00:00.000001Z" });
  });

  it("caps a requested limit", async () => {
    const limit = vi.fn();
    const { exec } = fakeExec({ selects: [[]], spy: { limit } });
    await listMessages({ status: "new", limit: 5000 }, exec);
    expect(limit).toHaveBeenCalledWith(101);
  });

  it("collapses whitespace and cuts the excerpt by characters, not UTF-16 units", async () => {
    const long = `${"a\n\n  b ".repeat(5)}${"\u{1F600}".repeat(EXCERPT_CHARS)}`;
    const { exec } = fakeExec({ selects: [[row({ head: long })]] });
    const { rows } = await listMessages({ status: "new" }, exec);
    const excerpt = rows[0]!.excerpt!;
    expect(excerpt).not.toMatch(/\s{2}|\n/);
    expect(Array.from(excerpt)).toHaveLength(EXCERPT_CHARS + 1);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("a cleared message has no excerpt and is marked cleared", async () => {
    const { exec } = fakeExec({
      selects: [[row({ head: null, name: null, clearedAt: new Date("2026-10-31T13:00:00Z") })]],
    });
    const { rows } = await listMessages({ status: "handled" }, exec);
    expect(rows[0]).toMatchObject({ excerpt: null, name: null, cleared: true });
  });
});

describe("readMessage", () => {
  it("a non-UUID is null without touching the database", async () => {
    const exec = vi.fn();
    expect(await readMessage("not-an-id", exec as never)).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it("no row is null; a row carries the cleared flag", async () => {
    expect(await readMessage(ID, fakeExec({ selects: [[]] }).exec)).toBeNull();
    const detail = await readMessage(
      ID,
      fakeExec({ selects: [[{ id: ID, clearedAt: new Date("2026-10-31T13:00:00Z"), name: null }]] }).exec,
    );
    expect(detail).toMatchObject({ id: ID, cleared: true });
  });
});

describe("setMessageStatus", () => {
  it("is not_found for a missing row or a bad id, and writes nothing", async () => {
    const f = fakeExec({ selects: [[]] });
    expect(await setMessageStatus(ACTOR, ID, "handled", f.exec)).toEqual({ ok: false, reason: "not_found" });
    expect(await setMessageStatus(ACTOR, "nope", "handled", f.exec)).toEqual({ ok: false, reason: "not_found" });
    expect(f.tx.update).not.toHaveBeenCalled();
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  it("changes the status, names the operator, and writes ONE audit row of ids and statuses", async () => {
    const f = fakeExec({ selects: [[{ status: "new", clearedAt: null }]] });
    expect(await setMessageStatus(ACTOR, ID, "handled", f.exec)).toEqual({ ok: true });
    expect(f.set).toHaveBeenCalledWith({ status: "handled", statusChangedBy: ACTOR.userId });
    expect(insertAuditRow).toHaveBeenCalledTimes(1);
    expect(insertAuditRow.mock.calls[0]![1]).toEqual({
      action: "help_contact.status_changed",
      actor: ACTOR,
      resourceType: "help_contact_message",
      resourceId: ID,
      metadata: { messageId: ID, from: "new", to: "handled" },
    });
  });

  it("a change to the status it already has writes nothing", async () => {
    const f = fakeExec({ selects: [[{ status: "spam", clearedAt: null }]] });
    expect(await setMessageStatus(ACTOR, ID, "spam", f.exec)).toEqual({ ok: true });
    expect(f.tx.update).not.toHaveBeenCalled();
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  it("a cleared message cannot go back to new", async () => {
    const f = fakeExec({ selects: [[{ status: "handled", clearedAt: new Date() }]] });
    expect(await setMessageStatus(ACTOR, ID, "new", f.exec)).toEqual({ ok: false, reason: "cleared_cannot_be_new" });
    expect(f.tx.update).not.toHaveBeenCalled();
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  it("a cleared message may still move between handled and spam", async () => {
    const f = fakeExec({ selects: [[{ status: "handled", clearedAt: new Date() }]] });
    expect(await setMessageStatus(ACTOR, ID, "spam", f.exec)).toEqual({ ok: true });
    expect(insertAuditRow).toHaveBeenCalledTimes(1);
  });

  it("an audit failure fails the change (the audit row shares the transaction)", async () => {
    insertAuditRow.mockRejectedValueOnce(new Error("audit down"));
    const f = fakeExec({ selects: [[{ status: "new", clearedAt: null }]] });
    await expect(setMessageStatus(ACTOR, ID, "handled", f.exec)).rejects.toThrow("audit down");
  });
});

describe("clearMessageDetails", () => {
  it("is refused for a missing row, an already cleared row and a new row, writing nothing", async () => {
    for (const [selects, reason] of [
      [[[]], "not_found"],
      [[[{ status: "handled", clearedAt: new Date() }]], "already_cleared"],
      [[[{ status: "new", clearedAt: null }]], "needs_triage"],
    ] as const) {
      const f = fakeExec({ selects: selects as unknown as unknown[][] });
      expect(await clearMessageDetails(ACTOR, ID, f.exec)).toEqual({ ok: false, reason });
      expect(f.tx.update).not.toHaveBeenCalled();
    }
    expect(insertAuditRow).not.toHaveBeenCalled();
  });

  it("nulls all four personal fields, names the operator, and audits ids and the status only", async () => {
    const f = fakeExec({ selects: [[{ status: "spam", clearedAt: null }]] });
    expect(await clearMessageDetails(ACTOR, ID, f.exec)).toEqual({ ok: true });
    expect(f.set).toHaveBeenCalledWith({
      name: null,
      email: null,
      congregation: null,
      message: null,
      clearedBy: ACTOR.userId,
    });
    expect(insertAuditRow).toHaveBeenCalledTimes(1);
    const input = insertAuditRow.mock.calls[0]![1];
    expect(input.action).toBe("help_contact.details_cleared");
    expect(input.metadata).toEqual({ messageId: ID, status: "spam" });
  });
});
