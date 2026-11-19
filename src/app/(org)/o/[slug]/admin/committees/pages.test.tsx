// @vitest-environment jsdom
/**
 * U8: the committees pages (docs/work-log/2026-11-19-presbytery-committees.md,
 * "Test plan"): the gate runs before any read; a non-UUID segment is a 404 before
 * any reader is called; `forbidden` renders `CommitteesForbidden`; a reader's
 * throw is the load error and an `OrgAccessError` is rethrown; the gate's whole-page
 * states render; `?show` is read as a fixed enum; the form pages render their C4,
 * C5 and C6 states. The placeholder page test this file replaces tested `ComingSoon`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/presbytery-reports/gate", () => ({ gateCommitteesPage: (...a: unknown[]) => gate(...a) }));

vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  }
  return { OrgAccessError: MockOrgAccessError };
});

const reads = vi.hoisted(() => ({
  readCommitteeList: vi.fn(),
  readCommittee: vi.fn(),
  readCommitteeFormDefaults: vi.fn(),
  readSeatFormOptions: vi.fn(),
  readSeat: vi.fn(),
  readCommissionList: vi.fn(),
  readCommission: vi.fn(),
  readCommissionFormOptions: vi.fn(),
  readCommissionMemberFormOptions: vi.fn(),
}));
vi.mock("@/lib/committees/reads", () => reads);

vi.mock("./new/actions", () => ({ createCommitteeAction: vi.fn() }));
vi.mock("./[committeeId]/actions", () => ({
  updateCommitteeAction: vi.fn(),
  addCommitteeSeatAction: vi.fn(),
  changeCommitteeSeatRoleAction: vi.fn(),
  endCommitteeSeatAction: vi.fn(),
  dissolveCommitteeAction: vi.fn(),
  setCommitteeSeatPublicListedAction: vi.fn(),
}));

vi.mock("./commissions/[commissionId]/actions", () => ({ endCommissionMemberAction: vi.fn() }));

const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { OrgAccessError } from "@/lib/authz";
import CommitteesPage from "./page";
import NewCommitteePage from "./new/page";
import CommitteePage from "./[committeeId]/page";
import EditCommitteePage from "./[committeeId]/edit/page";
import AddMemberPage from "./[committeeId]/members/new/page";
import ChangeRolePage from "./[committeeId]/members/[membershipId]/role/page";

const SLUG = "northern-reach";
const CID = "00000000-0000-4000-8000-000000000001";
const MID = "00000000-0000-4000-8000-000000000002";
const IDENTITY = { userId: "u", email: null, personId: "p", organizationId: "o", organizationName: "Presbytery of the Northern Reach", organizationType: "presbytery", slug: SLUG };
const okGate = { ok: true as const, identity: IDENTITY };

const NO_COMMISSIONS = { kind: "ok", data: { today: "2026-11-19", commissions: [], endedCount: 0, showEnded: false } };
beforeEach(() => {
  reads.readCommissionList.mockResolvedValue(NO_COMMISSIONS);
});

afterEach(() => {
  cleanup();
  gate.mockReset();
  Object.values(reads).forEach((m) => m.mockReset());
  notFoundMock.mockClear();
});

const text = () => document.body.textContent ?? "";

const LIST = { today: "2026-11-19", committees: [], dissolvedCount: 0, showDissolved: false };
const DETAIL = { id: CID, name: "Ministry", purpose: "Calls.", meetsWhen: "Monthly", kind: "required", dissolvedOn: null };
const SEAT = { membershipId: MID, personId: "p1", displayName: "Ada Lovelace", role: "chair", startsOn: "2026-01-01", endsOn: null, publicListed: false, connected: true, deceased: false };

describe("every page: the gate runs first and its whole-page states render", () => {
  const cases: Array<[string, () => Promise<React.ReactElement>]> = [
    ["list", async () => CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({}) })],
    ["new", async () => NewCommitteePage({ params: Promise.resolve({ slug: SLUG }) })],
    ["committee", async () => CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) })],
    ["edit", async () => EditCommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) })],
    ["add member", async () => AddMemberPage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) })],
    ["change role", async () => ChangeRolePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID, membershipId: MID }) })],
  ];

  for (const [name, call] of cases) {
    it(`${name}: flag off renders the placeholder and no reader runs`, async () => {
      gate.mockResolvedValue({ ok: false, state: { kind: "flag_off", name: "Presbytery of the Northern Reach" } });
      render(await call());
      expect(text()).toContain("Committees & Commissions isn't turned on for Presbytery of the Northern Reach yet.");
      for (const m of Object.values(reads)) expect(m).not.toHaveBeenCalled();
    });

    it(`${name}: a congregation gets the not-available state`, async () => {
      gate.mockResolvedValue({ ok: false, state: { kind: "not_applicable", name: "Alder Creek" } });
      render(await call());
      expect(text()).toContain("Committees & Commissions isn't available for Alder Creek");
      for (const m of Object.values(reads)) expect(m).not.toHaveBeenCalled();
    });

    it(`${name}: the byte-identical org denial renders from the gate`, async () => {
      gate.mockResolvedValue({ ok: false, state: { kind: "org_forbidden", name: "Presbytery of the Northern Reach", organizationType: "presbytery" } });
      render(await call());
      expect(text()).toContain("You don't have access to Presbytery of the Northern Reach");
      for (const m of Object.values(reads)) expect(m).not.toHaveBeenCalled();
    });
  }

  it("every page names its own gate with its own path", async () => {
    gate.mockResolvedValue({ ok: false, state: { kind: "flag_off", name: "x" } });
    await CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) });
    expect(gate).toHaveBeenCalledWith({ slug: SLUG, path: `/o/${SLUG}/admin/committees/${CID}` });
    await ChangeRolePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID, membershipId: MID }) });
    expect(gate).toHaveBeenCalledWith({ slug: SLUG, path: `/o/${SLUG}/admin/committees/${CID}/members/${MID}/role` });
  });
});

describe("a non-UUID segment is a 404 before any reader is called", () => {
  it("committee, edit, add member and change role", async () => {
    gate.mockResolvedValue(okGate);
    await expect(CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: "not-a-uuid" }) })).rejects.toThrow("NOT_FOUND");
    await expect(EditCommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: "../x" }) })).rejects.toThrow("NOT_FOUND");
    await expect(AddMemberPage({ params: Promise.resolve({ slug: SLUG, committeeId: "commissions" }) })).rejects.toThrow("NOT_FOUND");
    await expect(ChangeRolePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID, membershipId: "zzz" }) })).rejects.toThrow("NOT_FOUND");
    for (const m of Object.values(reads)) expect(m).not.toHaveBeenCalled();
  });

  it("a reader's not_found is a 404 too", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommittee.mockResolvedValue({ kind: "not_found" });
    await expect(CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) })).rejects.toThrow("NOT_FOUND");
  });
});

describe("a reader that says forbidden or throws", () => {
  const callers: Array<[string, () => Promise<React.ReactElement>, keyof typeof reads]> = [
    ["list", async () => CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({}) }), "readCommitteeList"],
    ["new", async () => NewCommitteePage({ params: Promise.resolve({ slug: SLUG }) }), "readCommitteeFormDefaults"],
    ["committee", async () => CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }), "readCommittee"],
    ["edit", async () => EditCommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }), "readCommitteeFormDefaults"],
    ["add member", async () => AddMemberPage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }), "readSeatFormOptions"],
    ["change role", async () => ChangeRolePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID, membershipId: MID }) }), "readSeat"],
  ];
  for (const [name, call, reader] of callers) {
    it(`${name}: forbidden renders the permission sentence naming the presbytery`, async () => {
      gate.mockResolvedValue(okGate);
      reads[reader].mockResolvedValue({ kind: "forbidden" });
      render(await call());
      expect(text()).toContain("You don't have permission to manage committees at Presbytery of the Northern Reach. If you think this is a mistake, ask your presbytery's administrator.");
    });

    it(`${name}: a throw renders the load error with Try again, and an OrgAccessError is rethrown`, async () => {
      gate.mockResolvedValue(okGate);
      reads[reader].mockRejectedValue(new Error("boom"));
      render(await call());
      expect(text()).toContain("We couldn't load committees right now. Try again in a moment.");
      expect(screen.getByRole("link", { name: "Try again" })).toBeTruthy();
      cleanup();
      reads[reader].mockRejectedValue(new (OrgAccessError as unknown as new () => Error)());
      await expect(call()).rejects.toThrow("no active membership");
    });
  }
});

describe("the list page", () => {
  it("reads `?show` as a fixed enum, and renders the head, the New committee button and the sections", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommitteeList.mockResolvedValue({
      kind: "ok",
      data: { ...LIST, committees: [{ id: CID, name: "Ministry", meetsWhen: null, kind: "required", dissolvedOn: null, chairNames: ["Ada Lovelace"], servingCount: 3 }] },
    });
    render(await CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({ show: "dissolved" }) }));
    expect(reads.readCommitteeList).toHaveBeenCalledWith(IDENTITY, { showDissolved: true });
    expect(gate).toHaveBeenCalledWith({ slug: SLUG, path: `/o/${SLUG}/admin/committees?show=dissolved` });
    expect(screen.getByRole("heading", { level: 1, name: "Committees & Commissions" })).toBeTruthy();
    expect(text()).toContain("The committees of Presbytery of the Northern Reach, who serves on each, and the administrative commissions it has recorded.");
    expect(screen.getByRole("link", { name: "New committee" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees/new`);
    expect(screen.getAllByText("Chair: Ada Lovelace").length).toBeGreaterThan(0);
  });

  it("any other `?show` value is not a request for dissolved committees", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommitteeList.mockResolvedValue({ kind: "ok", data: LIST });
    for (const show of ["yes", ["dissolved", "x"], "DISSOLVED", undefined]) {
      reads.readCommitteeList.mockClear();
      render(await CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({ show }) }));
      expect(reads.readCommitteeList).toHaveBeenCalledWith(IDENTITY, { showDissolved: false });
      cleanup();
    }
  });

  it("a presbytery with no committee sees the guided empty state", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommitteeList.mockResolvedValue({ kind: "ok", data: LIST });
    render(await CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({}) }));
    expect(text()).toContain("No committees yet");
    expect(screen.getByRole("link", { name: "Create your first committee" })).toBeTruthy();
  });
});

describe("the committee page", () => {
  const data = (over: Record<string, unknown> = {}) => ({
    kind: "ok",
    data: { committee: DETAIL, seats: [SEAT], carriedRoles: [], today: "2026-11-19", ...over },
  });

  it("renders the heading, the actions, the titles note and the roster; no carries note without a carried role", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommittee.mockResolvedValue(data());
    render(await CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Ministry" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to committees" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees`);
    expect(screen.getByRole("link", { name: "Edit committee" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees/${CID}/edit`);
    expect(screen.getByRole("link", { name: "Add a member" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees/${CID}/members/new`);
    expect(screen.getByRole("button", { name: "Dissolve committee" })).toBeTruthy();
    expect(text()).toContain("Chair, vice chair, clerk, secretary and ex officio are titles. A title doesn't give anyone access.");
    expect(text()).not.toContain("also holds the");
    expect(text()).toContain("Meets Monthly");
    expect(screen.getByRole("heading", { name: "Serving now" })).toBeTruthy();
  });

  it("states a carried role in words and passes it to the dialogs", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommittee.mockResolvedValue(data({ carriedRoles: [{ id: "r", name: "Treasurer" }] }));
    render(await CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(text()).toContain("Everyone serving on this committee also holds the Treasurer role, so adding someone here gives them that role's access.");
  });

  it("an active committee with no one serving shows the empty roster with Add a member", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommittee.mockResolvedValue(data({ seats: [] }));
    render(await CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(text()).toContain("No one serves on this committee yet.");
    expect(screen.getAllByRole("link", { name: "Add a member" }).length).toBe(2);
  });

  it("a dissolved committee says so and shows no write control", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommittee.mockResolvedValue(
      data({ committee: { ...DETAIL, dissolvedOn: "2025-05-01" }, seats: [{ ...SEAT, endsOn: "2025-05-01" }] }),
    );
    render(await CommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(text()).toContain("This committee was dissolved on");
    expect(text()).toContain("Its roster is kept here as history.");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit committee" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add a member" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Past members" })).toBeTruthy();
  });
});

describe("the form pages", () => {
  it("new: the C4 title and the form", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommitteeFormDefaults.mockResolvedValue({ kind: "ok", data: { today: "2026-11-19" } });
    render(await NewCommitteePage({ params: Promise.resolve({ slug: SLUG }) }));
    expect(screen.getByRole("heading", { level: 1, name: "New committee" })).toBeTruthy();
    expect(screen.getByLabelText("Committee name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create committee" })).toBeTruthy();
  });

  it("edit: 'Edit {name}', the stored values, and Back to {name}", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommitteeFormDefaults.mockResolvedValue({
      kind: "ok",
      data: { today: "2026-11-19", committee: { id: CID, name: "Ministry", kind: "required", purpose: "Calls.", meetsWhen: "Monthly" } },
    });
    render(await EditCommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Edit Ministry" })).toBeTruthy();
    expect((screen.getByLabelText("Committee name") as HTMLInputElement).value).toBe("Ministry");
    expect(screen.getByRole("link", { name: "Back to Ministry" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees/${CID}`);
  });

  it("edit of a dissolved committee renders the C4 state, not the form (browser back after a dissolve)", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommitteeFormDefaults.mockResolvedValue({ kind: "committee_dissolved" });
    render(await EditCommitteePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(text()).toContain("This committee was dissolved. A dissolved committee is kept as history and isn't edited here.");
    expect(screen.queryByLabelText("Committee name")).toBeNull();
  });

  const options = (over: Record<string, unknown> = {}) => ({
    kind: "ok",
    data: {
      committeeName: "Ministry",
      people: [
        { personId: "p1", displayName: "Ada Lovelace", alreadyServes: false },
        { personId: "p2", displayName: "Grace Hopper", alreadyServes: true },
      ],
      carriedRoles: [],
      today: "2026-11-19",
      ...over,
    },
  });

  it("add member: the title, the titles note, the form with the disabled 'already serves' option; no carries warning", async () => {
    gate.mockResolvedValue(okGate);
    reads.readSeatFormOptions.mockResolvedValue(options());
    render(await AddMemberPage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Add a member to Ministry" })).toBeTruthy();
    expect(text()).toContain("A title doesn't give anyone access.");
    expect((screen.getByRole("option", { name: "Grace Hopper (already serves)" }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.queryByTestId("carries-role-note")).toBeNull();
  });

  it("add member: the carries warning appears only when the committee carries a role", async () => {
    gate.mockResolvedValue(okGate);
    reads.readSeatFormOptions.mockResolvedValue(options({ carriedRoles: [{ id: "r", name: "Treasurer" }] }));
    render(await AddMemberPage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(screen.getByTestId("carries-role-note").textContent).toBe("This committee carries the Treasurer role. Adding someone here also gives them that role's access.");
  });

  it("add member: no one selectable replaces the form with the guided empty state naming Community and Features", async () => {
    gate.mockResolvedValue(okGate);
    reads.readSeatFormOptions.mockResolvedValue(options({ people: [{ personId: "p2", displayName: "Grace Hopper", alreadyServes: true }] }));
    render(await AddMemberPage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(text()).toContain("No one is available to add");
    expect(text()).toContain('If Community is off for Presbytery of the Northern Reach, turn on "Community: add people and record roll actions" under Features.');
    expect(screen.queryByRole("button", { name: "Add to committee" })).toBeNull();
    expect(screen.queryByLabelText("Person")).toBeNull();
  });

  it("add member to a dissolved committee: the C5 sentence, no form", async () => {
    gate.mockResolvedValue(okGate);
    reads.readSeatFormOptions.mockResolvedValue({ kind: "committee_dissolved" });
    render(await AddMemberPage({ params: Promise.resolve({ slug: SLUG, committeeId: CID }) }));
    expect(text()).toContain("This committee has been dissolved, so no one can be added.");
    expect(screen.queryByRole("button", { name: "Add to committee" })).toBeNull();
  });

  const seatData = (seat: Record<string, unknown>) => ({ kind: "ok", data: { committeeId: CID, committeeName: "Ministry", seat, today: "2026-11-19" } });

  it("change role: 'Change {name}'s role' and 'Now Chair, since {date}.'", async () => {
    gate.mockResolvedValue(okGate);
    reads.readSeat.mockResolvedValue(seatData(SEAT));
    render(await ChangeRolePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID, membershipId: MID }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Change Ada Lovelace's role" })).toBeTruthy();
    expect(text()).toContain("Now Chair, since");
    expect(screen.getByLabelText("New role")).toBeTruthy();
  });

  it("change role on a planned end adds 'It ends {date}.'", async () => {
    gate.mockResolvedValue(okGate);
    reads.readSeat.mockResolvedValue(seatData({ ...SEAT, endsOn: "2027-06-30" }));
    render(await ChangeRolePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID, membershipId: MID }) }));
    expect(text()).toMatch(/It ends/);
  });

  it("change role on a seat that has already ended says so instead of showing a form that would be refused", async () => {
    gate.mockResolvedValue(okGate);
    reads.readSeat.mockResolvedValue(seatData({ ...SEAT, endsOn: "2026-06-01" }));
    render(await ChangeRolePage({ params: Promise.resolve({ slug: SLUG, committeeId: CID, membershipId: MID }) }));
    expect(text()).toContain("That term has already ended.");
    expect(screen.queryByLabelText("New role")).toBeNull();
  });
});
