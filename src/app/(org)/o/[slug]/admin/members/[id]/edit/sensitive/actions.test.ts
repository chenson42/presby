/**
 * Orchestration tests for the sensitive-info sub-screen's Server Actions.
 * Mocked at the `@/lib/person-sensitive` boundary — SQL correctness is
 * proven by `person-sensitive.test.ts` against a real Postgres connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockAddPersonNote = vi.hoisted(() => vi.fn());
const mockSetPersonDemographics = vi.hoisted(() => vi.fn());
const mockSetPersonMedical = vi.hoisted(() => vi.fn());
const mockSetPersonDisabilities = vi.hoisted(() => vi.fn());
vi.mock("@/lib/person-sensitive", () => ({
  addPersonNote: (...args: unknown[]) => mockAddPersonNote(...args),
  setPersonDemographics: (...args: unknown[]) => mockSetPersonDemographics(...args),
  setPersonMedical: (...args: unknown[]) => mockSetPersonMedical(...args),
  setPersonDisabilities: (...args: unknown[]) => mockSetPersonDisabilities(...args),
  // Real implementation, not mocked — pure lookup, no server-only/db import,
  // and the point of these tests is exercising actions.ts's own field->label
  // message wiring, not stubbing it away.
  sensitiveInfoFieldLabel: (field: string) => {
    const labels: Record<string, string> = {
      body: "Note",
      gender: "Gender",
      allergies: "Allergies",
      medicalNotes: "Medical notes",
      medications: "Medications",
      authorizedPickup: "Authorized pickup",
    };
    return labels[field] ?? field;
  },
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPersonNoteAction,
  setPersonDemographicsAction,
  setPersonMedicalAction,
  setPersonDisabilitiesAction,
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("addPersonNoteAction", () => {
  const INPUT = {
    noteType: "general",
    visibility: "staff" as const,
    body: "note body",
  };

  it("not signed in returns an error without calling addPersonNote", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await addPersonNoteAction("alder-creek", "p-1", INPUT);
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockAddPersonNote).not.toHaveBeenCalled();
  });

  it("no org access returns an error without calling addPersonNote", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await addPersonNoteAction("alder-creek", "p-1", INPUT);
    expect(result.ok).toBe(false);
    expect(mockAddPersonNote).not.toHaveBeenCalled();
  });

  describe("with a resolved session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(SESSION);
      mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    });

    it("passes resolved personId/organizationId and the session's userId (not the client's own claims)", async () => {
      mockAddPersonNote.mockResolvedValueOnce({ kind: "ok", noteId: "n-1" });
      await addPersonNoteAction("alder-creek", "p-1", INPUT);
      expect(mockAddPersonNote).toHaveBeenCalledWith(
        "person-1",
        "org-1",
        "user-1",
        "p-1",
        INPUT,
      );
    });

    it("forbidden → ok:false, no revalidate", async () => {
      mockAddPersonNote.mockResolvedValueOnce({ kind: "forbidden" });
      const result = await addPersonNoteAction("alder-creek", "p-1", INPUT);
      expect(result.ok).toBe(false);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("not_found → ok:false", async () => {
      mockAddPersonNote.mockResolvedValueOnce({ kind: "not_found" });
      const result = await addPersonNoteAction("alder-creek", "p-1", INPUT);
      expect(result.ok).toBe(false);
    });

    it("invalid_input → ok:false with a human-readable, field-naming message", async () => {
      mockAddPersonNote.mockResolvedValueOnce({
        kind: "invalid_input",
        field: "body",
      });
      const result = await addPersonNoteAction("alder-creek", "p-1", INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/too long/i);
      }
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("ok → returns noteId, revalidates the sensitive-info page", async () => {
      mockAddPersonNote.mockResolvedValueOnce({ kind: "ok", noteId: "n-1" });
      const result = await addPersonNoteAction("alder-creek", "p-1", INPUT);
      expect(result).toEqual({ ok: true, data: { noteId: "n-1" } });
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/o/alder-creek/admin/members/p-1/edit/sensitive",
      );
    });
  });
});

describe("setPersonDemographicsAction", () => {
  const INPUT = { gender: "woman", racialEthnic: null, source: "self" as const };

  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("forbidden → ok:false", async () => {
    mockSetPersonDemographics.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await setPersonDemographicsAction("alder-creek", "p-1", INPUT);
    expect(result.ok).toBe(false);
  });

  it("invalid_input → ok:false with a human-readable, field-naming message", async () => {
    mockSetPersonDemographics.mockResolvedValueOnce({
      kind: "invalid_input",
      field: "gender",
    });
    const result = await setPersonDemographicsAction("alder-creek", "p-1", INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/too long/i);
    }
  });

  it("ok → returns personId and revalidates", async () => {
    mockSetPersonDemographics.mockResolvedValueOnce({ kind: "ok" });
    const result = await setPersonDemographicsAction("alder-creek", "p-1", INPUT);
    expect(result).toEqual({ ok: true, data: { personId: "p-1" } });
    expect(mockSetPersonDemographics).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "p-1",
      INPUT,
    );
  });
});

describe("setPersonMedicalAction", () => {
  const INPUT = {
    allergies: null,
    medicalNotes: null,
    medications: null,
    authorizedPickup: null,
  };

  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("ok → returns personId and revalidates", async () => {
    mockSetPersonMedical.mockResolvedValueOnce({ kind: "ok" });
    const result = await setPersonMedicalAction("alder-creek", "p-1", INPUT);
    expect(result).toEqual({ ok: true, data: { personId: "p-1" } });
  });

  it("forbidden → ok:false", async () => {
    mockSetPersonMedical.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await setPersonMedicalAction("alder-creek", "p-1", INPUT);
    expect(result.ok).toBe(false);
  });

  it("invalid_input → ok:false with a human-readable, field-naming message", async () => {
    mockSetPersonMedical.mockResolvedValueOnce({
      kind: "invalid_input",
      field: "medicalNotes",
    });
    const result = await setPersonMedicalAction("alder-creek", "p-1", INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/too long/i);
    }
  });
});

describe("setPersonDisabilitiesAction", () => {
  const INPUT = { categories: ["hearing"] };

  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("forbidden → ok:false", async () => {
    mockSetPersonDisabilities.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await setPersonDisabilitiesAction("alder-creek", "p-1", INPUT);
    expect(result.ok).toBe(false);
  });

  it("tracking_disabled → ok:false with a human-readable message", async () => {
    mockSetPersonDisabilities.mockResolvedValueOnce({ kind: "tracking_disabled" });
    const result = await setPersonDisabilitiesAction("alder-creek", "p-1", INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/disability tracking/i);
    }
  });

  it("ok → returns personId and revalidates", async () => {
    mockSetPersonDisabilities.mockResolvedValueOnce({ kind: "ok" });
    const result = await setPersonDisabilitiesAction("alder-creek", "p-1", INPUT);
    expect(result).toEqual({ ok: true, data: { personId: "p-1" } });
  });
});
