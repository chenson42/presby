// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/community/<id>/edit`'s page.tsx —
 * same gate-composition contract as `admin/community/new/page.test.tsx`, plus
 * the person-lookup three-way split (`ok` / `forbidden` / `not_found`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
const hasPermission = vi.fn();
vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  }
  return {
    OrgAccessError: MockOrgAccessError,
    resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
    assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
    hasPermission: (...args: unknown[]) => hasPermission(...args),
  };
});

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const isOrgFeatureEnabled = vi.fn();
vi.mock("@/lib/org-features", () => ({
  isOrgFeatureEnabled: (...args: unknown[]) => isOrgFeatureEnabled(...args),
}));

const getHouseholds = vi.fn();
vi.mock("@/lib/directory", () => ({
  getHouseholds: (...args: unknown[]) => getHouseholds(...args),
}));

const getPersonForEdit = vi.fn();
vi.mock("@/lib/people", () => ({
  getPersonForEdit: (...args: unknown[]) => getPersonForEdit(...args),
}));

const getPendingRollActionsForPerson = vi.fn();
const getSessionApprovalState = vi.fn();
vi.mock("@/lib/roll", () => ({
  getPendingRollActionsForPerson: (...args: unknown[]) =>
    getPendingRollActionsForPerson(...args),
  getSessionApprovalState: (...args: unknown[]) => getSessionApprovalState(...args),
}));

// `page.tsx` also imports `getSensitiveInfoGrants` from `@/lib/person-
// sensitive` — a SIBLING pipeline's addition (docs/work-log/2026-08-26-
// member-sensitive-info.md) that landed in this same file concurrently with
// this one. Mocked here purely so the real (`"server-only"`-carrying)
// module never loads under jsdom; this file asserts nothing about that
// pipeline's own feature, which remains its own test responsibility.
const getSensitiveInfoGrants = vi.fn();
vi.mock("@/lib/person-sensitive", () => ({
  getSensitiveInfoGrants: (...args: unknown[]) =>
    getSensitiveInfoGrants(...args),
}));

// `@/lib/community` is `server-only`: mocked so the real module never loads
// under jsdom. Its own correctness is `community.db.test.ts`'s job.
const getCommunityStatus = vi.fn();
vi.mock("@/lib/community", () => ({
  getCommunityStatus: (...args: unknown[]) => getCommunityStatus(...args),
}));

// `@/lib/person-photos/reader` is `server-only`: mocked so the real module never
// loads under jsdom. The toggle's own correctness is `public-photo.db.test.ts`'s job.
const personPhotosEnabled = vi.fn();
vi.mock("@/lib/person-photos/reader", () => ({
  personPhotosEnabled: (...args: unknown[]) => personPhotosEnabled(...args),
}));

// The sign-in card's reader (Community Increment 2b). Its own behaviour is
// `org-invite.db.test.ts`'s job; the default is `forbidden` (no card), so every
// older assertion in this file is about the same page it always was.
const getSignInCard = vi.fn();
vi.mock("@/lib/onboarding/org-invite", () => ({
  getSignInCard: (...args: unknown[]) => getSignInCard(...args),
}));

vi.mock("../../pending/actions", () => ({
  withdrawRollActionAction: vi.fn(),
}));

