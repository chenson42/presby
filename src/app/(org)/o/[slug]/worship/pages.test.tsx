// @vitest-environment jsdom
/**
 * The member worship pages, orchestration level (docs/work-log/2026-11-04-worship-
 * inc1.md, Phase 3 "Component / Page Plan"). The gate runs for real over mocked
 * session, authz and reads: signed out -> sign-in with the deep link, the org miss,
 * off / not applicable, then the page. Pinned: what a member sees, what a non-
 * scheduler sees on the board (the organization's not-found), the closed request,
 * the cancelled card with no buttons, and that no page offers anything the viewer's
 * authority does not.
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
  getMySchedule: vi.fn(),
  getRequest: vi.fn(),
  getMyBlockouts: vi.fn(),
  getTeamPage: vi.fn(),
  getServiceBoard: vi.fn(),
}));
vi.mock("@/lib/worship/reads", () => reads);
vi.mock("./actions", () => ({
  respondToRequestAction: vi.fn(),
  addBlockoutAction: vi.fn(),
  endBlockoutAction: vi.fn(),
  placePersonAction: vi.fn(),
  placeGuestAction: vi.fn(),
  removeAssignmentAction: vi.fn(),
  recordResponseAction: vi.fn(),
  sendRequestsAction: vi.fn(),
  getPickerCandidatesAction: vi.fn(),
  getSendPreviewAction: vi.fn(),
}));
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

import { GATE_COPY, MEMBER_COPY } from "@/lib/worship/copy";
import WorshipHomePage from "./page";
import WorshipRequestPage from "./requests/[assignmentId]/page";
import BlockoutsPage from "./blockouts/page";
import WorshipTeamPage from "./teams/[groupId]/page";
import WorshipBoardPage from "./teams/[groupId]/services/[eventId]/page";

const ID = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";

const OK_ORG = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek Church", organizationType: "congregation" as const, slug: "alder-creek", platformStatus: "managed" as const },
};
const HAS = { manage: false, plan: false, schedule: false };

const item = (over: Record<string, unknown> = {}) => ({
  assignmentId: ID,
  eventId: EVENT,
  title: "Sunday worship",
  startsAt: "2026-11-15T10:00",
  location: "Sanctuary",
  groupId: GROUP,
  teamName: "Sunday Band",
  positionName: "Vocals",
  status: "requested",
  declineReason: null,
  cancelled: false,
  ...over,
});

beforeEach(() => {
  for (const m of [cachedAuth, resolveOrgContext, ...Object.values(reads)]) m.mockReset();
  cachedAuth.mockResolvedValue({ user: { id: "user-1", email: "wren@example.invalid" } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  reads.getWorshipContext.mockResolvedValue({ kind: "ok", has: HAS });
});
afterEach(cleanup);

const params = <T extends object>(p: T) => ({ params: Promise.resolve({ slug: "alder-creek", ...p }) });

describe("the gate, over every member page", () => {
  it("signed out: sign in, with this page's own path as the callback", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(WorshipRequestPage(params({ assignmentId: ID }))).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent(`/o/alder-creek/worship/requests/${ID}`)}`,
    );
  });

  it("an unknown organization is the organization's 404", async () => {
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(WorshipHomePage(params({}))).rejects.toThrow("NOT_FOUND");
  });

  it("no relationship: the one access-denied answer, no worship read", async () => {
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Other Church", organizationType: "congregation" });
    render(await WorshipHomePage(params({})));
    expect(screen.getByText(/you don.t have access to Other Church/i)).toBeTruthy();
    expect(reads.getMySchedule).not.toHaveBeenCalled();
  });

  it("toggle off: the honest off state at 200, with the Features link only for someone who manages features", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: true });
    render(await WorshipHomePage(params({})));
    expect(screen.getByTestId("worship-off").textContent).toContain("Worship isn't turned on for Alder Creek Church yet.");
    expect(screen.getByRole("link", { name: GATE_COPY.offLink })).toBeTruthy();
    expect(reads.getMySchedule).not.toHaveBeenCalled();
  });

  it("a presbytery gets the not-applicable state", async () => {
    reads.getWorshipContext.mockResolvedValue({ kind: "not_applicable" });
    render(await WorshipHomePage(params({})));
    expect(screen.getByTestId("worship-not-applicable")).toBeTruthy();
  });

  it("a failed gate read is a load error, never 'off'", async () => {
    reads.getWorshipContext.mockRejectedValue(new Error("db down"));
    render(await WorshipHomePage(params({})));
    expect(screen.getByTestId("worship-load-error")).toBeTruthy();
    expect(screen.queryByTestId("worship-off")).toBeNull();
  });
});

describe("Worship home", () => {
  it("lists the sections that have rows, in order, and the teams with 'You lead'", async () => {
    reads.getMySchedule.mockResolvedValue({
      kind: "ok",
      data: {
        waiting: [item()],
        scheduled: [item({ assignmentId: "a2", status: "confirmed", positionName: "Keys" })],
        declined: [item({ assignmentId: "a3", status: "declined", declineReason: "family", positionName: "Bass" })],
        teams: [{ groupId: GROUP, name: "Sunday Band", youLead: true }],
      },
    });
    render(await WorshipHomePage(params({})));
    expect(screen.getByRole("heading", { level: 1, name: "Worship" })).toBeTruthy();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([MEMBER_COPY.home.waiting, MEMBER_COPY.home.scheduled, MEMBER_COPY.home.declined, MEMBER_COPY.home.teams]);
    expect(within(screen.getByTestId("section-waiting")).getByText("Vocals, Sunday Band")).toBeTruthy();
    expect(within(screen.getByTestId("section-waiting")).getByTestId("accept")).toBeTruthy();
    expect(within(screen.getByTestId("section-scheduled")).queryByTestId("accept")).toBeNull();
    expect(within(screen.getByTestId("section-declined")).getByTestId("serve-after-all")).toBeTruthy();
    expect(within(screen.getByTestId("section-declined")).getByText("Declined: Family")).toBeTruthy();
    const teamLink = within(screen.getByTestId("section-teams")).getByRole("link", { name: /Sunday Band/ });
    expect(teamLink.getAttribute("href")).toBe(`/o/alder-creek/worship/teams/${GROUP}`);
    expect(teamLink.textContent).toContain(MEMBER_COPY.home.youLead);
    expect(screen.getByRole("link", { name: MEMBER_COPY.home.blockoutsLink }).getAttribute("href")).toBe("/o/alder-creek/worship/blockouts");
  });

  it("a cancelled service says so and offers no buttons", async () => {
    reads.getMySchedule.mockResolvedValue({ kind: "ok", data: { waiting: [item({ cancelled: true })], scheduled: [], declined: [], teams: [] } });
    render(await WorshipHomePage(params({})));
    expect(screen.getByTestId("card-cancelled").textContent).toBe(MEMBER_COPY.home.cancelled);
    expect(screen.queryByTestId("accept")).toBeNull();
    expect(screen.queryByTestId("decline")).toBeNull();
  });

  it("nothing asked: the empty state, with the sentence from Copy", async () => {
    reads.getMySchedule.mockResolvedValue({ kind: "ok", data: { waiting: [], scheduled: [], declined: [], teams: [] } });
    render(await WorshipHomePage(params({})));
    expect(screen.getByText(MEMBER_COPY.home.empty)).toBeTruthy();
    expect(screen.queryByTestId("section-teams")).toBeNull();
  });

  it("a failed read is a load error, never an empty list", async () => {
    reads.getMySchedule.mockRejectedValue(new Error("db down"));
    render(await WorshipHomePage(params({})));
    expect(screen.getByTestId("worship-load-error")).toBeTruthy();
    expect(screen.queryByText(MEMBER_COPY.home.empty)).toBeNull();
  });

  it("a read that answers with a failure result shows the load error", async () => {
    reads.getMySchedule.mockResolvedValue({ kind: "invalid_input", message: "x" });
    render(await WorshipHomePage(params({})));
    expect(screen.getByTestId("worship-load-error")).toBeTruthy();
    expect(screen.queryByText(MEMBER_COPY.home.empty)).toBeNull();
  });
});

describe("Your request to serve", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    assignmentId: ID, organizationName: "Alder Creek Church", eventId: EVENT, groupId: GROUP, title: "Sunday worship",
    startsAt: "2026-11-15T10:00", location: "Sanctuary", teamName: "Sunday Band", positionName: "Vocals",
    status: "requested", declineReason: null, cancelled: false, started: false, open: true, ...over,
  });

  it("an open request: the sentence from Copy, the place, Accept and Decline", async () => {
    reads.getRequest.mockResolvedValue({ kind: "ok", data: request() });
    render(await WorshipRequestPage(params({ assignmentId: ID })));
    expect(screen.getByRole("heading", { level: 1, name: MEMBER_COPY.request.heading })).toBeTruthy();
    expect(screen.getByTestId("request-body").textContent).toBe(
      "Alder Creek Church asks you to serve as Vocals with Sunday Band on Sunday, November 15 at 10:00 AM.",
    );
    expect(screen.getByText("Where: Sanctuary")).toBeTruthy();
    expect(screen.getByTestId("accept")).toBeTruthy();
  });

  it("confirmed: says so, offers only Decline", async () => {
    reads.getRequest.mockResolvedValue({ kind: "ok", data: request({ status: "confirmed" }) });
    render(await WorshipRequestPage(params({ assignmentId: ID })));
    expect(screen.getByText(MEMBER_COPY.request.confirmed)).toBeTruthy();
    expect(screen.queryByTestId("accept")).toBeNull();
  });

  it("a closed request: 'This request is no longer open' with the way back", async () => {
    reads.getRequest.mockResolvedValue({ kind: "ok", data: request({ open: false, cancelled: true }) });
    render(await WorshipRequestPage(params({ assignmentId: ID })));
    expect(screen.getByTestId("request-closed")).toBeTruthy();
    expect(screen.queryByTestId("accept")).toBeNull();
  });

  it("another person's id and an unknown id are the same organization 404", async () => {
    reads.getRequest.mockResolvedValue({ kind: "not_found" });
    await expect(WorshipRequestPage(params({ assignmentId: ID }))).rejects.toThrow("NOT_FOUND");
    await expect(WorshipRequestPage(params({ assignmentId: "nope" }))).rejects.toThrow("NOT_FOUND");
  });
});

describe("Dates I can't serve", () => {
  it("renders the form (in the hydration gate) and the list", async () => {
    reads.getMyBlockouts.mockResolvedValue({ kind: "ok", data: [{ id: "b", startsOn: "2027-01-03", endsOn: "2027-01-17", reason: "work" }] });
    const { container } = render(await BlockoutsPage(params({})));
    expect(screen.getByRole("heading", { level: 1, name: MEMBER_COPY.blockouts.heading })).toBeTruthy();
    expect(screen.getByText(MEMBER_COPY.blockouts.helper)).toBeTruthy();
    expect(container.querySelector("fieldset[data-slot='hydration-gate']")).toBeTruthy();
    expect(screen.getByTestId("blockout-list").textContent).toContain("Work");
  });
});

describe("a team's page", () => {
  const team = (over: Record<string, unknown> = {}) => ({
    groupId: GROUP, name: "Sunday Band", description: null, retired: false, canSchedule: false,
    leaders: [{ personId: "p1", displayName: "Tobias Renwick", role: "leader", canFill: [] }],
    people: [{ personId: "p2", displayName: "Wren Thackeray", role: "member", canFill: ["Vocals", "Keys"] }],
    services: [], ...over,
  });

  it("leaders with a badge, people with what they can fill, no contact details", async () => {
    reads.getTeamPage.mockResolvedValue({ kind: "ok", data: team() });
    render(await WorshipTeamPage(params({ groupId: GROUP })));
    expect(screen.getByRole("heading", { level: 1, name: "Sunday Band" })).toBeTruthy();
    expect(screen.getByText("Leader")).toBeTruthy();
    expect(screen.getByText("Can fill: Vocals, Keys")).toBeTruthy();
    expect(screen.queryByText(/@/)).toBeNull();
    expect(screen.queryByText(MEMBER_COPY.team.upcoming)).toBeNull();
  });

  it("someone who may schedule sees the upcoming services with 'Schedule this team'", async () => {
    reads.getTeamPage.mockResolvedValue({ kind: "ok", data: team({ canSchedule: true, services: [{ eventId: EVENT, title: "Sunday worship", startsAt: "2026-11-15T10:00" }] }) });
    render(await WorshipTeamPage(params({ groupId: GROUP })));
    expect(screen.getByRole("link", { name: MEMBER_COPY.team.schedule }).getAttribute("href")).toBe(`/o/alder-creek/worship/teams/${GROUP}/services/${EVENT}`);
  });

  it("not on the team and no key: the organization's 404", async () => {
    reads.getTeamPage.mockResolvedValue({ kind: "not_found" });
    await expect(WorshipTeamPage(params({ groupId: GROUP }))).rejects.toThrow("NOT_FOUND");
  });
});

describe("the scheduling board", () => {
  const board = (over: Record<string, unknown> = {}, canSchedule = true) => ({
    eventId: EVENT, title: "Sunday worship", startsAt: "2026-11-15T10:00", endsAt: null, location: "Sanctuary",
    cancelled: false, started: false,
    teams: [{
      groupId: GROUP, name: "Sunday Band", canSchedule,
      positions: [{
        positionId: "pos1", name: "Vocals", slots: 2, filled: 1,
        assignments: [{ assignmentId: ID, personId: "p2", name: "Wren Thackeray", isGuest: false, status: "draft", declineReason: null, noticeOutcome: null, recordedBy: null, mayBeUnder18: false }],
      }],
    }],
    ...over,
  });

  it("a scheduler sees 'Vocals, 1 of 2', the person, an Open row, the add buttons and Send (1)", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board() });
    render(await WorshipBoardPage(params({ groupId: GROUP, eventId: EVENT })));
    expect(screen.getByRole("heading", { level: 1, name: "Sunday worship" })).toBeTruthy();
    expect(screen.getByText("Vocals, 1 of 2")).toBeTruthy();
    expect(screen.getByTestId("assignment-row").textContent).toContain("Not sent yet");
    expect(screen.getAllByTestId("open-row")).toHaveLength(1);
    expect(screen.getByTestId("add-someone-pos1")).toBeTruthy();
    expect(screen.getByTestId("add-guest-pos1")).toBeTruthy();
    expect(screen.getByTestId("send-open").textContent).toBe("Send requests (1)");
  });

  it("someone on the roster with neither a key nor the seat: the organization's 404", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "forbidden" });
    await expect(WorshipBoardPage(params({ groupId: GROUP, eventId: EVENT }))).rejects.toThrow("NOT_FOUND");
  });

  it("a board whose team the viewer cannot schedule is a 404 too", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board({}, false) });
    await expect(WorshipBoardPage(params({ groupId: GROUP, eventId: EVENT }))).rejects.toThrow("NOT_FOUND");
  });

  it("a cancelled service shows its status and offers nothing", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board({ cancelled: true }) });
    render(await WorshipBoardPage(params({ groupId: GROUP, eventId: EVENT })));
    expect(screen.getByTestId("service-cancelled")).toBeTruthy();
    expect(screen.queryByTestId("add-someone-pos1")).toBeNull();
    expect(screen.queryByTestId("send-open")).toBeNull();
    expect(screen.queryByTestId(`remove-${ID}`)).toBeNull();
  });

  it("a service that has started says so and offers nothing", async () => {
    reads.getServiceBoard.mockResolvedValue({ kind: "ok", data: board({ started: true }) });
    render(await WorshipBoardPage(params({ groupId: GROUP, eventId: EVENT })));
    expect(screen.getByText("That service has already started.")).toBeTruthy();
    expect(screen.queryByTestId("send-open")).toBeNull();
  });
});
