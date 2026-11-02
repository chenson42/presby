/**
 * Orchestration tests for `updatePersonAction`. Mocked at the `@/lib/people`
 * boundary — SQL correctness is proven by `people-update.test.ts` against a
 * real Postgres connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockUpdatePerson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/people", () => ({
  updatePerson: (...args: unknown[]) => mockUpdatePerson(...args),
}));

const mockRecordRollAction = vi.hoisted(() => vi.fn());
const mockRecordParticipantAction = vi.hoisted(() => vi.fn());
const mockVoidParticipantAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/roll", () => ({
  recordRollAction: (...args: unknown[]) => mockRecordRollAction(...args),
  recordParticipantAction: (...args: unknown[]) => mockRecordParticipantAction(...args),
  voidParticipantAction: (...args: unknown[]) => mockVoidParticipantAction(...args),
}));

const mockSend = vi.hoisted(() => vi.fn());
const mockResend = vi.hoisted(() => vi.fn());
const mockRevokeSignIn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/org-invite", () => ({
  sendSignInInvitation: (...args: unknown[]) => mockSend(...args),
  resendSignInInvitation: (...args: unknown[]) => mockResend(...args),
  revokeSignInInvitation: (...args: unknown[]) => mockRevokeSignIn(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PARTICIPANT_RECORD_REFUSALS,
  PARTICIPANT_VOID_REFUSALS,
} from "@/lib/roll-action-kinds";
import { PARTICIPANT_COPY } from "../../participant-copy";
import {
  recordRollActionAction,
  removeParticipantAction,
  resendSignInInvitationAction,
  revokeSignInInvitationAction,
  sendSignInInvitationAction,
  undoParticipantEntryAction,
  updatePersonAction,
} from "./actions";

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

const UPDATE_INPUT = {
  personId: "p-1",
  identity: { firstName: "Nora", lastName: "Ashgrove" },
  contact: {},
  household: { mode: "none" as const },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("updatePersonAction", () => {
  it("not signed in returns an error without calling updatePerson", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockUpdatePerson).not.toHaveBeenCalled();
  });

  it("no org access returns an error without calling updatePerson", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
    expect(result.ok).toBe(false);
    expect(mockUpdatePerson).not.toHaveBeenCalled();
  });

  describe("with a resolved session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(SESSION);
      mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    });

    it("passes resolved personId/organizationId to updatePerson (not the client's own claims)", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "ok" });
      await updatePersonAction("alder-creek", UPDATE_INPUT);
      expect(mockUpdatePerson).toHaveBeenCalledWith(
        "person-1",
        "org-1",
        UPDATE_INPUT,
        // The audit actor is the SESSION's user, never anything in the input.
        { userId: "user-1", email: "clerk@example.invalid" },
      );
    });

    it("takes the audit actor from the session even when the input names another", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "ok" });
      await updatePersonAction("alder-creek", {
        ...UPDATE_INPUT,
        actor: { userId: "someone-else", email: "forged@example.invalid" },
      } as typeof UPDATE_INPUT);
      expect(mockUpdatePerson.mock.calls[0]![3]).toEqual({
        userId: "user-1",
        email: "clerk@example.invalid",
      });
      expect(JSON.stringify(mockUpdatePerson.mock.calls[0]![2])).not.toContain("forged");
    });

    describe("email rows", () => {
      const ROW = {
        value: "nora.work@example.invalid",
        subtype: "work" as const,
        isPrimary: true,
        doNotContact: false,
      };
      const EMAILS = {
        rows: [ROW],
        knownIds: ["11111111-1111-4111-8111-111111111111"],
      };
      const withEmails = (emails: unknown) =>
        ({ ...UPDATE_INPUT, contact: { emails } }) as unknown as typeof UPDATE_INPUT;

      it("rebuilds the rows from the known fields and passes them to updatePerson", async () => {
        mockUpdatePerson.mockResolvedValueOnce({ kind: "ok" });
        await updatePersonAction(
          "alder-creek",
          withEmails({ ...EMAILS, rows: [{ ...ROW, evil: "<script>" }] }),
        );
        // `.strict()` rejects the stray property, so this must NOT have been called.
        expect(mockUpdatePerson).not.toHaveBeenCalled();

        await updatePersonAction("alder-creek", withEmails(EMAILS));
        expect(mockUpdatePerson.mock.calls[0]![2].contact).toEqual({ emails: EMAILS });
      });

      it("leaves emails out entirely when the caller omitted them (addresses are never wiped)", async () => {
        mockUpdatePerson.mockResolvedValueOnce({ kind: "ok" });
        await updatePersonAction("alder-creek", UPDATE_INPUT);
        expect(mockUpdatePerson.mock.calls[0]![2].contact).not.toHaveProperty("emails");
      });

      it("a malformed post is refused before updatePerson with a Copy string", async () => {
        const bad = await updatePersonAction("alder-creek", withEmails({ rows: "nope", knownIds: [] }));
        expect(bad).toEqual({ ok: false, error: "Enter a valid email address." });
        const tooMany = await updatePersonAction(
          "alder-creek",
          withEmails({ rows: Array.from({ length: 21 }, () => ROW), knownIds: [] }),
        );
        expect(tooMany).toEqual({ ok: false, error: "A person can have up to 10 email addresses." });
        const badId = await updatePersonAction(
          "alder-creek",
          withEmails({ rows: [{ ...ROW, id: "not-a-uuid" }], knownIds: [] }),
        );
        expect(badId.ok).toBe(false);
        expect(mockUpdatePerson).not.toHaveBeenCalled();
      });

      it("email_refused maps each reason to its Copy string", async () => {
        const cases: Array<[string, string]> = [
          ["invalid_shape", "Enter a valid email address."],
          ["too_long", "That email address is too long. Use 254 characters or fewer."],
          ["duplicate", "This address is already in the list."],
          ["too_many", "A person can have up to 10 email addresses."],
          ["multiple_primary", "Choose one main address."],
          [
            "emails_changed",
            "This person's email addresses changed while you were editing. Reload the page to see the current list. Nothing was saved.",
          ],
        ];
        for (const [reason, copy] of cases) {
          mockUpdatePerson.mockResolvedValueOnce({ kind: "email_refused", refusal: { reason } });
          const result = await updatePersonAction("alder-creek", withEmails(EMAILS));
          expect(result, reason).toEqual({ ok: false, error: copy });
        }
        expect(mockRevalidatePath).not.toHaveBeenCalled();
      });

      it("a thrown database error is the one fixed message, logged by class only", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const err = Object.assign(
          new Error('duplicate key value violates unique constraint "x" (nora.work@example.invalid)'),
          { code: "23505" },
        );
        mockUpdatePerson.mockRejectedValueOnce(err);
        const result = await updatePersonAction("alder-creek", withEmails(EMAILS));
        expect(result).toEqual({
          ok: false,
          error: "We couldn't save. Nothing was changed. Try again.",
        });
        const logged = JSON.stringify(spy.mock.calls);
        expect(logged).toContain("Error/23505");
        expect(logged).not.toContain("nora.work@example.invalid");
        expect(logged).not.toContain("violates");
        spy.mockRestore();
      });

      it("ok carries the library's notes back to the form", async () => {
        const notes = { promoted: { address: "next@example.invalid" } };
        mockUpdatePerson.mockResolvedValueOnce({ kind: "ok", notes });
        const result = await updatePersonAction("alder-creek", withEmails(EMAILS));
        expect(result).toEqual({ ok: true, data: { personId: "p-1", notes } });
      });
    });

    it("forbidden → ok:false, no revalidate", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "forbidden" });
      const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
      expect(result.ok).toBe(false);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("not_found → ok:false", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "not_found" });
      const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/could not be found/i);
      }
    });

    it("invalid_household → ok:false", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "invalid_household" });
      const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/household/i);
      }
    });

    it("ok → returns personId, revalidates the members list and the person's directory page", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "ok" });
      const result = await updatePersonAction("alder-creek", UPDATE_INPUT);

      expect(result).toEqual({ ok: true, data: { personId: "p-1" } });
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/o/alder-creek/admin/community",
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory");
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/o/alder-creek/directory/p-1",
      );
    });
  });
});

const PERSON_ID = "c0000000-0000-0000-0000-00000000a001";
const ACTION_ID = "c0000000-0000-0000-0000-00000000b001";
const FUTURE = "2999-01-01";

const ROLL_ACTION_INPUT = {
  personId: PERSON_ID,
  kind: "restoration" as const,
  effectiveDate: "2026-06-01",
};

const RECORD_OK = {
  kind: "ok" as const,
  rollActionId: "ra-1",
  effect: "pending" as const,
  affectsFiledPeriod: false,
  shadowedBy: null,
};

describe("recordRollActionAction", () => {
  it("not signed in returns an error without calling recordRollAction", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockRecordRollAction).not.toHaveBeenCalled();
  });

  it("no org access returns an error without calling recordRollAction", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
    expect(result.ok).toBe(false);
    expect(mockRecordRollAction).not.toHaveBeenCalled();
  });

  describe("with a resolved session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(SESSION);
      mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    });

    it("passes resolved personId/organizationId/actingUserId to recordRollAction (not the client's own claims), with the acting email for the audit row", async () => {
      mockRecordRollAction.mockResolvedValueOnce(RECORD_OK);
      await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(mockRecordRollAction).toHaveBeenCalledWith(
        "person-1",
        "org-1",
        "user-1",
        {
          personId: PERSON_ID,
          kind: "restoration",
          effectiveDate: "2026-06-01",
          minuteReference: undefined,
        },
        { actingUserEmail: "clerk@example.invalid" },
      );
    });

    it("forged extra properties on the payload never reach the lib (rebuilt from known fields) — regression for a client smuggling an approval flag", async () => {
      mockRecordRollAction.mockResolvedValueOnce(RECORD_OK);
      await recordRollActionAction("alder-creek", {
        ...ROLL_ACTION_INPUT,
        approvalStatus: "approved",
        approvedBy: "user-9",
        takeEffectOnRecord: true,
        organizationId: "org-evil",
      } as unknown as typeof ROLL_ACTION_INPUT);
      const passed = mockRecordRollAction.mock.calls[0]![3] as Record<string, unknown>;
      expect(Object.keys(passed).sort()).toEqual(
        ["effectiveDate", "kind", "minuteReference", "personId"],
      );
    });

    it("a membership kind is forwarded as-is: the lib, not the client, decides it is pending", async () => {
      mockRecordRollAction.mockResolvedValueOnce(RECORD_OK);
      const result = await recordRollActionAction("alder-creek", {
        ...ROLL_ACTION_INPUT,
        kind: "profession_of_faith",
      });
      expect(mockRecordRollAction.mock.calls[0]![3]).toMatchObject({ kind: "profession_of_faith" });
      expect(result).toMatchObject({ ok: true, data: { effect: "pending" } });
    });

    it("forbidden → ok:false with the table copy, no revalidate", async () => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "forbidden" });
      const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(result).toEqual({ ok: false, error: PARTICIPANT_COPY.forbidden });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("not_found → ok:false", async () => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "not_found" });
      const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(result).toEqual({ ok: false, error: PARTICIPANT_COPY.person_not_found });
    });

    it("invalid_kind → ok:false", async () => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "invalid_kind" });
      const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(result).toEqual({ ok: false, error: PARTICIPANT_COPY.invalid_kind });
    });

    it.each([...PARTICIPANT_RECORD_REFUSALS])("refused %s → its copy", async (reason) => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "refused", reason });
      const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(result).toEqual({ ok: false, error: PARTICIPANT_COPY[reason] });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("a non-UUID person id, a malformed date and an over-long minute reference are messages, not lib throws", async () => {
      const badId = await recordRollActionAction("alder-creek", { ...ROLL_ACTION_INPUT, personId: "p-1" });
      expect(badId).toEqual({ ok: false, error: PARTICIPANT_COPY.person_not_found });
      const badDate = await recordRollActionAction("alder-creek", { ...ROLL_ACTION_INPUT, effectiveDate: "03/01/2026" });
      expect(badDate.ok).toBe(false);
      const badDate2 = await recordRollActionAction("alder-creek", { ...ROLL_ACTION_INPUT, effectiveDate: "2026-02-30" });
      expect(badDate2.ok).toBe(false);
      const longMinute = await recordRollActionAction("alder-creek", { ...ROLL_ACTION_INPUT, minuteReference: "x".repeat(201) });
      expect(longMinute.ok).toBe(false);
      expect(mockRecordRollAction).not.toHaveBeenCalled();
    });

    it("a proposal may be dated ahead (the Session decides it); the lib is still called", async () => {
      mockRecordRollAction.mockResolvedValueOnce(RECORD_OK);
      const result = await recordRollActionAction("alder-creek", { ...ROLL_ACTION_INPUT, effectiveDate: FUTURE });
      expect(result.ok).toBe(true);
    });

    it("ok → returns the effect, filed-period flag and shadow warning; revalidates the list, the pending worklist and the person's edit page", async () => {
      mockRecordRollAction.mockResolvedValueOnce({
        ...RECORD_OK,
        effect: "recorded",
        affectsFiledPeriod: true,
        shadowedBy: { kind: "profession_of_faith", effectiveDate: "2026-09-01" },
      });
      const result = await recordRollActionAction("alder-creek", {
        ...ROLL_ACTION_INPUT,
        kind: "other_participant_enrolled",
      });

      expect(result).toEqual({
        ok: true,
        data: {
          rollActionId: "ra-1",
          effect: "recorded",
          affectsFiledPeriod: true,
          shadowed: { kind: "profession_of_faith", effectiveDate: "2026-09-01" },
        },
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/community");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/community/pending");
    });
  });
});

describe("removeParticipantAction", () => {
  const INPUT = { personId: PERSON_ID, effectiveDate: "2026-06-01" };
  const OK = { kind: "ok" as const, rollActionId: "ra-9", membershipEnded: true, affectsFiledPeriod: false };

  it("not signed in / no org access: nothing is called", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await removeParticipantAction("alder-creek", INPUT)).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "not-found" });
    expect((await removeParticipantAction("alder-creek", INPUT)).ok).toBe(false);
    expect(mockRecordParticipantAction).not.toHaveBeenCalled();
  });

  describe("with a resolved session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(SESSION);
      mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    });

    it("always records the REMOVAL kind, with the resolved ids and the email for the audit row — the kind is never read from the client", async () => {
      mockRecordParticipantAction.mockResolvedValueOnce(OK);
      await removeParticipantAction("alder-creek", {
        ...INPUT,
        minuteReference: " Session 2026-06-01 ",
        kind: "other_participant_enrolled",
      } as typeof INPUT);
      expect(mockRecordParticipantAction).toHaveBeenCalledWith(
        "person-1",
        "org-1",
        "user-1",
        {
          personId: PERSON_ID,
          kind: "other_participant_removed",
          effectiveDate: "2026-06-01",
          minuteReference: "Session 2026-06-01",
        },
        { actingUserEmail: "clerk@example.invalid" },
      );
    });

    it("rejects a future date, an impossible date, a non-UUID id and a long minute reference before the lib", async () => {
      for (const bad of [
        { ...INPUT, effectiveDate: FUTURE },
        { ...INPUT, effectiveDate: "2026-02-30" },
        { ...INPUT, effectiveDate: "yesterday" },
        { ...INPUT, personId: "not-a-uuid" },
        { ...INPUT, minuteReference: "m".repeat(201) },
      ]) {
        expect((await removeParticipantAction("alder-creek", bad)).ok).toBe(false);
      }
      expect(mockRecordParticipantAction).not.toHaveBeenCalled();
    });

    it("forbidden → the permission copy", async () => {
      mockRecordParticipantAction.mockResolvedValueOnce({ kind: "forbidden" });
      expect(await removeParticipantAction("alder-creek", INPUT)).toEqual({
        ok: false,
        error: PARTICIPANT_COPY.forbidden,
      });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it.each([...PARTICIPANT_RECORD_REFUSALS])("refused %s → its copy", async (reason) => {
      mockRecordParticipantAction.mockResolvedValueOnce({ kind: "refused", reason });
      expect(await removeParticipantAction("alder-creek", INPUT)).toEqual({
        ok: false,
        error: PARTICIPANT_COPY[reason],
      });
    });

    it("ok → ids and the filed-period flag; revalidates Community, the edit page and the Directory", async () => {
      mockRecordParticipantAction.mockResolvedValueOnce({ ...OK, affectsFiledPeriod: true });
      expect(await removeParticipantAction("alder-creek", INPUT)).toEqual({
        ok: true,
        data: { rollActionId: "ra-9", affectsFiledPeriod: true },
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/community");
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/o/alder-creek/admin/community/${PERSON_ID}/edit`);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory");
    });
  });
});

describe("undoParticipantEntryAction", () => {
  const INPUT = { rollActionId: ACTION_ID, reason: "Entered against the wrong person." };
  const OK = {
    kind: "ok" as const,
    voidRollActionId: "ra-v1",
    voidedActionId: ACTION_ID,
    voidedKind: "other_participant_removed" as const,
    membershipReopened: true,
    affectsFiledPeriod: false,
  };

  it("not signed in: nothing is called", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await undoParticipantEntryAction("alder-creek", INPUT)).ok).toBe(false);
    expect(mockVoidParticipantAction).not.toHaveBeenCalled();
  });

  describe("with a resolved session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(SESSION);
      mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    });

    it("passes the resolved ids, the trimmed reason and the audit email", async () => {
      mockVoidParticipantAction.mockResolvedValueOnce(OK);
      await undoParticipantEntryAction("alder-creek", { ...INPUT, reason: "  Wrong person.  " });
      expect(mockVoidParticipantAction).toHaveBeenCalledWith(
        "person-1",
        "org-1",
        "user-1",
        { rollActionId: ACTION_ID, reason: "Wrong person." },
        { actingUserEmail: "clerk@example.invalid" },
      );
    });

    it("a blank reason, an over-long reason and a non-UUID id are messages before the lib", async () => {
      expect(await undoParticipantEntryAction("alder-creek", { ...INPUT, reason: "   " })).toEqual({
        ok: false,
        error: PARTICIPANT_COPY.reason_required,
      });
      expect(await undoParticipantEntryAction("alder-creek", { ...INPUT, reason: "r".repeat(501) })).toEqual({
        ok: false,
        error: PARTICIPANT_COPY.reason_too_long,
      });
      expect(await undoParticipantEntryAction("alder-creek", { ...INPUT, rollActionId: "x" })).toEqual({
        ok: false,
        error: PARTICIPANT_COPY.action_not_found,
      });
      expect(mockVoidParticipantAction).not.toHaveBeenCalled();
    });

    it("a reason of exactly 500 characters is accepted", async () => {
      mockVoidParticipantAction.mockResolvedValueOnce(OK);
      expect((await undoParticipantEntryAction("alder-creek", { ...INPUT, reason: "r".repeat(500) })).ok).toBe(true);
    });

    it("forbidden → the permission copy", async () => {
      mockVoidParticipantAction.mockResolvedValueOnce({ kind: "forbidden" });
      expect(await undoParticipantEntryAction("alder-creek", INPUT)).toEqual({
        ok: false,
        error: PARTICIPANT_COPY.forbidden,
      });
    });

    it.each([...PARTICIPANT_VOID_REFUSALS])("refused %s → its copy", async (reason) => {
      mockVoidParticipantAction.mockResolvedValueOnce({ kind: "refused", reason });
      expect(await undoParticipantEntryAction("alder-creek", INPUT)).toEqual({
        ok: false,
        error: PARTICIPANT_COPY[reason],
      });
    });

    it("ok → reports what was undone and whether the membership reopened", async () => {
      mockVoidParticipantAction.mockResolvedValueOnce(OK);
      expect(await undoParticipantEntryAction("alder-creek", INPUT)).toEqual({
        ok: true,
        data: {
          voidRollActionId: "ra-v1",
          membershipReopened: true,
          affectsFiledPeriod: false,
          undoneKind: "other_participant_removed",
        },
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/community");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory");
    });
  });
});

// ---------------------------------------------------------------------------
// Sign-in invitations (Community Increment 2b, Batch B2; Phase 3 "Server
// actions"; F177; DECISION-189). Mocked at the org-invite boundary: the SQL, the
// rollback and the audit rows are proven in org-invite.test.ts and
// org-invite.db.test.ts. What this file pins is what the ACTION owns: where the
// organization, the acting person and the acting USER come from, what it will
// forward, and every refusal's sentence.
// ---------------------------------------------------------------------------

describe("sign-in invitation actions", () => {
  const SEND_INPUT = { personId: "p-1", confirmedAddress: "wendeline@example.invalid", acknowledged: false };
  const OK = {
    kind: "ok" as const,
    invitationId: "inv-1",
    expiresAt: new Date("2026-10-27T12:00:00Z"),
    delivery: "sent" as const,
    address: "wendeline@example.invalid",
    acknowledged: [],
  };

  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", email: "clerk@example.invalid" } });
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    mockSend.mockResolvedValue(OK);
    mockResend.mockResolvedValue(OK);
    mockRevokeSignIn.mockResolvedValue({ kind: "ok" });
  });

  const actions = [
    ["sendSignInInvitationAction", sendSignInInvitationAction, mockSend],
    ["resendSignInInvitationAction", resendSignInInvitationAction, mockResend],
  ] as const;

  describe.each(actions)("%s", (_name, action, lib) => {
    it("not signed in, or no access to this organization: nothing is called", async () => {
      mockAuth.mockResolvedValueOnce(null);
      expect(await action("alder-creek", SEND_INPUT)).toEqual({ ok: false, error: "You must be signed in to do that." });
      mockAuth.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
      expect(await action("alder-creek", SEND_INPUT)).toEqual({ ok: false, error: "You don't have access to that organization." });
      expect(lib).not.toHaveBeenCalled();
    });

    it("derives the organization, the acting person and the acting USER from the session and the slug, never from the input", async () => {
      await action("alder-creek", {
        ...SEND_INPUT,
        organizationId: "evil-org",
        actingPersonId: "evil-person",
        actingUserId: "evil-user",
      } as never);
      expect(mockResolveOrgContext).toHaveBeenCalledWith("user-1", "alder-creek");
      expect(lib).toHaveBeenCalledWith(
        { organizationId: "org-1", actingPersonId: "person-1", actingUserId: "user-1", actingUserEmail: "clerk@example.invalid" },
        { personId: "p-1", confirmedAddress: "wendeline@example.invalid", acknowledged: false },
      );
    });

    it("rebuilds the input from its known fields: a forged extra property cannot flow through, and a non-true acknowledgement is false", async () => {
      await action("alder-creek", { ...SEND_INPUT, acknowledged: "yes", to: "attacker@example.invalid", token: "x" } as never);
      expect((lib.mock.calls[0]![1] as Record<string, unknown>)).toEqual({
        personId: "p-1",
        confirmedAddress: "wendeline@example.invalid",
        acknowledged: false,
      });
    });

    it("a non-object input is not_found, with nothing called", async () => {
      expect(await action("alder-creek", null as never)).toEqual({ ok: false, error: "That person could not be found." });
      expect(lib).not.toHaveBeenCalled();
    });

    it("ok returns the address the DATABASE chose, an ISO expiry and the delivery, and revalidates the edit page, the lists, the pending page and Officers", async () => {
      expect(await action("alder-creek", SEND_INPUT)).toEqual({
        ok: true,
        data: { address: "wendeline@example.invalid", expiresAt: "2026-10-27T12:00:00.000Z", delivery: "sent" },
      });
      const paths = mockRevalidatePath.mock.calls.map((c) => c[0]);
      expect(paths).toEqual([
        "/o/alder-creek/admin/community/p-1/edit",
        "/o/alder-creek/admin/community",
        "/o/alder-creek/admin/community/pending",
        "/o/alder-creek/admin/officers",
      ]);
    });

    it("a refusal revalidates nothing", async () => {
      lib.mockResolvedValue({ kind: "refused", reason: "address_shared" });
      await action("alder-creek", SEND_INPUT);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("a queued delivery is reported as queued (never an error)", async () => {
      lib.mockResolvedValue({ ...OK, delivery: "queued" });
      expect(await action("alder-creek", SEND_INPUT)).toMatchObject({ ok: true, data: { delivery: "queued" } });
    });

    it("needs_acknowledgement is NOT an error: the dialog re-opens with the reasons the server found, and the error string is empty", async () => {
      lib.mockResolvedValue({ kind: "refused", reason: "needs_acknowledgement", ackReasons: ["do_not_contact"] });
      expect(await action("alder-creek", SEND_INPUT)).toEqual({ ok: false, error: "", needsAcknowledgement: ["do_not_contact"] });
    });

    it("a refusal names the person and the congregation from the server's own facts (Copy: {Name}, {Congregation})", async () => {
      lib.mockResolvedValue({ kind: "refused", reason: "already_signs_in", personName: "Wendeline Ashgrove" });
      expect(await action("alder-creek", SEND_INPUT)).toEqual({
        ok: false,
        error: 'Wendeline Ashgrove can already sign in. If they\'ve forgotten their password, they can use "Forgot password" on the sign-in page.',
      });
      lib.mockResolvedValue({ kind: "refused", reason: "membership_ended" });
      expect(await action("alder-creek", SEND_INPUT)).toEqual({
        ok: false,
        error: "This person's connection to Alder Creek Presbyterian Church has ended, so they can't be invited.",
      });
    });

    it("a cooldown carries whole minutes, rounded UP, both in the sentence and for the button", async () => {
      lib.mockResolvedValue({ kind: "refused", reason: "cooldown", nextResendAt: new Date(Date.now() + 61_000) });
      expect(await action("alder-creek", SEND_INPUT)).toEqual({
        ok: false,
        error: "You sent this a moment ago. You can send it again in 2 minutes.",
        retryAfterMinutes: 2,
      });
    });

    it.each([
      ["forbidden", { kind: "forbidden" }, "You don't have permission to invite people to sign in here."],
      ["totp_unavailable", { kind: "totp_unavailable" }, "We can't send invitations right now. Send us a support ticket."],
      ["link_origin_unavailable", { kind: "link_origin_unavailable" }, "We can't send invitations right now. Send us a support ticket."],
      ["db_error", { kind: "db_error" }, "We couldn't complete that just now. Try again."],
      ["a confirmation that is not an address", { kind: "invalid_input", field: "confirmedAddress" }, "The address on file changed while you were looking. Check it and send again."],
      ["not_found", { kind: "refused", reason: "not_found" }, "That person could not be found."],
      ["address_changed", { kind: "refused", reason: "address_changed" }, "The address on file changed while you were looking. Check it and send again."],
      ["already_pending", { kind: "refused", reason: "already_pending" }, "An invitation is already out. Send it again or cancel it."],
      ["rate_limited", { kind: "refused", reason: "rate_limited" }, "Too many invitations right now. Try again later."],
    ])("%s reads its Copy sentence", async (_n, result, message) => {
      lib.mockResolvedValue(result);
      expect(await action("alder-creek", SEND_INPUT)).toEqual({ ok: false, error: message });
    });
  });

  describe("revokeSignInInvitationAction", () => {
    it("not signed in / no access: nothing is called", async () => {
      mockAuth.mockResolvedValueOnce(null);
      expect(await revokeSignInInvitationAction("alder-creek", { personId: "p-1" })).toEqual({ ok: false, error: "You must be signed in to do that." });
      mockAuth.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
      expect(await revokeSignInInvitationAction("alder-creek", { personId: "p-1" })).toMatchObject({ ok: false });
      expect(mockRevokeSignIn).not.toHaveBeenCalled();
    });

    it("derives its context from the session and revalidates on ok", async () => {
      expect(await revokeSignInInvitationAction("alder-creek", { personId: "p-1", organizationId: "evil" } as never)).toEqual({ ok: true });
      expect(mockRevokeSignIn).toHaveBeenCalledWith(
        { organizationId: "org-1", actingPersonId: "person-1", actingUserId: "user-1", actingUserEmail: "clerk@example.invalid" },
        { personId: "p-1" },
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/community/p-1/edit");
    });

    it.each([
      [{ kind: "forbidden" }, "You don't have permission to invite people to sign in here."],
      [{ kind: "refused", reason: "not_open" }, "There's no open invitation to change. Reload the page."],
      [{ kind: "refused", reason: "not_found" }, "That person could not be found."],
      [{ kind: "db_error" }, "We couldn't complete that just now. Try again."],
    ])("maps %j and revalidates nothing", async (result, message) => {
      mockRevokeSignIn.mockResolvedValue(result);
      expect(await revokeSignInInvitationAction("alder-creek", { personId: "p-1" })).toEqual({ ok: false, error: message });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("a missing person id goes to the library as an empty string (which answers not_found with no round trip)", async () => {
      await revokeSignInInvitationAction("alder-creek", {} as never);
      expect(mockRevokeSignIn.mock.calls[0]![1]).toEqual({ personId: "" });
    });
  });
});
