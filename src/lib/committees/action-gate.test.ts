/**
 * The first steps of every committees Server Action (action-gate.ts), with the
 * session, the organization resolver and `revalidatePath` mocked (docs/work-log/
 * 2026-11-19-presbytery-committees.md, Phase 3 "API Contract: common body"). The
 * ORDER is the property under test: the Node-side second-factor recheck runs before
 * anything reads the organization; the organization and the acting person come from
 * the slug and the session; every id is a UUID before any SQL; and a store outcome
 * becomes one fixed `copy.ts` string, never database text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveOrgContext: vi.fn(),
  revalidatePath: vi.fn(),
  isFlagEnabled: vi.fn(),
}));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: mocks.isFlagEnabled }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: mocks.resolveOrgContext }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { finish, invalidResult, resolveCommitteesActor, serverEnv, tamperedResult } from "./action-gate";
import { GATE_COPY, REFUSAL } from "./copy";

const UUID = "00000000-0000-4000-8000-000000000001";
const ORG = { organizationId: "org-1", personId: "person-1", slug: "northern", name: "Northern Reach" };
const signedIn = { user: { id: "user-1", email: "clerk@example.invalid" } };
const stale2fa = { user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(signedIn);
  mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
  mocks.isFlagEnabled.mockResolvedValue(true);
});

describe("resolveCommitteesActor", () => {
  it("a signed-out caller is refused before the organization is read", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await resolveCommitteesActor("northern")).toEqual({
      ok: false,
      result: { ok: false, error: GATE_COPY.signedOut, kind: "unauthenticated" },
    });
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("a stale second factor gets the same string and is refused BEFORE the organization is read", async () => {
    mocks.auth.mockResolvedValue(stale2fa);
    expect(await resolveCommitteesActor("northern")).toEqual({
      ok: false,
      result: { ok: false, error: GATE_COPY.signedOut, kind: "two_factor_required" },
    });
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("a non-string slug, an unknown slug and an ended or missing relationship are all 'no access', not a leak", async () => {
    for (const slug of [undefined, 5, null]) {
      expect(await resolveCommitteesActor(slug), String(slug)).toMatchObject({ ok: false, result: { error: GATE_COPY.noAccess, kind: "forbidden" } });
    }
    for (const kind of ["not-found", "forbidden", "ended"]) {
      mocks.resolveOrgContext.mockResolvedValue({ kind });
      expect(await resolveCommitteesActor("northern"), kind).toMatchObject({ ok: false, result: { error: GATE_COPY.noAccess, kind: "forbidden" } });
    }
  });

  it("with org_portal.committees off, every action is refused with the page's flag-off sentence — regression for G1, the actions skipping the flag", async () => {
    mocks.isFlagEnabled.mockResolvedValue(false);
    expect(await resolveCommitteesActor("northern", { committeeId: UUID })).toEqual({
      ok: false,
      result: { ok: false, error: GATE_COPY.flagOff("Northern Reach"), kind: "forbidden" },
    });
    expect(mocks.isFlagEnabled).toHaveBeenCalledWith("org_portal.committees");
    expect(GATE_COPY.flagOff("Northern Reach")).toBe("Committees & Commissions isn't turned on for Northern Reach yet.");
  });

  it("the flag is read after the organization resolves (a non-member learns nothing) and before the ids are looked at", async () => {
    mocks.isFlagEnabled.mockResolvedValue(false);
    mocks.resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Northern Reach", organizationType: "presbytery" });
    expect(await resolveCommitteesActor("northern")).toMatchObject({ ok: false, result: { error: GATE_COPY.noAccess } });
    expect(mocks.isFlagEnabled).not.toHaveBeenCalled();
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
    expect(await resolveCommitteesActor("northern", { committeeId: "bad" })).toMatchObject({ ok: false, result: { kind: "forbidden" } });
  });

  it("every id must be a UUID or the answer is the one not_found string, before any SQL", async () => {
    for (const bad of ["not-a-uuid", "", undefined, null, 7, "00000000-0000-4000-8000-00000000000"]) {
      expect(await resolveCommitteesActor("northern", { committeeId: UUID, membershipId: bad }), String(bad)).toEqual({
        ok: false,
        result: { ok: false, error: REFUSAL.not_found, kind: "not_found" },
      });
    }
  });

  it("returns the organization and the acting person from the slug and the session, never from the client", async () => {
    const result = await resolveCommitteesActor("northern", { committeeId: UUID });
    expect(result).toMatchObject({
      ok: true,
      identity: {
        slug: "northern",
        ctx: { personId: "person-1", organizationId: "org-1", actor: { userId: "user-1", email: "clerk@example.invalid" } },
      },
    });
    expect(mocks.resolveOrgContext).toHaveBeenCalledWith("user-1", "northern");
  });

  it("serverEnv is the server's UTC day, injectable", () => {
    expect(serverEnv(new Date("2026-03-04T23:59:59Z"))).toEqual({ today: "2026-03-04" });
  });
});

describe("finish and the fixed results", () => {
  const identity = { slug: "northern", env: { today: "2026-03-04" }, ctx: { personId: "p", organizationId: "o", actor: { userId: "u", email: null } } };

  it("a write revalidates the list and the committee page and returns only the known data fields", () => {
    const result = finish(identity, UUID, { kind: "ok", data: { id: "x", seatsEnded: 2, newMembershipId: "n" } });
    expect(result).toEqual({ ok: true, data: { id: "x", seatsEnded: 2 } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/northern/admin/committees");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/o/northern/admin/committees/${UUID}`);
  });

  it("a create (no committee id yet) revalidates the new committee's own page; an unchanged result revalidates nothing", () => {
    finish(identity, null, { kind: "ok", data: { id: "new-id" } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/northern/admin/committees/new-id");
    mocks.revalidatePath.mockClear();
    expect(finish(identity, UUID, { kind: "ok", data: { id: "x", unchanged: true } })).toEqual({ ok: true, data: { id: "x", unchanged: true } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("a refusal is the fixed copy string for its kind, with the stored names it carries, and never database text", () => {
    expect(finish(identity, UUID, { kind: "refused", reason: "forbidden" })).toEqual({ ok: false, error: REFUSAL.forbidden, kind: "forbidden" });
    expect(finish(identity, UUID, { kind: "refused", reason: "duplicate_name", detail: { existingName: "Finance" } })).toEqual({
      ok: false,
      error: 'A committee named "Finance" already exists. Choose a different name.',
      kind: "duplicate_name",
    });
    expect(finish(identity, UUID, { kind: "refused", reason: "committee_dissolved", detail: { during: "edit" } })).toMatchObject({
      error: expect.stringContaining("kept as history"),
    });
    expect(finish(identity, UUID, { kind: "refused", reason: "save_failed" })).toEqual({ ok: false, error: REFUSAL.save_failed, kind: "save_failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("an invalid outcome carries its field; a failed parse and a tampered value are the generic shapes", () => {
    expect(finish(identity, UUID, { kind: "invalid", field: "effectiveOn", message: "That date isn't valid." })).toEqual({
      ok: false,
      error: "That date isn't valid.",
      field: "effectiveOn",
      kind: "invalid",
    });
    expect(invalidResult({ ok: false, errors: { name: "Name is required." }, field: "name", message: "Name is required." })).toEqual({
      ok: false,
      error: "Name is required.",
      field: "name",
      kind: "invalid",
    });
    expect(tamperedResult).toEqual({ ok: false, error: REFUSAL.save_failed, kind: "invalid" });
  });
});
