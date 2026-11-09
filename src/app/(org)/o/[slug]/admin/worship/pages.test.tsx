// @vitest-environment jsdom
/**
 * The authoring pages, orchestration level (docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 "Component / Page Plan", Copy G3 to G5). The gate runs for real over mocked
 * session, authz and reads: signed out, the org miss, off, forbidden, then the page.
 * Pinned: which hub cards a viewer sees by key, that a key-less member is told they
 * don't have permission (not shown a blank), empty states with their next action, the
 * service page's controls by key and by service state, and the replaced stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const cachedAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => {
  class OrgAccessError extends Error {}
  return { OrgAccessError, resolveOrgContext, assertOrgAccess: vi.fn(async () => undefined) };
});
const reads = vi.hoisted(() => ({
  getWorshipContext: vi.fn(),
  getTeamsAdmin: vi.fn(),
  getTeamAdmin: vi.fn(),
  getAdoptableGroups: vi.fn(),
  getServiceTypes: vi.fn(),
  getServiceType: vi.fn(),
  getServiceFormOptions: vi.fn(),
  getServicesList: vi.fn(),
  getServiceBoard: vi.fn(),
}));
vi.mock("@/lib/worship/reads", () => reads);
vi.mock("./actions", () => ({ createTeamAction: vi.fn(), adoptTeamAction: vi.fn(), updateTeamAction: vi.fn(), retireTeamAction: vi.fn(), addPositionAction: vi.fn(), updatePositionAction: vi.fn(), retirePositionAction: vi.fn(), setQualificationsAction: vi.fn(), addTeamMemberAction: vi.fn(), endTeamMemberAction: vi.fn(), searchRosterCandidatesAction: vi.fn(), createServiceTypeAction: vi.fn(), updateServiceTypeAction: vi.fn(), retireServiceTypeAction: vi.fn(), setServiceTypeTeamsAction: vi.fn(), createServiceAction: vi.fn(), generateServicesAction: vi.fn(), updateServiceAction: vi.fn(), cancelServiceAction: vi.fn(), setServiceTeamsAction: vi.fn() }));
vi.mock("@/app/(org)/o/[slug]/worship/actions", () => ({ respondToRequestAction: vi.fn(), addBlockoutAction: vi.fn(), endBlockoutAction: vi.fn(), placePersonAction: vi.fn(), placeGuestAction: vi.fn(), removeAssignmentAction: vi.fn(), recordResponseAction: vi.fn(), sendRequestsAction: vi.fn(), getPickerCandidatesAction: vi.fn(), getSendPreviewAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GATE_COPY, HUB_COPY, NAV_COPY, SERVICES_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import HubPage from "./page";
import TeamsPage from "./teams/page";
import NewTeamPage from "./teams/new/page";
import TeamPage from "./teams/[groupId]/page";
import ServiceTypesPage from "./service-types/page";
import ServicesPage from "./services/page";
import NewServicePage from "./services/new/page";
import GenerateServicesPage from "./services/generate/page";
import ServicePage from "./services/[eventId]/page";

const GROUP = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";
const OK_ORG = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek Church", organizationType: "congregation" as const, slug: "alder-creek", platformStatus: "managed" as const },
};
const keys = (...held: Array<"manage" | "plan" | "schedule">) => ({
  manage: held.includes("manage"),
  plan: held.includes("plan"),
  schedule: held.includes("schedule"),
});

beforeEach(() => {
  for (const m of [cachedAuth, resolveOrgContext, ...Object.values(reads)]) m.mockReset();
  cachedAuth.mockResolvedValue({ user: { id: "user-1", email: "a@example.invalid" } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: keys("manage", "plan", "schedule") });
});
afterEach(cleanup);

const params = <T extends object>(p: T = {} as T) => ({ params: Promise.resolve({ slug: "alder-creek", ...p }) });

describe("the gate on the authoring tree", () => {
  it("signed out: sign in with this page's path", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(HubPage(params())).rejects.toThrow(`REDIRECT:/signin?callbackUrl=${encodeURIComponent("/o/alder-creek/admin/worship")}`);
  });

  it("a member with no worship key is told they don't have permission, naming the organization", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: keys() });
    render(await HubPage(params()));
    expect(screen.getByTestId("worship-forbidden").textContent).toContain(GATE_COPY.forbidden("Alder Creek Church"));
    expect(screen.queryByTestId("worship-hub")).toBeNull();
  });

  it("a team page needs worship.manage: a plan-only holder is forbidden", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: keys("plan") });
    render(await TeamsPage(params()));
    expect(screen.getByTestId("worship-forbidden")).toBeTruthy();
    expect(reads.getTeamsAdmin).not.toHaveBeenCalled();
  });

  it("toggle off: the honest off state, not the stub and not a 404", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: false });
    render(await HubPage(params()));
    expect(screen.getByTestId("worship-off").textContent).toContain("Ask someone who manages Alder Creek Church's features to turn it on.");
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("a presbytery is not applicable", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "not_applicable" });
    render(await HubPage(params()));
    expect(screen.getByTestId("worship-not-applicable")).toBeTruthy();
  });
});

describe("Plan worship hub", () => {
  const hubLinks = () => within(screen.getByTestId("worship-hub")).getAllByRole("link").map((a) => a.getAttribute("href"));

  it("a founder (all three keys) sees Services, Teams and Service types", async () => {
    render(await HubPage(params()));
    expect(screen.getByRole("heading", { level: 1, name: HUB_COPY.heading })).toBeTruthy();
    expect(hubLinks()).toEqual([
      "/o/alder-creek/admin/worship/services",
      "/o/alder-creek/admin/worship/teams",
      "/o/alder-creek/admin/worship/service-types",
    ]);
  });

  it("a schedule-only holder sees Services only", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: keys("schedule") });
    render(await HubPage(params()));
    expect(hubLinks()).toEqual(["/o/alder-creek/admin/worship/services"]);
  });
});

describe("Teams", () => {
  it("the list is cards with counts and the Retired badge, and a New team button", async () => {
    reads.getTeamsAdmin.mockResolvedValue({
      kind: "ok",
      data: [
        { groupId: GROUP, name: "Sunday Band", kind: "team", retired: false, peopleCount: 3, positionCount: 7 },
        { groupId: "g2", name: "Old Choir", kind: "choir", retired: true, peopleCount: 1, positionCount: 1 },
      ],
    });
    render(await TeamsPage(params()));
    expect(screen.getByRole("heading", { level: 1, name: TEAMS_COPY.listHeading })).toBeTruthy();
    const list = screen.getByTestId("teams-list");
    expect(list.textContent).toContain("3 people, 7 positions");
    expect(list.textContent).toContain("1 person, 1 position");
    expect(within(list).getByText(TEAMS_COPY.retiredBadge)).toBeTruthy();
    expect(screen.getByRole("link", { name: /New team/ }).getAttribute("href")).toBe("/o/alder-creek/admin/worship/teams/new");
  });

  it("no teams: the empty state names the next action", async () => {
    reads.getTeamsAdmin.mockResolvedValue({ kind: "ok", data: [] });
    render(await TeamsPage(params()));
    expect(screen.getByText(TEAMS_COPY.listEmpty)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /New team/ }).length).toBeGreaterThan(0);
  });

  it("the new-team page hides 'Or use a group you already have' without groups.manage", async () => {
    reads.getAdoptableGroups.mockResolvedValue({ kind: "forbidden" });
    render(await NewTeamPage(params()));
    expect(screen.getByTestId("team-form")).toBeTruthy();
    expect(screen.queryByTestId("existing-group-form")).toBeNull();
  });

  it("the new-team page offers existing groups to a viewer who also manages groups", async () => {
    reads.getAdoptableGroups.mockResolvedValue({ kind: "ok", data: [{ groupId: "g9", name: "Handbell Choir", kind: "choir" }] });
    render(await NewTeamPage(params()));
    expect(screen.getByLabelText(TEAMS_COPY.form.existingLabel)).toBeTruthy();
  });

  const team = (over: Record<string, unknown> = {}) => ({
    groupId: GROUP, name: "Sunday Band", description: null, kind: "team", retired: false, roleBound: false,
    positions: [{ id: "pos1", name: "Vocals", slots: 2, sortOrder: 1 }, { id: "pos2", name: "Keys", slots: 1, sortOrder: 2 }],
    people: [
      { groupMembershipId: "m1", personId: "p1", displayName: "Tobias Renwick", role: "leader", positionIds: [] },
      { groupMembershipId: "m2", personId: "p2", displayName: "Wren Thackeray", role: "member", positionIds: ["pos1"] },
    ],
    ...over,
  });

  it("one team: positions with their three actions, people with 'Can fill:', the seat note, Retire team", async () => {
    reads.getTeamAdmin.mockResolvedValue({ kind: "ok", data: team() });
    render(await TeamPage(params({ groupId: GROUP })));
    expect(screen.getByRole("heading", { level: 1, name: "Sunday Band" })).toBeTruthy();
    expect(screen.getByText(TEAMS_COPY.page.seatNote)).toBeTruthy();
    const positions = screen.getAllByTestId("position-row");
    expect(positions).toHaveLength(2);
    expect(positions[0]!.textContent).toContain("2 people");
    for (const label of [TEAMS_COPY.page.rename, TEAMS_COPY.page.changeNumber, TEAMS_COPY.page.retire]) {
      expect(within(positions[0]!).getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
    const people = screen.getAllByTestId("roster-person");
    expect(people[0]!.textContent).toContain(TEAMS_COPY.page.leaderBadge);
    expect(people[0]!.textContent).toContain(TEAMS_COPY.validation.seatsUnderGroups);
    expect(within(people[0]!).queryByRole("button", { name: new RegExp(TEAMS_COPY.page.removeFromTeam) })).toBeNull();
    expect(people[1]!.textContent).toContain("Can fill: Vocals");
    expect(within(people[1]!).getByRole("button", { name: new RegExp(TEAMS_COPY.page.removeFromTeam) })).toBeTruthy();
    expect(screen.getByLabelText(TEAMS_COPY.page.addPersonLabel)).toBeTruthy();
    expect(screen.getByTestId("retire-team-open")).toBeTruthy();
  });

  it("a retired team offers no editing", async () => {
    reads.getTeamAdmin.mockResolvedValue({ kind: "ok", data: team({ retired: true }) });
    render(await TeamPage(params({ groupId: GROUP })));
    expect(screen.queryByTestId("position-form")).toBeNull();
    expect(screen.queryByTestId("add-person")).toBeNull();
    expect(screen.queryByTestId("retire-team-open")).toBeNull();
    expect(screen.getByText(`${"Sunday Band"} has been retired.`)).toBeTruthy();
  });

  it("an unknown or other organization's team is the organization's 404", async () => {
    reads.getTeamAdmin.mockResolvedValue({ kind: "not_found" });
    await expect(TeamPage(params({ groupId: GROUP }))).rejects.toThrow("NOT_FOUND");
  });
});

describe("Service types", () => {
  it("lists time, length, place and serving teams; empty is an empty state with the next action", async () => {
    reads.getServiceFormOptions.mockResolvedValue({ kind: "ok", data: { types: [], teams: [{ groupId: GROUP, name: "Sunday Band" }] } });
    reads.getServiceTypes.mockResolvedValue({
      kind: "ok",
      data: [{ id: "t1", name: "Sunday worship", startTime: "10:00", durationMinutes: 75, location: "Sanctuary", retired: false, teamIds: [GROUP] }],
    });
    render(await ServiceTypesPage(params()));
    const row = screen.getByTestId("service-types-list").textContent;
    expect(row).toContain("10:00 AM - 75 min - Sanctuary");
    expect(row).toContain("Sunday Band");
    cleanup();
    reads.getServiceTypes.mockResolvedValue({ kind: "ok", data: [] });
    render(await ServiceTypesPage(params()));
    expect(screen.getByText(SERVICES_COPY.types.empty)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: new RegExp(NAV_COPY.newServiceType) }).length).toBeGreaterThan(0);
  });
});

describe("Services", () => {
  const service = (over: Record<string, unknown> = {}) => ({
    eventId: EVENT, title: "Sunday worship", startsAt: "2026-11-15T10:00", location: null, cancelled: false, filled: 3, needed: 8, waiting: 2, ...over,
  });

  it("each service is a card: when, 'N of M positions filled', 'N waiting for an answer'; a cancelled one says Cancelled", async () => {
    reads.getServicesList.mockResolvedValue({ kind: "ok", data: [service(), service({ eventId: "e2", cancelled: true })] });
    render(await ServicesPage({ ...params(), searchParams: Promise.resolve({}) }));
    const list = screen.getByTestId("services-list");
    expect(list.textContent).toContain("Sunday, November 15 at 10:00 AM");
    expect(list.textContent).toContain("3 of 8 positions filled");
    expect(list.textContent).toContain("2 waiting for an answer");
    expect(list.textContent).toContain(SERVICES_COPY.list.cancelledBadge);
    expect(reads.getServicesList).toHaveBeenCalledWith(expect.anything(), { scope: "upcoming" });
  });

  it("'Earlier' reads the earlier scope", async () => {
    reads.getServicesList.mockResolvedValue({ kind: "ok", data: [] });
    render(await ServicesPage({ ...params(), searchParams: Promise.resolve({ scope: "earlier" }) }));
    expect(reads.getServicesList).toHaveBeenCalledWith(expect.anything(), { scope: "earlier" });
    expect(screen.getByRole("link", { name: SERVICES_COPY.list.tabEarlier }).getAttribute("aria-current")).toBe("page");
  });

  it("the add buttons are for worship.plan; an empty list says what to do", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: keys("schedule") });
    reads.getServicesList.mockResolvedValue({ kind: "ok", data: [] });
    render(await ServicesPage({ ...params(), searchParams: Promise.resolve({}) }));
    expect(screen.getByText(SERVICES_COPY.list.empty)).toBeTruthy();
    expect(screen.queryByRole("link", { name: new RegExp(SERVICES_COPY.list.addOne) })).toBeNull();
  });

  it("adding needs worship.plan", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: keys("schedule") });
    render(await NewServicePage(params()));
    expect(screen.getByTestId("worship-forbidden")).toBeTruthy();
  });

  it("add several: with no service type it says to save one first", async () => {
    reads.getServiceFormOptions.mockResolvedValue({ kind: "ok", data: { types: [], teams: [] } });
    render(await GenerateServicesPage(params()));
    expect(screen.getByText(NAV_COPY.noServiceTypesToUse)).toBeTruthy();
    expect(screen.queryByTestId("generate-form")).toBeNull();
  });

  const board = (over: Record<string, unknown> = {}) => ({
    eventId: EVENT, title: "Sunday worship", startsAt: "2026-11-15T10:00", endsAt: null, location: "Sanctuary", cancelled: false, started: false,
    teams: [{
      groupId: GROUP, name: "Sunday Band", canSchedule: true,
      positions: [{ positionId: "pos1", name: "Vocals", slots: 2, filled: 1, assignments: [
        { assignmentId: "a1", personId: "p2", name: "Wren Thackeray", isGuest: false, status: "draft", declineReason: null, noticeOutcome: null, recordedBy: null, mayBeUnder18: false },
      ] }],
    }],
    ...over,
  });

  it("the service page: title, Edit details, Cancel service, teams serving, the board and ONE Send for the service", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board() });
    reads.getServiceFormOptions.mockResolvedValue({ kind: "ok", data: { types: [], teams: [{ groupId: GROUP, name: "Sunday Band" }, { groupId: "g2", name: "Chancel Choir" }] } });
    render(await ServicePage(params({ eventId: EVENT })));
    expect(screen.getByRole("heading", { level: 1, name: "Sunday worship" })).toBeTruthy();
    expect(screen.getByTestId("edit-service-open").textContent).toBe(SERVICES_COPY.page.editDetails);
    expect(screen.getByTestId("cancel-service-open").textContent).toBe(SERVICES_COPY.page.cancelService);
    expect(within(within(screen.getByTestId("teams-serving")).getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Vocals, 1 of 2")).toBeTruthy();
    expect(screen.getAllByTestId("send-open")).toHaveLength(1);
  });

  it("a scheduler without worship.plan sees the board but no service controls", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: keys("schedule") });
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board() });
    render(await ServicePage(params({ eventId: EVENT })));
    expect(screen.queryByTestId("edit-service-open")).toBeNull();
    expect(screen.queryByTestId("cancel-service-open")).toBeNull();
    expect(screen.getByTestId(`add-someone-pos1`)).toBeTruthy();
  });

  it("a cancelled service: the Cancelled badge, no edit, no cancel, no scheduling", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board({ cancelled: true }) });
    reads.getServiceFormOptions.mockResolvedValue({ kind: "ok", data: { types: [], teams: [] } });
    render(await ServicePage(params({ eventId: EVENT })));
    expect(screen.getByTestId("service-cancelled")).toBeTruthy();
    expect(screen.queryByTestId("edit-service-open")).toBeNull();
    expect(screen.queryByTestId("cancel-service-open")).toBeNull();
    expect(screen.queryByTestId("send-open")).toBeNull();
    expect(screen.queryByTestId("add-someone-pos1")).toBeNull();
  });

  it("a service with no serving team opens: a plan holder gets the empty state and the add-a-team control (F435)", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board({ teams: [] }) });
    reads.getServiceFormOptions.mockResolvedValue({ kind: "ok", data: { types: [], teams: [{ groupId: GROUP, name: "Sunday Band" }] } });
    render(await ServicePage(params({ eventId: EVENT })));
    expect(within(screen.getByTestId("teams-serving")).getByText(NAV_COPY.noServingTeams)).toBeTruthy();
    expect(within(screen.getByTestId("teams-serving")).getByRole("combobox")).toBeTruthy();
    expect(screen.getByTestId("edit-service-open")).toBeTruthy();
    expect(screen.getByTestId("cancel-service-open")).toBeTruthy();
  });

  it.each(["manage", "schedule"] as const)("a service with no serving team opens for a viewer holding only worship.%s, with the sentence and no 404 (F435)", async (key) => {
    reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: keys(key) });
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board({ teams: [] }) });
    render(await ServicePage(params({ eventId: EVENT })));
    expect(screen.getByRole("heading", { level: 1, name: "Sunday worship" })).toBeTruthy();
    expect(within(screen.getByTestId("teams-serving")).getByText(NAV_COPY.noServingTeams)).toBeTruthy();
    expect(screen.queryByTestId("edit-service-open")).toBeNull();
  });

  it("a cancelled service with no team shows the same sentence to everyone", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board({ teams: [], cancelled: true }) });
    render(await ServicePage(params({ eventId: EVENT })));
    expect(within(screen.getByTestId("teams-serving")).getByText(NAV_COPY.noServingTeams)).toBeTruthy();
  });

  it("a read the viewer may not make is still the organization's 404", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "forbidden" });
    await expect(ServicePage(params({ eventId: EVENT }))).rejects.toThrow("NOT_FOUND");
  });

  it("an id that is not a worship service is the organization's 404", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "not_found" });
    await expect(ServicePage(params({ eventId: EVENT }))).rejects.toThrow("NOT_FOUND");
  });
});