vi.mock("./actions", () => ({
  sendSignInInvitationAction: vi.fn(),
  resendSignInInvitationAction: vi.fn(),
  revokeSignInInvitationAction: vi.fn(),
  updatePersonAction: vi.fn(),
  recordRollActionAction: vi.fn(),
  removeParticipantAction: vi.fn(),
  undoParticipantEntryAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import EditMemberPage from "./page";
import { OrgAccessError } from "@/lib/authz";
import {
  COMMUNITY_ARCHIVE_ENDED_REASON,
  PARTICIPANT_REMOVAL_ENDED_REASON,
} from "@/lib/roll-action-kinds";

// The Community engagement Server Actions reach the database; the screens under
// test only call them through the dialogs, which these files do not drive.
vi.mock("../../actions", () => ({
  changeEngagementAction: vi.fn(),
  archivePersonAction: vi.fn(),
  restorePersonAction: vi.fn(),
  updateVisitDetailsAction: vi.fn(),
}));


/** A listed person with no roll: the quietest connection. */
function status(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ok" as const,
    status: {
      personId: "p-1",
      connection: "listed",
      currentRoll: null,
      currentRollSince: null,
      endedOn: null,
      endedReason: null,
      engagementStatus: "regular",
      standing: "listed",
      firstVisitDate: null,
      howHeard: null,
      signInConnected: false,
      hasOpenStaffPosition: false,
      pendingCount: 0,
      latestAction: null,
      ...overrides,
    },
  };
}

beforeEach(() => {
  getCommunityStatus.mockReset().mockResolvedValue(status());
  getSignInCard.mockReset().mockResolvedValue({ kind: "forbidden" });
});

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  isOrgFeatureEnabled.mockReset();
  getHouseholds.mockReset();
  getPersonForEdit.mockReset();
  getPendingRollActionsForPerson.mockReset();
  getSessionApprovalState
    .mockReset()
    .mockResolvedValue({ kind: "ok", state: { kind: "ready" } });
  getSensitiveInfoGrants.mockReset();
  personPhotosEnabled.mockReset().mockResolvedValue(false);
  hasPermission.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

/**
 * `page.tsx` calls `isFlagEnabled` with TWO different keys
 * (`org_portal.members_create`, then `org_portal.members_roll_action_edit`)
 * — a blanket `mockResolvedValue` would make both resolve identically,
 * silently exercising `RecordRollActionForm`'s render path in tests that
 * never intended to. This keys the mock by argument instead, defaulting
 * the roll-action-edit flag OFF unless a test asks for it, so every
 * pre-existing test in this file keeps exercising exactly the same path it
 * did before that flag existed.
 */
function mockFlags({
  membersCreate,
  rollActionEdit = false,
  sensitiveInfo = false,
  childrenMinistry = false,
}: {
  membersCreate: boolean;
  rollActionEdit?: boolean;
  sensitiveInfo?: boolean;
  childrenMinistry?: boolean;
}) {
  isFlagEnabled.mockImplementation(async (key: string) => {
    if (key === "org_portal.members_create") return membersCreate;
    if (key === "org_portal.members_roll_action_edit") return rollActionEdit;
    if (key === "org_portal.sensitive_info") return sensitiveInfo;
    if (key === "org_portal.children_ministry") return childrenMinistry;
    return false;
  });
}

/**
 * `isOrgFeatureEnabled` is called with THREE different keys across this
 * page's own two org-toggle checks (`org_portal.members_create`,
 * `org_portal.sensitive_info`) — keyed by the THIRD argument, same
 * discrimination `mockFlags` applies to `isFlagEnabled` above, so a test
 * asserting the sensitive-info link's own toggle doesn't accidentally read
 * `members_create`'s toggle value instead.
 */
function mockToggles({
  membersCreate,
  sensitiveInfo = false,
}: {
  membersCreate: boolean;
  sensitiveInfo?: boolean;
}) {
  isOrgFeatureEnabled.mockImplementation(
    async (_personId: string, _organizationId: string, key: string) => {
      if (key === "org_portal.members_create") return membersCreate;
      if (key === "org_portal.sensitive_info") return sensitiveInfo;
      return false;
    },
  );
}

const OK_RESOLVED = {
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

const PERSON = {
  personId: "p-1",
  firstName: "Nora",
  lastName: "Ashgrove",
  middleName: null,
  preferredName: null,
  suffix: null,
  emails: [
    {
      id: "c-1",
      value: "nora@example.invalid",
      subtype: null,
      isPrimary: true,
      doNotContact: false,
      createdAt: "2026-01-01T00:00:00.000000Z",
    },
  ],
  phone: null,
  address: null,
  householdId: null,
};

function makeParams(slug = "alder-creek", id = "p-1") {
  return Promise.resolve({ slug, id });
}

describe("EditMemberPage — gate composition (DECISION-097)", () => {
  it("flag off → renders flag-off, never looks up the person", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: false });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(isOrgFeatureEnabled).not.toHaveBeenCalled();
    expect(getPersonForEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("flag on but org toggle off → renders the SAME flag-off copy (no axis leak)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(false);

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(getPersonForEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("both on and the person is found → renders the edit form prefilled", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /edit person/i })).toBeTruthy();
    expect(
      (screen.getByLabelText(/^first name/i) as HTMLInputElement).value,
    ).toBe("Nora");
  });
});

describe("EditMemberPage — person lookup", () => {
  it("forbidden → renders the shared MembersForbidden state, not a 404", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "forbidden" });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("not_found → calls next/navigation's notFound()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "not_found" });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    await expect(EditMemberPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("re-throws OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(EditMemberPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockRejectedValue(new Error("connection reset"));

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load this right now/i)).toBeTruthy();
  });
});

