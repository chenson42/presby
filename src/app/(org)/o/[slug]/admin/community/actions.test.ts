/**
 * Orchestration tests for the four Community engagement actions (Increment 3a,
 * Batch B; Phase 3 section 5, EC-9, EC-16, EC-26). Mocked at the
 * `@/lib/community-engagement` boundary: the SQL, the row lock and the audit row
 * are proven against a real Postgres in `community-engagement.db.test.ts`. What
 * this file pins is what the ACTION decides: who is asking, what is read from
 * the client (almost nothing), what each outcome says, and what a failure may
 * reveal.
 */
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const h = vi.hoisted(() => {
  class FakeOrgAccessError extends Error {}
  return { FakeOrgAccessError };
});
const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  OrgAccessError: h.FakeOrgAccessError,
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockChange = vi.hoisted(() => vi.fn());
const mockArchive = vi.hoisted(() => vi.fn());
const mockRestore = vi.hoisted(() => vi.fn());
const mockVisit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/community-engagement", () => ({
  changeEngagement: (...args: unknown[]) => mockChange(...args),
  archivePerson: (...args: unknown[]) => mockArchive(...args),
  restorePerson: (...args: unknown[]) => mockRestore(...args),
  updateVisitDetails: (...args: unknown[]) => mockVisit(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archivePersonAction,
  changeEngagementAction,
  restorePersonAction,
  updateVisitDetailsAction,
} from "./actions";
import {
  ARCHIVE_COPY,
  CHANGE_ENGAGEMENT_COPY,
  RESTORE_COPY,
  VISIT_DETAILS_COPY,
} from "./engagement-copy";

const SLUG = "alder-creek";
const PERSON = "40000000-0000-4000-8000-000000000004";
const SESSION = { user: { id: "user-1", email: "clerk@example.invalid" } };
const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: SLUG,
    platformStatus: "managed" as const,
  },
};
const ACTOR = { userId: "user-1", email: "clerk@example.invalid" };

const calls = {
  change: () => mockChange,
  archive: () => mockArchive,
  restore: () => mockRestore,
  visit: () => mockVisit,
};

const ACTIONS: Array<[string, () => Promise<unknown>, () => ReturnType<typeof vi.fn>]> = [
  ["changeEngagementAction", () => changeEngagementAction(SLUG, { personId: PERSON, to: "regular" }), calls.change],
  ["archivePersonAction", () => archivePersonAction(SLUG, { personId: PERSON }), calls.archive],
  ["restorePersonAction", () => restorePersonAction(SLUG, { personId: PERSON }), calls.restore],
  [
    "updateVisitDetailsAction",
    () => updateVisitDetailsAction(SLUG, { personId: PERSON, firstVisitDate: "2026-03-01", howHeard: "x" }),
    calls.visit,
  ],
];

