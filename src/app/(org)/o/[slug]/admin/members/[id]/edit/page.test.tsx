// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/members/<id>/edit`'s page.tsx —
 * same gate-composition contract as `admin/members/new/page.test.tsx`, plus
 * the person-lookup three-way split (`ok` / `forbidden` / `not_found`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
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
vi.mock("@/lib/roll", () => ({
  getPendingRollActionsForPerson: (...args: unknown[]) =>
    getPendingRollActionsForPerson(...args),
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

vi.mock("./actions", () => ({
  updatePersonAction: vi.fn(),
  recordRollActionAction: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
  getSensitiveInfoGrants.mockReset();
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
}: {
  membersCreate: boolean;
  rollActionEdit?: boolean;
  sensitiveInfo?: boolean;
}) {
  isFlagEnabled.mockImplementation(async (key: string) => {
    if (key === "org_portal.members_create") return membersCreate;
    if (key === "org_portal.members_roll_action_edit") return rollActionEdit;
    if (key === "org_portal.sensitive_info") return sensitiveInfo;
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
  email: "nora@example.invalid",
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
      (screen.getByLabelText(/^first name$/i) as HTMLInputElement).value,
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
      "/o/alder-creek/admin/members/p-1/edit/sensitive",
    );
  });
});
