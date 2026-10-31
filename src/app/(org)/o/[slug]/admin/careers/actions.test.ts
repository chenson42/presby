/**
 * Server actions for /o/<slug>/admin/careers, with the lib mocked: this file
 * proves the PLUMBING (identity from the session, organization from the slug,
 * never from the form; the schema parse; the result-to-Copy mapping; the
 * revalidation) - docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Server
 * actions" and Copy S8. What the lib does to rows is `postings.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const mockResolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({ resolveOrgContext: mockResolve, OrgAccessError: class OrgAccessError extends Error {} }));
const mockRevalidate = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidate(...a) }));

const lib = vi.hoisted(() => ({
  createPosting: vi.fn(),
  updatePosting: vi.fn(),
  setPostingStatus: vi.fn(),
  movePosting: vi.fn(),
}));
vi.mock("@/lib/careers/postings", () => lib);

import { OrgAccessError } from "@/lib/authz";
import {
  createPostingAction,
  movePostingAction,
  setPostingStatusAction,
  updatePostingAction,
} from "./actions";

const USER = "00000000-0000-0000-0000-0000000000a1";
const ORG = "00000000-0000-0000-0000-0000000000b1";
const PERSON = "00000000-0000-0000-0000-0000000000c1";
const POSTING = "00000000-0000-0000-0000-0000000000d1";

const GOOD = {
  title: "Music Director",
  summary: "Lead our choirs.",
  location: "Fernwood",
  employmentType: "part_time" as const,
  payMinCents: 4500,
  payMaxCents: 6000,
  payUnit: "hour" as const,
  descriptionMd: "## Duties\n\nLead.",
  closingDate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER, email: "pat@example.invalid" } });
  mockResolve.mockResolvedValue({
    kind: "ok",
    org: { organizationId: ORG, personId: PERSON, name: "Fernwood", organizationType: "congregation", slug: "fernwood", platformStatus: "managed" },
  });
});

const FORBIDDEN = { ok: false, error: "You don't have permission to manage job openings." };

describe("identity", () => {
  it("no session: the lib is never called", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await createPostingAction("fernwood", GOOD)).toEqual(FORBIDDEN);
    expect(await updatePostingAction("fernwood", { ...GOOD, id: POSTING, version: 1 })).toEqual(FORBIDDEN);
    expect(await setPostingStatusAction("fernwood", { id: POSTING, version: 1, to: "published" })).toEqual(FORBIDDEN);
    expect(await movePostingAction("fernwood", { id: POSTING, direction: "up" })).toEqual(FORBIDDEN);
    expect(Object.values(lib).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it.each([["not-found"], ["forbidden"], ["ended"]])(
    "a slug that does not resolve for this user (%s) never reaches the lib",
    async (kind) => {
      mockResolve.mockResolvedValue({ kind });
      expect(await createPostingAction("someone-elses", GOOD)).toEqual(FORBIDDEN);
      expect(lib.createPosting).not.toHaveBeenCalled();
    },
  );

  it("resolves the slug for THIS user, and takes the organization and person from the resolution, not the input", async () => {
    lib.createPosting.mockResolvedValue({ kind: "ok", data: { id: POSTING } });
    await createPostingAction("fernwood", {
      ...GOOD,
      // A hostile client adds these; none can reach the lib.
      organizationId: "99999999-9999-9999-9999-999999999999",
      personId: "99999999-9999-9999-9999-999999999998",
      status: "published",
    } as typeof GOOD);
    expect(mockResolve).toHaveBeenCalledWith(USER, "fernwood");
    expect(lib.createPosting).toHaveBeenCalledTimes(1);
    const [person, org, actor, input] = lib.createPosting.mock.calls[0]!;
    expect(person).toBe(PERSON);
    expect(org).toBe(ORG);
    expect(actor).toEqual({ userId: USER, email: "pat@example.invalid" });
    expect(Object.keys(input as object)).not.toContain("organizationId");
    expect(Object.keys(input as object)).not.toContain("status");
  });

  it("a membership that ends between the resolve and the transaction is the forbidden message, not a crash", async () => {
    lib.createPosting.mockRejectedValue(new OrgAccessError("p", "o") as never);
    expect(await createPostingAction("fernwood", GOOD)).toEqual(FORBIDDEN);
  });

  it("any other thrown error is rethrown (an outage is not a validation message)", async () => {
    lib.createPosting.mockRejectedValue(new Error("db down"));
    await expect(createPostingAction("fernwood", GOOD)).rejects.toThrow("db down");
  });
});

describe("validation happens before the lib", () => {
  it("a bad create is the schema's own message and nothing is written", async () => {
    expect(await createPostingAction("fernwood", { ...GOOD, title: " " })).toEqual({ ok: false, error: "Enter a title." });
    expect(await createPostingAction("fernwood", { ...GOOD, closingDate: "2026-02-30" })).toEqual({ ok: false, error: "Enter a date." });
    expect(await createPostingAction("fernwood", { ...GOOD, payMinCents: 7000, payMaxCents: 6000 })).toEqual({
      ok: false,
      error: "The highest pay must be at least the lowest.",
    });
    expect(await createPostingAction("fernwood", { ...GOOD, slug: "Not Valid!" })).toEqual({
      ok: false,
      error: "Use letters, numbers and dashes only.",
    });
    expect(await createPostingAction("fernwood", { ...GOOD, summary: "x".repeat(301) })).toEqual({
      ok: false,
      error: "We couldn't save that. Try again.",
    });
    expect(await createPostingAction("fernwood", null as never)).toEqual({ ok: false, error: "We couldn't save that. Try again." });
    expect(lib.createPosting).not.toHaveBeenCalled();
  });

  it("update, status and move reject a malformed id or version, and a status of draft", async () => {
    expect((await updatePostingAction("fernwood", { ...GOOD, id: "x", version: 1 })).ok).toBe(false);
    expect((await updatePostingAction("fernwood", { ...GOOD, id: POSTING, version: 0 })).ok).toBe(false);
    expect((await setPostingStatusAction("fernwood", { id: POSTING, version: 1, to: "draft" as never })).ok).toBe(false);
    expect((await setPostingStatusAction("fernwood", { id: "x", version: 1, to: "closed" })).ok).toBe(false);
    expect((await movePostingAction("fernwood", { id: POSTING, direction: "sideways" as never })).ok).toBe(false);
    expect(Object.values(lib).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });
});

describe("result mapping (Copy S8)", () => {
  const cases: [string, unknown, string][] = [
    ["forbidden", { kind: "forbidden" }, "You don't have permission to manage job openings."],
    ["not_found", { kind: "not_found" }, "That job opening no longer exists."],
    ["feature_off", { kind: "feature_off", canManageFeatures: true }, "Job openings aren't turned on."],
    [
      "stale",
      { kind: "stale" },
      "This opening was changed by someone else after you opened it, so your changes were not saved. Reload the page to see what changed.",
    ],
    ["slug_taken", { kind: "slug_taken" }, "Another opening already uses that web address. Choose a different one."],
    ["incomplete (one)", { kind: "incomplete", missing: ["summary"] }, "Add a summary before publishing."],
    ["incomplete (two)", { kind: "incomplete", missing: ["summary", "location"] }, "Add a summary and location before publishing."],
    [
      "incomplete (all)",
      { kind: "incomplete", missing: ["title", "summary", "location", "description"] },
      "Add a title, summary, location and description before publishing.",
    ],
    [
      "closing date passed (publish)",
      { kind: "closing_date_passed", reopening: false },
      "The closing date has already passed. Change it before publishing.",
    ],
    [
      "closing date passed (reopen)",
      { kind: "closing_date_passed", reopening: true },
      "The closing date has already passed. Change it, save, then reopen.",
    ],
    [
      "publish_limit",
      { kind: "publish_limit" },
      "You already have 100 job openings published, which is the most we can show. Close one before publishing another.",
    ],
    [
      "invalid_transition",
      { kind: "invalid_transition" },
      "That can't be done to this opening right now. Reload the page and try again.",
    ],
    ["invalid_input", { kind: "invalid_input", field: "closingDate", message: "The closing date can't be in the past." }, "The closing date can't be in the past."],
  ];

  it.each(cases)("%s", async (_name, result, message) => {
    lib.setPostingStatus.mockResolvedValue(result);
    expect(await setPostingStatusAction("fernwood", { id: POSTING, version: 1, to: "published" })).toEqual({
      ok: false,
      error: message,
    });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("the same mapping serves create, update and move", async () => {
    lib.createPosting.mockResolvedValue({ kind: "slug_taken" });
    lib.updatePosting.mockResolvedValue({ kind: "stale" });
    lib.movePosting.mockResolvedValue({ kind: "not_found" });
    expect((await createPostingAction("fernwood", GOOD)).ok).toBe(false);
    expect(await updatePostingAction("fernwood", { ...GOOD, id: POSTING, version: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/changed by someone else/) });
    expect(await movePostingAction("fernwood", { id: POSTING, direction: "up" })).toEqual({ ok: false, error: "That job opening no longer exists." });
  });
});

describe("success", () => {
  it("create returns the id and revalidates the list", async () => {
    lib.createPosting.mockResolvedValue({ kind: "ok", data: { id: POSTING } });
    expect(await createPostingAction("fernwood", GOOD)).toEqual({ ok: true, data: { id: POSTING } });
    expect(mockRevalidate).toHaveBeenCalledWith("/o/fernwood/admin/careers");
  });

  it("update returns the new version and revalidates the list and the editor", async () => {
    lib.updatePosting.mockResolvedValue({ kind: "ok", data: { version: 4 } });
    expect(await updatePostingAction("fernwood", { ...GOOD, id: POSTING, version: 3 })).toEqual({ ok: true, data: { version: 4 } });
    expect(mockRevalidate).toHaveBeenCalledWith("/o/fernwood/admin/careers");
    expect(mockRevalidate).toHaveBeenCalledWith(`/o/fernwood/admin/careers/${POSTING}`);
    const input = lib.updatePosting.mock.calls[0]![3] as { id: string; version: number };
    expect(input.id).toBe(POSTING);
    expect(input.version).toBe(3);
  });

  it("status returns the RETURNED status (the toast reports it, not the request)", async () => {
    lib.setPostingStatus.mockResolvedValue({ kind: "ok", data: { status: "published", version: 2 } });
    expect(await setPostingStatusAction("fernwood", { id: POSTING, version: 1, to: "published" })).toEqual({
      ok: true,
      data: { status: "published", version: 2 },
    });
    expect(lib.setPostingStatus.mock.calls[0]![3]).toEqual({ id: POSTING, version: 1, to: "published" });
    expect(mockRevalidate).toHaveBeenCalledWith("/o/fernwood/admin/careers");
  });

  it("move returns moved and revalidates the list", async () => {
    lib.movePosting.mockResolvedValue({ kind: "ok", data: { moved: false } });
    expect(await movePostingAction("fernwood", { id: POSTING, direction: "down" })).toEqual({ ok: true, data: { moved: false } });
    expect(mockRevalidate).toHaveBeenCalledWith("/o/fernwood/admin/careers");
  });

  it("revalidates the RESOLVED slug, never the string the client posted", async () => {
    mockResolve.mockResolvedValue({
      kind: "ok",
      org: { organizationId: ORG, personId: PERSON, name: "Fernwood", organizationType: "congregation", slug: "fernwood", platformStatus: "managed" },
    });
    lib.createPosting.mockResolvedValue({ kind: "ok", data: { id: POSTING } });
    await createPostingAction("fernwood", GOOD);
    for (const call of mockRevalidate.mock.calls) expect(String(call[0])).toMatch(/^\/o\/fernwood\//);
  });
});