beforeEach(() => {
  mockAuth.mockResolvedValue(SESSION);
  mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  mockChange.mockResolvedValue({ kind: "ok", from: "visitor", to: "regular", standingFrom: "visitor", standingTo: "listed", signInConnected: false });
  mockArchive.mockResolvedValue({ kind: "ok", engagement: "visitor", signInConnected: false });
  mockRestore.mockResolvedValue({ kind: "ok", engagement: "visitor", signInConnected: false });
  mockVisit.mockResolvedValue({ kind: "ok" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe.each(ACTIONS)("%s: authenticate, then authorize from the session and the slug", (_name, run, lib) => {
  it("signed out is refused and the library is never called", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await run()).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(lib()).not.toHaveBeenCalled();
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
  });

  it("a session with no user id is signed out", async () => {
    mockAuth.mockResolvedValueOnce({ user: {} });
    expect(await run()).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(lib()).not.toHaveBeenCalled();
  });

  it.each(["forbidden", "not-found", "ended"] as const)("a slug that resolves to %s is refused and the library is never called", async (kind) => {
    mockResolveOrgContext.mockResolvedValueOnce({ kind });
    expect(await run()).toEqual({ ok: false, error: "You don't have access to that organization." });
    expect(lib()).not.toHaveBeenCalled();
  });

  it("a non-string slug is refused before the resolver is asked", async () => {
    const result = await (
      {
        changeEngagementAction: () => changeEngagementAction(42 as never, { personId: PERSON, to: "regular" }),
        archivePersonAction: () => archivePersonAction(42 as never, { personId: PERSON }),
        restorePersonAction: () => restorePersonAction(42 as never, { personId: PERSON }),
        updateVisitDetailsAction: () =>
          updateVisitDetailsAction(42 as never, { personId: PERSON, firstVisitDate: null, howHeard: null }),
      } as Record<string, () => Promise<unknown>>
    )[_name]!();
    expect(result).toEqual({ ok: false, error: "You don't have access to that organization." });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(lib()).not.toHaveBeenCalled();
  });

  it("hands the library the resolved viewer and organization and the SESSION's actor, never the client's claims", async () => {
    await run();
    const args = lib().mock.calls[0]!;
    expect(args[0]).toBe("person-1");
    expect(args[1]).toBe("org-1");
    expect(args[3]).toEqual(ACTOR);
  });
});

describe("forged input (EC-9)", () => {
  it.each([null, undefined, "x", 3, [PERSON]])("a non-object input %j is `not found` and calls nothing", async (bad) => {
    expect(await changeEngagementAction(SLUG, bad as never)).toEqual({ ok: false, error: CHANGE_ENGAGEMENT_COPY.not_found });
    expect(await archivePersonAction(SLUG, bad as never)).toEqual({ ok: false, error: ARCHIVE_COPY.not_found });
    expect(await restorePersonAction(SLUG, bad as never)).toEqual({ ok: false, error: RESTORE_COPY.not_found });
    expect(await updateVisitDetailsAction(SLUG, bad as never)).toEqual({ ok: false, error: VISIT_DETAILS_COPY.not_found });
    for (const mock of [mockChange, mockArchive, mockRestore, mockVisit]) expect(mock).not.toHaveBeenCalled();
  });

  it.each(["", "not-a-uuid", "1; drop table people", 7, null, {}])("a non-UUID personId %j is `not found` and calls nothing", async (bad) => {
    expect(await changeEngagementAction(SLUG, { personId: bad as never, to: "regular" })).toEqual({ ok: false, error: CHANGE_ENGAGEMENT_COPY.not_found });
    expect(await archivePersonAction(SLUG, { personId: bad as never })).toEqual({ ok: false, error: ARCHIVE_COPY.not_found });
    expect(await restorePersonAction(SLUG, { personId: bad as never })).toEqual({ ok: false, error: RESTORE_COPY.not_found });
    expect(
      await updateVisitDetailsAction(SLUG, { personId: bad as never, firstVisitDate: null, howHeard: null }),
    ).toEqual({ ok: false, error: VISIT_DETAILS_COPY.not_found });
    for (const mock of [mockChange, mockArchive, mockRestore, mockVisit]) expect(mock).not.toHaveBeenCalled();
  });

  it.each(["staff", "unknown", "", "VISITOR", undefined, null, 3, ["regular"]])("a target engagement %j is not on the closed list: refused, nothing called", async (to) => {
    expect(await changeEngagementAction(SLUG, { personId: PERSON, to: to as never })).toEqual({
      ok: false,
      error: "That choice isn't available.",
    });
    expect(mockChange).not.toHaveBeenCalled();
  });

  it("the four editable targets are all accepted", async () => {
    for (const to of ["visitor", "regular", "inactive", "moved_away"]) {
      await changeEngagementAction(SLUG, { personId: PERSON, to });
    }
    expect(mockChange.mock.calls.map((c) => (c[2] as { to: string }).to)).toEqual(["visitor", "regular", "inactive", "moved_away"]);
  });

  it("extra fields (organizationId, from, actor, userId) are never read: the library gets exactly the rebuilt input", async () => {
    const forged = { personId: PERSON, to: "regular", organizationId: "org-evil", from: "staff", actor: { userId: "evil" }, userId: "evil" };
    await changeEngagementAction(SLUG, forged as never);
    await archivePersonAction(SLUG, { ...forged } as never);
    await restorePersonAction(SLUG, { ...forged } as never);
    await updateVisitDetailsAction(SLUG, { ...forged, firstVisitDate: null, howHeard: null } as never);

    expect(mockChange.mock.calls[0]![2]).toEqual({ personId: PERSON, to: "regular" });
    expect(mockArchive.mock.calls[0]![2]).toEqual({ personId: PERSON });
    expect(mockRestore.mock.calls[0]![2]).toEqual({ personId: PERSON });
    expect(mockVisit.mock.calls[0]![2]).toEqual({ personId: PERSON, firstVisitDate: null, howHeard: null });
    for (const mock of [mockChange, mockArchive, mockRestore, mockVisit]) {
      expect(mock.mock.calls[0]![0]).toBe("person-1");
      expect(mock.mock.calls[0]![1]).toBe("org-1");
      expect(mock.mock.calls[0]![3]).toEqual(ACTOR);
    }
  });

  it("the optional stale-guard is passed only when it is one of the five stored values", async () => {
    await changeEngagementAction(SLUG, { personId: PERSON, to: "regular", expectedFrom: "visitor" });
    expect(mockChange.mock.calls[0]![2]).toEqual({ personId: PERSON, to: "regular", expectedFrom: "visitor" });
    for (const bad of ["unknown", "", 3, null, {}]) {
      mockChange.mockClear();
      await changeEngagementAction(SLUG, { personId: PERSON, to: "regular", expectedFrom: bad as never });
      expect(mockChange.mock.calls[0]![2]).toEqual({ personId: PERSON, to: "regular" });
    }
  });

  it("visit details: a non-string field is `clear it`, never a coerced value", async () => {
    await updateVisitDetailsAction(SLUG, { personId: PERSON, firstVisitDate: 20260301 as never, howHeard: { a: 1 } as never });
    expect(mockVisit.mock.calls[0]![2]).toEqual({ personId: PERSON, firstVisitDate: null, howHeard: null });
  });
});

describe("changeEngagementAction: every outcome says its sentence", () => {
  it("ok returns from, to and the new standing, and revalidates the list, the edit page and the directory", async () => {
    expect(await changeEngagementAction(SLUG, { personId: PERSON, to: "regular" })).toEqual({
      ok: true,
      data: { from: "visitor", to: "regular", standingTo: "listed" },
    });
    expect(mockRevalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(
      [`/o/${SLUG}/admin/community`, `/o/${SLUG}/admin/community/${PERSON}/edit`, `/o/${SLUG}/directory`].sort(),
    );
  });

  it.each([
    ["unchanged", "That is already how this person is marked."],
    ["forbidden", "You don't have permission to change this."],
    ["not_found", "That person could not be found."],
    ["ended", "This person's connection here has ended, so this can't be changed."],
    ["staff_record", "This is a staff record, so engagement can't be changed."],
    ["needs_no_roll", "A person on the roll can't be marked as a visitor."],
    ["changed_meanwhile", "This changed while you were looking. Reload the page to see the current setting."],
  ] as const)("%s", async (kind, sentence) => {
    mockChange.mockResolvedValueOnce({ kind });
    expect(await changeEngagementAction(SLUG, { personId: PERSON, to: "regular" })).toEqual({ ok: false, error: sentence });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("archivePersonAction: every outcome says its sentence", () => {
  it("ok revalidates and returns the person", async () => {
    expect(await archivePersonAction(SLUG, { personId: PERSON })).toEqual({ ok: true, data: { personId: PERSON } });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/o/${SLUG}/admin/community`);
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/o/${SLUG}/admin/community/${PERSON}/edit`);
  });

  it.each([
    ["forbidden", "You don't have permission to archive people here."],
    ["not_found", "That person could not be found."],
    ["already_ended", "This person's connection here has already ended."],
    ["not_eligible", "Only visitors and people marked inactive or moved away can be archived. A member leaves through a roll action; a participant is removed as a participant."],
    ["self_target", "You can't archive your own record. Ask another administrator."],
    ["holds_position", "This person still holds an office, a role or a staff position here. End that first, then try again."],
    ["pending_action", "This person has a roll action waiting for the Session, so they can't be archived yet. Try again once the Session has decided it or it has been withdrawn."],
  ] as const)("%s", async (kind, sentence) => {
    mockArchive.mockResolvedValueOnce({ kind });
    expect(await archivePersonAction(SLUG, { personId: PERSON })).toEqual({ ok: false, error: sentence });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("restorePersonAction: every outcome says its sentence", () => {
  it.each([
    ["visitor", "visitors"],
    ["inactive", "inactive"],
    ["moved_away", "inactive"],
    ["regular", "inactive"],
  ] as const)("an archived %s returns to the %s list", async (engagement, list) => {
    mockRestore.mockResolvedValueOnce({ kind: "ok", engagement, signInConnected: true });
    expect(await restorePersonAction(SLUG, { personId: PERSON })).toEqual({ ok: true, data: { personId: PERSON, list } });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/o/${SLUG}/directory`);
  });

  it.each([
    ["forbidden", "You don't have permission to change this."],
    ["not_found", "That person could not be found."],
    ["not_archived", "That person wasn't archived here."],
    ["person_unavailable", "This person's record is marked deceased or merged, so they can't be restored."],
  ] as const)("%s", async (kind, sentence) => {
    mockRestore.mockResolvedValueOnce({ kind });
    expect(await restorePersonAction(SLUG, { personId: PERSON })).toEqual({ ok: false, error: sentence });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateVisitDetailsAction: every outcome says its sentence (EC-26)", () => {
  it("ok and unchanged are both a quiet success that revalidates", async () => {
    expect(await updateVisitDetailsAction(SLUG, { personId: PERSON, firstVisitDate: "2026-03-01", howHeard: "x" })).toEqual({
      ok: true,
      data: { personId: PERSON },
    });
    mockRevalidatePath.mockClear();
    mockVisit.mockResolvedValueOnce({ kind: "unchanged" });
    expect(await updateVisitDetailsAction(SLUG, { personId: PERSON, firstVisitDate: "2026-03-01", howHeard: "x" })).toEqual({
      ok: true,
      data: { personId: PERSON },
    });
    expect(mockRevalidatePath).toHaveBeenCalled();
  });

  it.each([
    ["forbidden", "You don't have permission to change this."],
    ["not_found", "That person could not be found."],
    ["ended", "This person's connection here has ended, so this can't be changed."],
    ["bad_date", "That date can't be used. Choose a date from 1900 up to today."],
    ["bad_text", "Keep this under 200 characters."],
  ] as const)("%s", async (kind, sentence) => {
    mockVisit.mockResolvedValueOnce({ kind });
    expect(await updateVisitDetailsAction(SLUG, { personId: PERSON, firstVisitDate: null, howHeard: null })).toEqual({
      ok: false,
      error: sentence,
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("a thrown error is logged by class only and shown as one fixed sentence (EC-16)", () => {
  const SECRET = "duplicate key value violates unique constraint (value: wendeline.ashgrove@example.invalid)";
  const dbError = () => Object.assign(new Error(SECRET), { code: "23505" });

  it.each([
    ["changeEngagementAction", () => changeEngagementAction(SLUG, { personId: PERSON, to: "regular" }), mockChange, "We couldn't save that change. Nothing was changed."],
    ["archivePersonAction", () => archivePersonAction(SLUG, { personId: PERSON }), mockArchive, "We couldn't archive them. Nothing was changed."],
    ["restorePersonAction", () => restorePersonAction(SLUG, { personId: PERSON }), mockRestore, "We couldn't restore them. Nothing was changed."],
    ["updateVisitDetailsAction", () => updateVisitDetailsAction(SLUG, { personId: PERSON, firstVisitDate: null, howHeard: "x" }), mockVisit, "We couldn't save that change. Nothing was changed."],
  ] as const)("%s", async (name, run, lib, sentence) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    lib.mockRejectedValueOnce(dbError());
    const result = (await run()) as { ok: false; error: string };
    expect(result).toEqual({ ok: false, error: sentence });
    expect(result.error).not.toContain("wendeline");
    expect(mockRevalidatePath).not.toHaveBeenCalled();

    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls[0]);
    expect(logged).toContain(name);
    expect(logged).toContain("Error/23505");
    expect(logged).not.toContain("wendeline");
    expect(logged).not.toContain("duplicate key");
  });

  it("an OrgAccessError (the membership ended between the page and the click) is `no access`, not a database error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockArchive.mockRejectedValueOnce(new h.FakeOrgAccessError("x"));
    expect(await archivePersonAction(SLUG, { personId: PERSON })).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("the actions hold no database call and write no audit row themselves", () => {
  it("is a 'use server' module whose only writes are library calls", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(`${__dirname}/actions.ts`, "utf8");
    expect(raw.startsWith('"use server";')).toBe(true);
    // Code only: the header comment names insertAuditRow to say the library owns it.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/\bdb\s*\.\s*(insert|update|delete|execute)\b/);
    expect(source).not.toMatch(/\bauditEvents\b|\brecordAudit\b|\binsertAuditRow\b/);
    expect(source).not.toMatch(/redirect\(/);
  });
});