describe("EditMemberPage — RecordRollActionForm gate (docs/work-log/2026-08-26-member-roll-on-edit.md)", () => {
  it("roll-action-edit flag off → RecordRollActionForm does not render, and its own data is never fetched", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, rollActionEdit: false });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(getPendingRollActionsForPerson).not.toHaveBeenCalled();
    expect(screen.queryByText(/record a roll action/i)).toBeNull();
  });

  it("roll-action-edit flag on (AND members_create flag+toggle already on) → RecordRollActionForm renders with no pending notice", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, rollActionEdit: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    getPendingRollActionsForPerson.mockResolvedValue({ kind: "ok", actions: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(getPendingRollActionsForPerson).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "p-1",
    );
    expect(screen.getByText(/record a roll action/i)).toBeTruthy();
    expect(screen.queryByText(/already pending review/i)).toBeNull();
  });

  it("surfaces an existing pending action as a non-blocking notice, doesn't hide the form", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, rollActionEdit: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    getPendingRollActionsForPerson.mockResolvedValue({
      kind: "ok",
      actions: [{ id: "ra-1", kind: "restoration", effectiveDate: "2026-06-01" }],
    });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/record a roll action/i)).toBeTruthy();
    expect(screen.getByText(/already pending review/i)).toBeTruthy();
  });

  it("getPendingRollActionsForPerson returning forbidden renders the form with no notice, rather than failing the page", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, rollActionEdit: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    getPendingRollActionsForPerson.mockResolvedValue({ kind: "forbidden" });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/record a roll action/i)).toBeTruthy();
    expect(screen.queryByText(/already pending review/i)).toBeNull();
  });
});

describe("EditMemberPage — sensitive-info link (docs/work-log/2026-08-26-member-sensitive-info.md)", () => {
  it("sensitive-info flag off → link absent, grants never fetched", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, sensitiveInfo: false });
    mockToggles({ membersCreate: true });
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(getSensitiveInfoGrants).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/pastoral notes, demographics/i),
    ).toBeNull();
  });

  it("sensitive-info flag on but org toggle off → link absent, grants never fetched", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, sensitiveInfo: true });
    mockToggles({ membersCreate: true, sensitiveInfo: false });
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(getSensitiveInfoGrants).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/pastoral notes, demographics/i),
    ).toBeNull();
  });

  it("both on, viewer holds none of the four permissions → link absent (not disabled)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, sensitiveInfo: true });
    mockToggles({ membersCreate: true, sensitiveInfo: true });
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    getSensitiveInfoGrants.mockResolvedValue({
      pastoralNotes: false,
      demographics: false,
      medical: false,
      disabilities: false,
    });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(getSensitiveInfoGrants).toHaveBeenCalledWith("person-1", "org-1");
    expect(
      screen.queryByText(/pastoral notes, demographics/i),
    ).toBeNull();
  });

  it("both on, viewer holds at least one of the four permissions → link renders, pointing at ./edit/sensitive", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, sensitiveInfo: true });
    mockToggles({ membersCreate: true, sensitiveInfo: true });
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    getSensitiveInfoGrants.mockResolvedValue({
      pastoralNotes: true,
      demographics: false,
      medical: false,
      disabilities: false,
    });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    const link = screen.getByText(/pastoral notes, demographics/i);
    expect((link.closest("a") as HTMLAnchorElement).getAttribute("href")).toBe(
      "/o/alder-creek/admin/community/p-1/edit/sensitive",
    );
  });
});

