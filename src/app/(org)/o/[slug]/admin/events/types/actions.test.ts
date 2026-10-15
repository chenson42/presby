/**
 * Orchestration tests for the five event-type Server Actions. Mocked at the
 * `@/lib/event-types` boundary - the SQL correctness (the `event_types.manage`
 * gate, validation, duplicate names, the fallback rules, ordering, the seed)
 * is proven by `src/lib/event-types.test.ts` against a real Postgres. What this
 * file pins is the contract the actions layer owns:
 *
 *   1. `organizationId` comes from a FRESH `resolveOrgContext(session.user.id,
 *      slug)`, never from client-supplied input.
 *   2. Every `EventTypesResult` kind maps to the right `ActionResult` copy.
 *   3. `revalidatePath` fires for BOTH the manager page and the calendar - on
 *      success only.
 *   4. NO AUDIT, ever (DECISION-161 ruling R7): the file never imports
 *      `@/lib/audit`, and contains no direct `db.` mutation.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {},
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mocks = vi.hoisted(() => ({
  createEventType: vi.fn(),
  updateEventType: vi.fn(),
  setEventTypeActive: vi.fn(),
  moveEventType: vi.fn(),
  seedStandardEventTypes: vi.fn(),
}));
vi.mock("@/lib/event-types", () => ({
  createEventType: (...a: unknown[]) => mocks.createEventType(...a),
  updateEventType: (...a: unknown[]) => mocks.updateEventType(...a),
  setEventTypeActive: (...a: unknown[]) => mocks.setEventTypeActive(...a),
  moveEventType: (...a: unknown[]) => mocks.moveEventType(...a),
  seedStandardEventTypes: (...a: unknown[]) => mocks.seedStandardEventTypes(...a),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import {
  createEventTypeAction,
  moveEventTypeAction,
  seedStandardEventTypesAction,
  setEventTypeActiveAction,
  updateEventTypeAction,
} from "./actions";

const SESSION = { user: { id: "user-platform-id-1", email: "clerk@example.invalid" } };
const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

const INPUT = { name: "Worship", color: "teal", icon: "Church" };

/** Every action, how to call it, which lib mock backs it, and what a success carries. */
const ACTIONS = [
  {
    name: "createEventTypeAction",
    call: () => createEventTypeAction("alder-creek", INPUT),
    lib: mocks.createEventType,
    libArgs: ["person-1", "org-1", "user-platform-id-1", INPUT],
    okData: { id: "t-1" },
    okResult: { ok: true, data: { id: "t-1" } },
  },
  {
    name: "updateEventTypeAction",
    call: () => updateEventTypeAction("alder-creek", { ...INPUT, id: "t-1" }),
    lib: mocks.updateEventType,
    libArgs: ["person-1", "org-1", "user-platform-id-1", { ...INPUT, id: "t-1" }],
    okData: { id: "t-1" },
    okResult: { ok: true, data: { id: "t-1" } },
  },
  {
    name: "setEventTypeActiveAction",
    call: () => setEventTypeActiveAction("alder-creek", "t-1", false),
    lib: mocks.setEventTypeActive,
    libArgs: ["person-1", "org-1", "user-platform-id-1", "t-1", false],
    okData: { id: "t-1" },
    okResult: { ok: true, data: { id: "t-1" } },
  },
  {
    name: "moveEventTypeAction",
    call: () => moveEventTypeAction("alder-creek", "t-1", "up"),
    lib: mocks.moveEventType,
    libArgs: ["person-1", "org-1", "user-platform-id-1", "t-1", "up"],
    okData: { id: "t-1" },
    okResult: { ok: true, data: { id: "t-1" } },
  },
  {
    name: "seedStandardEventTypesAction",
    call: () => seedStandardEventTypesAction("alder-creek"),
    lib: mocks.seedStandardEventTypes,
    libArgs: ["person-1", "org-1", "user-platform-id-1"],
    okData: { created: 5 },
    okResult: { ok: true, data: { created: 5 } },
  },
] as const;

