/**
 * Orchestration tests for `matchPersonAction` / `createPersonAction`.
 * Mocked at the `@/lib/people` boundary — SQL correctness (F21's
 * `existing_member_elsewhere` catch-based gate, the composite-FK insert
 * ordering, the RLS regression) is proven by `people.test.ts` against a
 * real Postgres connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockMatchPerson = vi.hoisted(() => vi.fn());
const mockCreatePerson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/people", () => ({
  matchPerson: (...args: unknown[]) => mockMatchPerson(...args),
  createPerson: (...args: unknown[]) => mockCreatePerson(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARTICIPANT_RECORD_REFUSALS } from "@/lib/roll-action-kinds";
import { PARTICIPANT_COPY } from "../participant-copy";
import { createPersonAction, matchPersonAction } from "./actions";

const SESSION = { user: { id: "user-1", email: "clerk@example.invalid" } };
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

const CREATE_INPUT = {
  identity: {
    mode: "new" as const,
    firstName: "Nora",
    lastName: "Ashgrove",
  },
  contact: {},
  household: { mode: "none" as const },
  rollAction: {
    kind: "profession_of_faith" as const,
    effectiveDate: "2026-06-01",
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("matchPersonAction", () => {
  it("not signed in returns an error without calling matchPerson", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await matchPersonAction("alder-creek", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockMatchPerson).not.toHaveBeenCalled();
  });

  it("passes resolved personId/organizationId to matchPerson", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockMatchPerson.mockResolvedValueOnce({ kind: "ok", candidates: [] });

    await matchPersonAction("alder-creek", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });

    expect(mockMatchPerson).toHaveBeenCalledWith("person-1", "org-1", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });
  });

  it("forbidden → ok:false with a human message", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockMatchPerson.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await matchPersonAction("alder-creek", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });

    expect(result.ok).toBe(false);
  });

  it("ok → returns the candidates unmodified (minimal-disclosure passthrough)", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockMatchPerson.mockResolvedValueOnce({
      kind: "ok",
      candidates: [
        { personId: "p-1", displayName: "N. Ashgrove", confidence: "high" },
      ],
    });

    const result = await matchPersonAction("alder-creek", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        candidates: [
          { personId: "p-1", displayName: "N. Ashgrove", confidence: "high" },
        ],
      },
    });
  });
});

const OK_PENDING = {
  kind: "ok" as const,
  personId: "p-1",
  rollActionId: "ra-1",
  effect: "pending" as const,
  affectsFiledPeriod: false,
};

describe("createPersonAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("passes resolved personId/organizationId AND session.user.id to createPerson, plus the acting email for the audit row", async () => {
    mockCreatePerson.mockResolvedValueOnce(OK_PENDING);

    await createPersonAction("alder-creek", CREATE_INPUT);

    expect(mockCreatePerson).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      CREATE_INPUT,
      { actingUserEmail: "clerk@example.invalid" },
    );
  });

  it("not signed in / no org access: createPerson is never called", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await createPersonAction("alder-creek", CREATE_INPUT)).ok).toBe(false);
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
    expect((await createPersonAction("alder-creek", CREATE_INPUT)).ok).toBe(false);
    expect(mockCreatePerson).not.toHaveBeenCalled();
  });

  it("forbidden → ok:false, no revalidate", async () => {
    mockCreatePerson.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await createPersonAction("alder-creek", CREATE_INPUT);
    expect(result.ok).toBe(false);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("existing_member_elsewhere → ok:false with a human, non-technical message", async () => {
    mockCreatePerson.mockResolvedValueOnce({
      kind: "existing_member_elsewhere",
    });
    const result = await createPersonAction("alder-creek", CREATE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already belongs to another organization/i);
    }
  });

  it("already_here → its own message, never the 'another organization' one (F178)", async () => {
    mockCreatePerson.mockResolvedValueOnce({ kind: "already_here" });
    const result = await createPersonAction("alder-creek", CREATE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already in this community/i);
      expect(result.error).not.toMatch(/another organization/i);
    }
  });

  it("invalid_household → ok:false", async () => {
    mockCreatePerson.mockResolvedValueOnce({ kind: "invalid_household" });
    const result = await createPersonAction("alder-creek", CREATE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/household/i);
    }
  });

  it.each([...PARTICIPANT_RECORD_REFUSALS])("roll_refused %s → its copy, no revalidate", async (reason) => {
    mockCreatePerson.mockResolvedValueOnce({ kind: "roll_refused", reason });
    const result = await createPersonAction("alder-creek", CREATE_INPUT);
    expect(result).toEqual({ ok: false, error: PARTICIPANT_COPY[reason] });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("ok → returns personId/rollActionId/effect/filed flag, revalidates members list and pending worklist", async () => {
    mockCreatePerson.mockResolvedValueOnce({
      ...OK_PENDING,
      personId: "p-99",
      rollActionId: "ra-99",
    });

    const result = await createPersonAction("alder-creek", CREATE_INPUT);

    expect(result).toEqual({
      ok: true,
      data: {
        personId: "p-99",
        rollActionId: "ra-99",
        effect: "pending",
        affectsFiledPeriod: false,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/community",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/community/pending",
    );
  });

  describe("what the client may and may not ask for (forgery)", () => {
    it('rejects kind "none" (the Staff anchor) before createPerson', async () => {
      const result = await createPersonAction("alder-creek", {
        ...CREATE_INPUT,
        rollAction: { kind: "none" },
      });
      expect(result.ok).toBe(false);
      expect(mockCreatePerson).not.toHaveBeenCalled();
    });

    it.each(["baptized_member_enrolled", "other_participant_removed", "void", "opening_balance", "", "VISITOR", "staff"])(
      "rejects an unknown kind %j",
      async (kind) => {
        const result = await createPersonAction("alder-creek", {
          ...CREATE_INPUT,
          rollAction: { kind, effectiveDate: "2026-06-01" } as never,
        });
        expect(result.ok).toBe(false);
        expect(mockCreatePerson).not.toHaveBeenCalled();
      },
    );

    it("rejects a missing or non-object rollAction", async () => {
      expect((await createPersonAction("alder-creek", { ...CREATE_INPUT, rollAction: undefined as never })).ok).toBe(false);
      expect((await createPersonAction("alder-creek", { ...CREATE_INPUT, rollAction: "visitor" as never })).ok).toBe(false);
      expect(mockCreatePerson).not.toHaveBeenCalled();
    });

    it("profession_of_faith stays a proposal whatever else the payload claims: stray fields are dropped before createPerson", async () => {
      mockCreatePerson.mockResolvedValueOnce(OK_PENDING);
      await createPersonAction("alder-creek", {
        ...CREATE_INPUT,
        rollAction: {
          kind: "profession_of_faith",
          effectiveDate: "2026-06-01",
          approvalStatus: "approved",
          approvedBy: "user-9",
          takeEffectOnRecord: true,
          resultingRoll: "active",
        } as never,
      });
      const passed = mockCreatePerson.mock.calls[0]![3] as { rollAction: Record<string, unknown> };
      expect(Object.keys(passed.rollAction).sort()).toEqual(["effectiveDate", "kind", "minuteReference"]);
      expect(passed.rollAction.kind).toBe("profession_of_faith");
    });

    it("a participant enrolment dated after today is refused here (it takes effect on record); a proposal dated ahead is not", async () => {
      const participant = await createPersonAction("alder-creek", {
        ...CREATE_INPUT,
        rollAction: { kind: "other_participant_enrolled", effectiveDate: "2999-01-01" },
      });
      expect(participant.ok).toBe(false);
      expect(mockCreatePerson).not.toHaveBeenCalled();

      mockCreatePerson.mockResolvedValueOnce(OK_PENDING);
      const proposal = await createPersonAction("alder-creek", {
        ...CREATE_INPUT,
        rollAction: { kind: "profession_of_faith", effectiveDate: "2999-01-01" },
      });
      expect(proposal.ok).toBe(true);
    });

    it("malformed dates and over-long text are messages, not lib throws", async () => {
      for (const rollAction of [
        { kind: "profession_of_faith", effectiveDate: "06/01/2026" },
        { kind: "profession_of_faith", effectiveDate: "2026-02-30" },
        { kind: "profession_of_faith", effectiveDate: "2026-06-01", minuteReference: "m".repeat(201) },
        { kind: "visitor", firstVisitDate: "2026-02-30" },
        { kind: "visitor", firstVisitDate: "2999-01-01" },
        { kind: "visitor", howHeard: "h".repeat(201) },
      ]) {
        const result = await createPersonAction("alder-creek", { ...CREATE_INPUT, rollAction: rollAction as never });
        expect(result.ok, JSON.stringify(rollAction)).toBe(false);
      }
      const badBirth = await createPersonAction("alder-creek", {
        ...CREATE_INPUT,
        identity: { mode: "new", firstName: "Nora", lastName: "Ashgrove", dateOfBirth: "1990-13-45" },
      });
      expect(badBirth.ok).toBe(false);
      expect(mockCreatePerson).not.toHaveBeenCalled();
    });
  });

  describe("the visitor arm (DECISION-200)", () => {
    const VISITOR_OK = {
      kind: "ok" as const,
      personId: "p-7",
      rollActionId: null,
      effect: "none" as const,
      affectsFiledPeriod: false,
    };

    it("is accepted, with blanks dropped and values trimmed, and a null rollActionId is expected", async () => {
      mockCreatePerson.mockResolvedValueOnce(VISITOR_OK);
      const result = await createPersonAction("alder-creek", {
        ...CREATE_INPUT,
        rollAction: { kind: "visitor", firstVisitDate: " 2026-06-01 ", howHeard: "  a neighbor  " },
      });
      expect(result).toEqual({
        ok: true,
        data: { personId: "p-7", rollActionId: null, effect: "none", affectsFiledPeriod: false },
      });
      expect(mockCreatePerson.mock.calls[0]![3]).toMatchObject({
        rollAction: { kind: "visitor", firstVisitDate: "2026-06-01", howHeard: "a neighbor" },
      });
    });

    it("with no fields at all is accepted", async () => {
      mockCreatePerson.mockResolvedValueOnce(VISITOR_OK);
      const result = await createPersonAction("alder-creek", {
        ...CREATE_INPUT,
        rollAction: { kind: "visitor", firstVisitDate: "", howHeard: "   " },
      });
      expect(result.ok).toBe(true);
      expect(mockCreatePerson.mock.calls[0]![3]).toMatchObject({ rollAction: { kind: "visitor" } });
    });
  });

  it("a null rollActionId for a roll-bearing kind is an invariant break and throws", async () => {
    mockCreatePerson.mockResolvedValueOnce({ ...OK_PENDING, rollActionId: null });
    await expect(createPersonAction("alder-creek", CREATE_INPUT)).rejects.toThrow(/null rollActionId/);
  });
});