describe("EditMemberPage — guardians link (docs/work-log/2026-08-26-childrens-ministry.md)", () => {
  it("children-ministry flag off → link absent, hasPermission never called for children.roster", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, childrenMinistry: false });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(hasPermission).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "children.roster",
    );
    expect(screen.queryByText(/^guardians$/i)).toBeNull();
  });

  it("children-ministry flag on but viewer lacks children.roster → link absent (not disabled)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, childrenMinistry: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    hasPermission.mockResolvedValue(false);

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(hasPermission).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "children.roster",
    );
    expect(screen.queryByText(/^guardians$/i)).toBeNull();
  });

  it("children-ministry flag on AND viewer holds children.roster → link renders, pointing at ./edit/guardians", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, childrenMinistry: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    hasPermission.mockResolvedValue(true);

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    const link = screen.getByText(/^guardians$/i);
    expect((link.closest("a") as HTMLAnchorElement).getAttribute("href")).toBe(
      "/o/alder-creek/admin/community/p-1/edit/guardians",
    );
  });
});

describe("EditMemberPage — card-separated visual structure (M2, docs/reviews/2026-08-26-portal-ux.md)", () => {
  it("wraps Profile, Connection, the roll-action form, and the sensitive-info link in their own bg-card panels", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, rollActionEdit: true, sensitiveInfo: true });
    mockToggles({ membersCreate: true, sensitiveInfo: true });
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    getPendingRollActionsForPerson.mockResolvedValue({ kind: "ok", actions: [] });
    getSensitiveInfoGrants.mockResolvedValue({
      pastoralNotes: true,
      demographics: false,
      medical: false,
      disabilities: false,
    });

    const el = await EditMemberPage({ params: makeParams() });
    const { container } = render(el);

    const cards = container.querySelectorAll(".bg-card");
    // Profile, Connection, Engagement, Record a roll action, and the
    // sensitive-info link each get their own panel — five, not one
    // undifferentiated scroll.
    expect(cards.length).toBe(5);

    const profileHeading = screen.getByRole("heading", { name: /^profile$/i });
    expect(profileHeading.closest(".bg-card")).not.toBeNull();

    const rollHeading = screen.getByRole("heading", {
      name: /record a roll action/i,
    });
    expect(rollHeading.closest(".bg-card")).not.toBeNull();

    const sensitiveLink = screen.getByText(/pastoral notes, demographics/i);
    expect(sensitiveLink.closest(".bg-card")).not.toBeNull();
  });
});