afterEach(() => {
  vi.clearAllMocks();
  mockAuth.mockReset();
  mockResolveOrgContext.mockReset();
  for (const m of Object.values(mocks)) m.mockReset();
});

describe.each(ACTIONS)("$name", (action) => {
  it("not signed in: returns the sign-in error without resolving an org or calling the library", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await action.call()).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(action.lib).not.toHaveBeenCalled();
  });

  it("resolves the org from the session user and the slug argument only", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    action.lib.mockResolvedValueOnce({ kind: "ok", data: action.okData });
    await action.call();
    expect(mockResolveOrgContext).toHaveBeenCalledWith("user-platform-id-1", "alder-creek");
  });

  it("a non-ok org resolution is an access error and never reaches the library", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });
    expect(await action.call()).toEqual({ ok: false, error: "You don't have access to that organization." });
    expect(action.lib).not.toHaveBeenCalled();
  });

  it("passes the RESOLVED person, organization and acting user (never client ids) to the library", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    action.lib.mockResolvedValueOnce({ kind: "ok", data: action.okData });
    await action.call();
    expect(action.lib).toHaveBeenCalledWith(...action.libArgs);
  });

  describe("result mapping", () => {
    function signedIn() {
      mockAuth.mockResolvedValueOnce(SESSION);
      mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    }

    it("forbidden -> the permission copy; nothing revalidated", async () => {
      signedIn();
      action.lib.mockResolvedValueOnce({ kind: "forbidden" });
      expect(await action.call()).toEqual({
        ok: false,
        error: "You don't have permission to manage event types here.",
      });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("invalid_target -> 'That event type doesn't exist.'", async () => {
      signedIn();
      action.lib.mockResolvedValueOnce({ kind: "invalid_target" });
      expect(await action.call()).toEqual({ ok: false, error: "That event type doesn't exist." });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("invalid_input -> the library's message verbatim", async () => {
      signedIn();
      action.lib.mockResolvedValueOnce({
        kind: "invalid_input",
        message: "You already have an event type called 'Worship'.",
      });
      expect(await action.call()).toEqual({
        ok: false,
        error: "You already have an event type called 'Worship'.",
      });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("ok -> ok:true with the data, revalidating the manager page AND the calendar", async () => {
      signedIn();
      action.lib.mockResolvedValueOnce({ kind: "ok", data: action.okData });
      expect(await action.call()).toEqual(action.okResult);
      expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/events/types");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/calendar");
    });

    it("never writes an audit row, on any outcome (DECISION-161 R7)", async () => {
      for (const result of [
        { kind: "ok", data: action.okData },
        { kind: "forbidden" },
        { kind: "invalid_target" },
        { kind: "invalid_input", message: "x" },
      ]) {
        signedIn();
        action.lib.mockResolvedValueOnce(result);
        await action.call();
      }
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });
  });
});

describe("the file states R7 and carries no unaudited direct mutation (the check:audit tripwire's contract)", () => {
  const source = readFileSync(path.resolve(__dirname, "actions.ts"), "utf8");

  it("the header cites DECISION-161 and says there is no audit write", () => {
    const header = source.slice(0, source.indexOf("async function resolveActingIdentity"));
    expect(header).toContain("DECISION-161");
    expect(header).toMatch(/NO AUDIT WRITE/);
    expect(header).toContain("audit-exempt: DECISION-161");
  });

  it("does not import the audit module or make a direct db mutation", () => {
    expect(source).not.toMatch(/from\s+["']@\/lib\/audit["']/);
    // The header may MENTION recordAudit() (to say don't); the code may not call it.
    const code = source.slice(source.indexOf("async function resolveActingIdentity"));
    expect(code).not.toMatch(/\brecordAudit\b/);
    // Any direct mutation would need `// audit-exempt: DECISION-161` on the line above it.
    const lines = source.split("\n");
    lines.forEach((line, i) => {
      if (/\bdb\s*\.\s*(insert|update|delete|execute)\b/.test(line)) {
        expect(lines[i - 1] ?? "").toMatch(/\/\/\s*audit-exempt:\s*DECISION-161/);
      }
    });
  });
});