describe("EditMemberPage — the Connection card and participant controls (DECISION-198, DECISION-200)", () => {
  async function renderWith({
    connection = "listed",
    latestAction = null,
    currentRollSince = null,
    endedOn = null,
    rollActionEdit = true,
    canPropose = true,
    pending = [],
  }: {
    connection?: string;
    latestAction?: { id: string; kind: string; effectiveDate: string; onRecordKind: boolean } | null;
    currentRollSince?: string | null;
    endedOn?: string | null;
    rollActionEdit?: boolean;
    canPropose?: boolean;
    pending?: Array<{ id: string; kind: string; effectiveDate: string }>;
  }) {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true, rollActionEdit });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    getPendingRollActionsForPerson.mockResolvedValue({ kind: "ok", actions: pending });
    getCommunityStatus.mockResolvedValue(
      status({ connection, latestAction, currentRollSince, endedOn }),
    );
    hasPermission.mockImplementation(
      async (_p: string, _o: string, key: string) =>
        key === "roll.propose" ? canPropose : false,
    );
    render(await EditMemberPage({ params: makeParams() }));
  }

  const ENROLMENT = {
    id: "ra-1",
    kind: "other_participant_enrolled",
    effectiveDate: "2026-03-01",
    onRecordKind: true,
  };

  it.each([
    ["visitor", "Visitor"],
    ["participant", "Participant"],
    ["member", "Member"],
    ["staff", "Staff"],
    ["listed", "Listed"],
    ["former_participant", "Former participant"],
    ["ended", "Connection ended"],
  ])("states a %s connection in words", async (connection, label) => {
    await renderWith({ connection });
    const card = screen.getByTestId("connection-card");
    expect(card.textContent).toContain(label);
    expect(screen.getByRole("heading", { name: "Connection" })).toBeTruthy();
  });

  it("a participant gets Remove, Undo and the become-a-member note", async () => {
    await renderWith({
      connection: "participant",
      latestAction: ENROLMENT,
      currentRollSince: "2026-03-01",
    });
    expect(screen.getByRole("button", { name: /remove as participant/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /undo last entry/i })).toBeTruthy();
    expect(
      screen.getByText(
        /to receive this person as a member, record a profession of faith or another gain below\. no removal is needed\./i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/latest entry: enrolled as a participant/i)).toBeTruthy();
  });

  it("a visitor has no Remove, and no Undo without an on-record entry", async () => {
    await renderWith({ connection: "visitor" });
    expect(screen.queryByRole("button", { name: /remove as participant/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /undo last entry/i })).toBeNull();
    expect(screen.queryByText(/no removal is needed/i)).toBeNull();
  });

  it("an enrolled visitor (roll is participant) can be undone back to a visitor", async () => {
    await renderWith({ connection: "participant", latestAction: ENROLMENT });
    expect(screen.getByRole("button", { name: /undo last entry/i })).toBeTruthy();
  });

  it("a former participant can Undo the removal but not Remove again", async () => {
    await renderWith({
      connection: "former_participant",
      endedOn: "2026-04-02",
      latestAction: {
        id: "ra-2",
        kind: "other_participant_removed",
        effectiveDate: "2026-04-02",
        onRecordKind: true,
      },
    });
    expect(screen.queryByRole("button", { name: /remove as participant/i })).toBeNull();
    expect(screen.getByRole("button", { name: /undo last entry/i })).toBeTruthy();
  });

  it("a member whose latest entry is a Session-approved kind gets neither control", async () => {
    await renderWith({
      connection: "member",
      latestAction: {
        id: "ra-3",
        kind: "profession_of_faith",
        effectiveDate: "2026-01-01",
        onRecordKind: false,
      },
    });
    expect(screen.queryByRole("button", { name: /remove as participant/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /undo last entry/i })).toBeNull();
  });

  it("without roll.propose the card shows but no control does", async () => {
    await renderWith({
      connection: "participant",
      latestAction: ENROLMENT,
      canPropose: false,
    });
    expect(screen.getByTestId("connection-card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove as participant/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /undo last entry/i })).toBeNull();
  });

  it("with the roll-action edit flag off the controls are absent (the card is not)", async () => {
    await renderWith({
      connection: "participant",
      latestAction: ENROLMENT,
      rollActionEdit: false,
    });
    expect(screen.getByTestId("connection-card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove as participant/i })).toBeNull();
    expect(hasPermission).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "roll.propose",
    );
  });

  it("names a pending action as waiting for the Session", async () => {
    await renderWith({
      connection: "listed",
      pending: [{ id: "ra-9", kind: "profession_of_faith", effectiveDate: "2026-06-01" }],
    });
    expect(
      screen.getByText(/waiting for the session to approve: profession of faith/i),
    ).toBeTruthy();
  });

  const PENDING = [{ id: "ra-9", kind: "profession_of_faith", effectiveDate: "2026-06-01" }];

  it("a roll.propose holder gets Withdraw proposal on the pending notice", async () => {
    await renderWith({ connection: "listed", pending: PENDING });
    expect(screen.getByRole("button", { name: /withdraw proposal for/i })).toBeTruthy();
    expect(screen.queryByText(/no one can approve yet/i)).toBeNull();
  });

  it("without roll.propose there is no Withdraw (and the pending notice is not read at all)", async () => {
    await renderWith({ connection: "listed", pending: PENDING, canPropose: false });
    expect(screen.queryByRole("button", { name: /withdraw proposal for/i })).toBeNull();
    expect(getSessionApprovalState).not.toHaveBeenCalled();
  });

  it("when the Session cannot act the notice says so and links to the queue", async () => {
    getSessionApprovalState.mockResolvedValue({ kind: "ok", state: { kind: "no_sign_in" } });
    await renderWith({ connection: "listed", pending: PENDING });
    const link = screen.getByRole("link", { name: /see why on the pending approvals page/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/admin/community/pending");
  });

  it("terms_not_started also shows the can't-approve notice (only ready is skipped)", async () => {
    getSessionApprovalState.mockResolvedValue({ kind: "ok", state: { kind: "terms_not_started" } });
    await renderWith({ connection: "listed", pending: PENDING });
    expect(screen.getByText(/no one can approve yet/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /see why on the pending approvals page/i }),
    ).toBeTruthy();
  });

  it("does not read the Session state when nothing is pending", async () => {
    await renderWith({ connection: "listed", pending: [] });
    expect(getSessionApprovalState).not.toHaveBeenCalled();
  });
});

describe("EditMemberPage — photos link (docs/work-log/2026-10-26-person-photos-inc1.md, Copy C7)", () => {
  function arrange() {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
  }

  it("toggle off → no Photos link (absent, never disabled)", async () => {
    arrange();
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    personPhotosEnabled.mockResolvedValue(false);
    render(await EditMemberPage({ params: makeParams() }));
    expect(screen.queryByRole("link", { name: /^photos$/i })).toBeNull();
  });

  it("toggle on → the link points at ./edit/photos", async () => {
    arrange();
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    personPhotosEnabled.mockResolvedValue(true);
    render(await EditMemberPage({ params: makeParams() }));
    expect(screen.getByRole("link", { name: /^photos$/i }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/community/p-1/edit/photos",
    );
    expect(personPhotosEnabled).toHaveBeenCalledWith({ organizationId: "org-1", actorPersonId: "person-1" });
  });

  it("a person the viewer may not edit → the toggle is never read", async () => {
    arrange();
    getPersonForEdit.mockResolvedValue({ kind: "forbidden" });
    render(await EditMemberPage({ params: makeParams() }));
    expect(personPhotosEnabled).not.toHaveBeenCalled();
  });

  it("an unreadable toggle hides the link and leaves the edit page standing", async () => {
    arrange();
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    personPhotosEnabled.mockRejectedValue(new Error("db down"));
    render(await EditMemberPage({ params: makeParams() }));
    expect(screen.queryByRole("link", { name: /^photos$/i })).toBeNull();
    expect(screen.getByRole("heading", { name: /edit person/i })).toBeTruthy();
  });
});

describe("EditMemberPage - the sign-in card (Community Increment 2b)", () => {
  const CARD = {
    personId: "p-1",
    state: "none",
    linked: false,
    connectedVia: null,
    connectedOn: null,
    address: "nora@example.invalid",
    invitedAddress: null,
    addressCurrent: null,
    sentAt: null,
    expiresAt: null,
    resendCount: 0,
    nextResendAt: null,
    cooldownMinutes: 0,
    chainCapReached: false,
    delivery: "unknown",
    blockedOutcome: null,
    addressDoNotContact: false,
    authorityBearing: false,
    addressShared: false,
    selfConnectEnabled: true,
    outlook: "by_sign_in",
  };

  async function renderPage() {
    cachedAuth.mockResolvedValue({ user: { id: "u1", email: "clerk@example.invalid" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: { ...PERSON, preferredName: "Nori" } });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    render(await EditMemberPage({ params: makeParams() }));
  }

  it("reads the card with the viewer's context and renders it below the Connection card, named with the preferred name", async () => {
    getSignInCard.mockResolvedValue({ kind: "ok", card: CARD });
    await renderPage();
    expect(getSignInCard).toHaveBeenCalledTimes(1);
    expect(getSignInCard).toHaveBeenCalledWith(
      { organizationId: "org-1", actingPersonId: "person-1", actingUserId: "u1", actingUserEmail: "clerk@example.invalid" },
      "p-1",
    );
    const card = screen.getByTestId("sign-in-card");
    expect(card.id).toBe("sign-in");
    expect(card.textContent).toContain("Invite Nori Ashgrove to sign in.");
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeTruthy();
  });

  it("a failed read renders the card's own failure line and the rest of the page", async () => {
    getSignInCard.mockResolvedValue({ kind: "error" });
    await renderPage();
    expect(screen.getByTestId("sign-in-card").textContent).toContain("We couldn't load this just now. Reload the page.");
    expect(screen.getByRole("heading", { name: /edit person/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send invitation" })).toBeNull();
  });

  it.each(["forbidden", "not_found"])("%s renders no card", async (kind) => {
    getSignInCard.mockResolvedValue({ kind });
    await renderPage();
    expect(screen.queryByTestId("sign-in-card")).toBeNull();
  });

  it("is not read when the person page itself is not shown", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: false });
    render(await EditMemberPage({ params: makeParams() }));
    expect(getSignInCard).not.toHaveBeenCalled();
  });
});


describe("EditMemberPage — Engagement, Visit details, Archive and Restore (Increment 3a)", () => {
  async function renderEngagement(
    overrides: Record<string, unknown> = {},
    card: Record<string, unknown> | null = null,
    routeId = "p-1",
  ) {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlags({ membersCreate: true });
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });
    getPendingRollActionsForPerson.mockResolvedValue({ kind: "ok", actions: [] });
    getCommunityStatus.mockResolvedValue(status(overrides));
    getSignInCard.mockResolvedValue(
      card ? { kind: "ok", card: { state: "none", address: null, selfConnectEnabled: false, ...card } } : { kind: "forbidden" },
    );
    hasPermission.mockResolvedValue(false);
    render(await EditMemberPage({ params: makeParams("alder-creek", routeId) }));
  }

  const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

  it("a listed regular attender: the card, its helper, the select and a disabled-until-changed Save; no Archive, no Visit details", async () => {
    await renderEngagement();
    expect(screen.getByRole("heading", { name: "Engagement" })).toBeTruthy();
    expect(screen.getByText(/engagement is for your own care\./i)).toBeTruthy();
    const select = screen.getByRole("combobox", { name: "Engagement for Nora Ashgrove" }) as HTMLSelectElement;
    expect(select.value).toBe("regular");
    expect(screen.getByText("Regular attender. Can appear in the member directory.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save engagement" }) as HTMLButtonElement).disabled).toBe(true);
    expect(buttons()).not.toContain("Archive Nora Ashgrove");
    expect(screen.queryByRole("heading", { name: "Visit details" })).toBeNull();
  });

  it("a visitor: Visit details, and Archive on the record", async () => {
    await renderEngagement({ engagementStatus: "visitor", standing: "visitor", connection: "visitor" });
    expect(screen.getByRole("heading", { name: "Visit details" })).toBeTruthy();
    expect(screen.getByLabelText("First visit (optional)")).toBeTruthy();
    expect(screen.getByLabelText("How did they hear about us? (optional)")).toBeTruthy();
    expect(buttons()).toContain("Archive Nora Ashgrove");
  });

  it("an inactive person: Archive on the record; the same record opened by that person (the viewer) offers none", async () => {
    await renderEngagement({ engagementStatus: "inactive", standing: "inactive", connection: "inactive" });
    expect(buttons()).toContain("Archive Nora Ashgrove");
    cleanup();
    // OK_RESOLVED's viewer is "person-1": their own record, however the id is cased.
    await renderEngagement({ engagementStatus: "inactive", standing: "inactive", connection: "inactive" }, null, "PERSON-1");
    expect(buttons()).not.toContain("Archive Nora Ashgrove");
    // Mark as regular is not refused on your own record, so it stays.
    expect(screen.getByRole("combobox", { name: /engagement for/i })).toBeTruthy();
  });

  it("a visitor viewing their own record gets Visit details but no Archive — regression for Archive offered on your own record", async () => {
    await renderEngagement({ engagementStatus: "visitor", standing: "visitor", connection: "visitor" }, null, "person-1");
    expect(screen.getByRole("heading", { name: "Visit details" })).toBeTruthy();
    expect(buttons()).not.toContain("Archive Nora Ashgrove");
  });

  it("Visit details also shows for a regular attender whose first visit or how-heard is stored, with those values", async () => {
    await renderEngagement({ firstVisitDate: "2026-03-01", howHeard: "A neighbour" });
    expect((screen.getByLabelText("First visit (optional)") as HTMLInputElement).value).toBe("2026-03-01");
    expect((screen.getByLabelText("How did they hear about us? (optional)") as HTMLInputElement).value).toBe("A neighbour");
  });

  it("a person on the roll still marked Visitor gets the nudge, and no Archive (the roll lists them)", async () => {
    await renderEngagement({
      engagementStatus: "visitor",
      standing: "listed",
      connection: "participant",
      currentRoll: "other_participant",
    });
    expect(screen.getByText("Nora Ashgrove is still marked as a visitor. Mark as a regular attender?")).toBeTruthy();
    expect(buttons()).toContain("Mark as regular attender");
    expect(buttons()).not.toContain("Archive Nora Ashgrove");
    const option = screen.getByRole("option", { name: "Visitor (current)" }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });

  it("a staff record says engagement isn't tracked and offers no control", async () => {
    await renderEngagement({ engagementStatus: "staff", standing: "staff_anchor", connection: "staff" });
    expect(screen.getByText("This is a staff record, so engagement isn't tracked.")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /engagement for/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save engagement" })).toBeNull();
    expect(buttons()).not.toContain("Archive Nora Ashgrove");
  });

  it("an archived visitor: the connection says so with the date, Restore is offered, and the card says to restore first", async () => {
    await renderEngagement({
      engagementStatus: "visitor",
      standing: "visitor",
      connection: "former_visitor",
      endedOn: "2026-05-04",
      endedReason: COMMUNITY_ARCHIVE_ENDED_REASON,
    });
    expect(screen.getByTestId("connection-card").textContent).toMatch(/Archived visitor\s+on\s/);
    expect(buttons()).toContain("Restore Nora Ashgrove");
    expect(buttons()).not.toContain("Archive Nora Ashgrove");
    expect(screen.getByText("Nora Ashgrove was archived. Restore them to change this.")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /engagement for/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Visit details" })).toBeNull();
  });

  it("any other ended connection: the card says it ended; neither Archive nor Restore", async () => {
    await renderEngagement({
      connection: "former_participant",
      endedOn: "2026-04-02",
      endedReason: PARTICIPANT_REMOVAL_ENDED_REASON,
    });
    expect(screen.getByText("Nora Ashgrove's connection here has ended, so engagement can't be changed.")).toBeTruthy();
    expect(buttons()).not.toContain("Restore Nora Ashgrove");
    expect(buttons()).not.toContain("Archive Nora Ashgrove");
  });

  it("the Save dialog carries the auto-connect line only when the card says an address is on file and the toggle is on", async () => {
    await renderEngagement(
      { engagementStatus: "visitor", standing: "visitor", connection: "visitor" },
      { address: "nora@example.invalid", selfConnectEnabled: true },
    );
    fireEvent.change(screen.getByRole("combobox", { name: /engagement for/i }), { target: { value: "regular" } });
    fireEvent.click(screen.getByRole("button", { name: "Save engagement" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Mark Nora Ashgrove as a regular attender?")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Nora Ashgrove could be connected to this record automatically when they sign in with an address on file.",
      ),
    ).toBeTruthy();
  });

  it("with no card (the reader failed) the same dialog states no auto-connect line and no false 'no sign-in' reading", async () => {
    await renderEngagement({ engagementStatus: "visitor", standing: "visitor", connection: "visitor" }, null);
    fireEvent.change(screen.getByRole("combobox", { name: /engagement for/i }), { target: { value: "regular" } });
    fireEvent.click(screen.getByRole("button", { name: "Save engagement" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByText(/could be connected to this record automatically/i)).toBeNull();
  });

  it("the Archive dialog says an open invitation will stop working only when the card's state is pending", async () => {
    await renderEngagement(
      { engagementStatus: "visitor", standing: "visitor", connection: "visitor", signInConnected: true },
      { state: "pending" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive Nora Ashgrove" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("An invitation to Nora Ashgrove is still open. It will stop working.")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Nora Ashgrove has a sign-in connected and will no longer reach Alder Creek Presbyterian Church through this record.",
      ),
    ).toBeTruthy();
  });

  it("the Archive dialog omits the invitation line when there is no card or the state is not pending", async () => {
    await renderEngagement({ engagementStatus: "visitor", standing: "visitor", connection: "visitor" }, null);
    fireEvent.click(screen.getByRole("button", { name: "Archive Nora Ashgrove" }));
    expect(within(screen.getByRole("alertdialog")).queryByText(/invitation to .* is still open/i)).toBeNull();
  });
});
