// @vitest-environment jsdom
/**
 * The commission pages (docs/work-log/2026-11-19-presbytery-committees.md, C15): the
 * gate runs before any read; a non-UUID segment is a 404 before any reader is called;
 * `forbidden` renders `CommitteesForbidden`; a reader's throw is the load error and an
 * `OrgAccessError` is rethrown; the commission page carries the no-access sentence, the
 * charge, the About line (with the congregation that has left), and shows its write
 * controls only on an active record; the list's commissions section fails on its own.
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
  readCommissionList: vi.fn(),
  readCommission: vi.fn(),
  readCommissionFormOptions: vi.fn(),
  readCommissionMemberFormOptions: vi.fn(),
}));
vi.mock("@/lib/committees/reads", () => reads);

vi.mock("./actions", () => ({ recordCommissionAction: vi.fn() }));
vi.mock("./[commissionId]/actions", () => ({
  updateCommissionAction: vi.fn(),
  addCommissionMemberAction: vi.fn(),
  endCommissionMemberAction: vi.fn(),
  endCommissionAction: vi.fn(),
  removeCommissionRecordAction: vi.fn(),
}));
vi.mock("../[committeeId]/actions", () => ({ endCommitteeSeatAction: vi.fn() }));

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
import CommitteesPage from "../page";
import NewCommissionPage from "./new/page";
import CommissionPage from "./[commissionId]/page";
import EditCommissionPage from "./[commissionId]/edit/page";
import AddCommissionMemberPage from "./[commissionId]/members/new/page";

const SLUG = "northern-reach";
const KID = "00000000-0000-4000-8000-0000000000a1";
const MID = "00000000-0000-4000-8000-0000000000a2";
const ORG = "Presbytery of the Northern Reach";
const IDENTITY = { userId: "u", email: null, personId: "p", organizationId: "o", organizationName: ORG, organizationType: "presbytery", slug: SLUG };
const okGate = { ok: true as const, identity: IDENTITY };

const text = () => document.body.textContent ?? "";

const COMMITTEES = { kind: "ok", data: { today: "2026-11-19", committees: [], dissolvedCount: 0, showDissolved: false } };
const COMMISSION = {
  id: KID,
  title: "Commission on Alder Creek",
  charge: "Look into the building.",
  aboutOrgId: "c1",
  congregationName: "Alder Creek Church",
  congregationIsMember: true,
  appointedOn: "2026-03-01",
  minuteReference: "Stated meeting, item 4",
  endedOn: null,
  endedMinuteReference: null,
  rowVersion: 3,
};
const MEMBER = { memberId: MID, personId: "p1", displayName: "Ada Lovelace", role: "chair", startsOn: "2026-03-01", endsOn: null, connected: true, deceased: false };
const page = (over: Record<string, unknown> = {}, members: unknown[] = [MEMBER]) => ({
  kind: "ok",
  data: { today: "2026-11-19", commission: { ...COMMISSION, ...over }, members },
});

beforeEach(() => {
  reads.readCommitteeList.mockResolvedValue(COMMITTEES);
});
afterEach(() => {
  cleanup();
  gate.mockReset();
  Object.values(reads).forEach((m) => m.mockReset());
  notFoundMock.mockClear();
});

describe("every commission page: the gate runs first and its whole-page states render", () => {
  const cases: Array<[string, () => Promise<React.ReactElement>]> = [
    ["new", async () => NewCommissionPage({ params: Promise.resolve({ slug: SLUG }) })],
    ["commission", async () => CommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) })],
    ["edit", async () => EditCommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) })],
    ["add member", async () => AddCommissionMemberPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) })],
  ];
  for (const [name, call] of cases) {
    it(`${name}: flag off renders the placeholder and no reader runs`, async () => {
      gate.mockResolvedValue({ ok: false, state: { kind: "flag_off", name: ORG } });
      render(await call());
      expect(text()).toContain(`Committees & Commissions isn't turned on for ${ORG} yet.`);
      for (const m of Object.values(reads)) expect(m).not.toHaveBeenCalled();
    });
    it(`${name}: the byte-identical org denial renders from the gate`, async () => {
      gate.mockResolvedValue({ ok: false, state: { kind: "org_forbidden", name: ORG, organizationType: "presbytery" } });
      render(await call());
      expect(text()).toContain(`You don't have access to ${ORG}`);
      for (const m of Object.values(reads)) expect(m).not.toHaveBeenCalled();
    });
  }

  it("each names its own gate with its own path", async () => {
    gate.mockResolvedValue({ ok: false, state: { kind: "flag_off", name: "x" } });
    await CommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) });
    expect(gate).toHaveBeenCalledWith({ slug: SLUG, path: `/o/${SLUG}/admin/committees/commissions/${KID}` });
    await AddCommissionMemberPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) });
    expect(gate).toHaveBeenCalledWith({ slug: SLUG, path: `/o/${SLUG}/admin/committees/commissions/${KID}/members/new` });
    await NewCommissionPage({ params: Promise.resolve({ slug: SLUG }) });
    expect(gate).toHaveBeenCalledWith({ slug: SLUG, path: `/o/${SLUG}/admin/committees/commissions/new` });
  });
});

describe("a non-UUID segment is a 404 before any reader is called", () => {
  it("commission, edit and add member; and a reader's not_found is a 404 too", async () => {
    gate.mockResolvedValue(okGate);
    await expect(CommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: "not-a-uuid" }) })).rejects.toThrow("NOT_FOUND");
    await expect(EditCommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: "../x" }) })).rejects.toThrow("NOT_FOUND");
    await expect(AddCommissionMemberPage({ params: Promise.resolve({ slug: SLUG, commissionId: "new" }) })).rejects.toThrow("NOT_FOUND");
    for (const m of Object.values(reads)) expect(m).not.toHaveBeenCalled();

    reads.readCommission.mockResolvedValue({ kind: "not_found" });
    await expect(CommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) })).rejects.toThrow("NOT_FOUND");
    reads.readCommissionMemberFormOptions.mockResolvedValue({ kind: "not_found" });
    await expect(AddCommissionMemberPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) })).rejects.toThrow("NOT_FOUND");
  });
});

describe("a reader that says forbidden or throws", () => {
  const callers: Array<[string, () => Promise<React.ReactElement>, keyof typeof reads]> = [
    ["new", async () => NewCommissionPage({ params: Promise.resolve({ slug: SLUG }) }), "readCommissionFormOptions"],
    ["commission", async () => CommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) }), "readCommission"],
    ["add member", async () => AddCommissionMemberPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) }), "readCommissionMemberFormOptions"],
  ];
  for (const [name, call, reader] of callers) {
    it(`${name}: forbidden renders the permission sentence naming the presbytery`, async () => {
      gate.mockResolvedValue(okGate);
      reads[reader].mockResolvedValue({ kind: "forbidden" });
      render(await call());
      expect(text()).toContain(`You don't have permission to manage committees at ${ORG}.`);
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

describe("the commission page", () => {
  const show = async () => render(await CommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) }));

  it("an active record: the title, About, appointed and minute, the charge, the no-access sentence, the four actions and the roster", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommission.mockResolvedValue(page());
    await show();
    expect(screen.getByRole("heading", { level: 1, name: "Commission on Alder Creek" })).toBeTruthy();
    expect(screen.getByText("About Alder Creek Church")).toBeTruthy();
    expect(text()).toContain("Appointed");
    expect(text()).toContain("Minute: Stated meeting, item 4");
    expect(screen.getByRole("heading", { level: 2, name: "Charge" })).toBeTruthy();
    expect(screen.getByText("Look into the building.")).toBeTruthy();
    expect(screen.getByText("This record gives no one access to Alder Creek Church's PresbyPortal, and Alder Creek Church does not see it.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to committees" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees`);
    expect(screen.getByRole("link", { name: "Edit commission" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees/commissions/${KID}/edit`);
    expect(screen.getByRole("link", { name: "Add a member" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees/commissions/${KID}/members/new`);
    expect(screen.getByRole("button", { name: "End commission" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove this record" })).toBeTruthy();
    expect(screen.getByText("Chair, vice chair, clerk, secretary and ex officio are titles. A title doesn't give anyone access.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Serving now" })).toBeTruthy();
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
  });

  it("a commission about no congregation says so and uses the any-congregation sentence", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommission.mockResolvedValue(page({ aboutOrgId: null, congregationName: null, congregationIsMember: false }));
    await show();
    expect(screen.getByText("No congregation recorded")).toBeTruthy();
    expect(screen.getByText("This record gives no one access to any congregation's PresbyPortal.")).toBeTruthy();
  });

  it("a congregation that has left the presbytery says so", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommission.mockResolvedValue(page({ congregationIsMember: false }));
    await show();
    expect(screen.getByText("About Alder Creek Church (no longer a member of this presbytery)")).toBeTruthy();
  });

  it("no minute, no charge: 'No minute recorded' and no Charge heading", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommission.mockResolvedValue(page({ minuteReference: null, charge: null }));
    await show();
    expect(text()).toContain("No minute recorded");
    expect(screen.queryByRole("heading", { name: "Charge" })).toBeNull();
  });

  it("an ended record shows Ended and Reported in, and offers only Edit and Remove: no add, no end, no member control", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommission.mockResolvedValue(
      page({ endedOn: "2026-09-01", endedMinuteReference: "Stated meeting, item 9" }, [{ ...MEMBER, endsOn: "2026-09-01" }]),
    );
    await show();
    expect(text()).toContain("Reported in: Stated meeting, item 9");
    expect(screen.getByRole("link", { name: "Edit commission" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove this record" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Add a member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End commission" })).toBeNull();
    expect(screen.queryByRole("button", { name: /End term/ })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Past members" })).toBeTruthy();
  });

  it("an active commission with no one serving shows the empty-roster line with Add a member; an ended one shows nothing extra", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommission.mockResolvedValue(page({}, []));
    await show();
    expect(text()).toContain("No one serves on this commission yet.");
    expect(screen.getAllByRole("link", { name: "Add a member" })).toHaveLength(2);
    cleanup();
    reads.readCommission.mockResolvedValue(page({ endedOn: "2026-09-01" }, []));
    await show();
    expect(text()).not.toContain("No one serves on this commission yet.");
  });

  it("an active member row offers the end control, named for the person", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommission.mockResolvedValue(page());
    await show();
    expect(screen.getAllByRole("button", { name: "End term for Ada Lovelace" }).length).toBeGreaterThan(0);
  });
});

describe("the form pages", () => {
  it("new: 'Record a commission', the congregation choices and the helper", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommissionFormOptions.mockResolvedValue({ kind: "ok", data: { today: "2026-11-19", congregations: [{ id: "c1", name: "Alder Creek Church" }] } });
    render(await NewCommissionPage({ params: Promise.resolve({ slug: SLUG }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Record a commission" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to committees" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "No congregation" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Alder Creek Church" })).toBeTruthy();
  });

  it("edit: 'Edit commission', the stored values, and Back to {title}; an ended record is still editable", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommission.mockResolvedValue(page({ endedOn: "2026-09-01" }));
    reads.readCommissionFormOptions.mockResolvedValue({ kind: "ok", data: { today: "2026-11-19", congregations: [{ id: "c1", name: "Alder Creek Church" }] } });
    render(await EditCommissionPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Edit commission" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Commission on Alder Creek" })).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Commission on Alder Creek");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("add member: the title, the titles note and the form", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommissionMemberFormOptions.mockResolvedValue({
      kind: "ok",
      data: { commissionTitle: "Commission on Alder Creek", today: "2026-11-19", people: [{ personId: "p1", displayName: "Ada Lovelace", alreadyServes: false }] },
    });
    render(await AddCommissionMemberPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Add a member to Commission on Alder Creek" })).toBeTruthy();
    expect(screen.getByText(/Chair, vice chair, clerk, secretary and ex officio are titles\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to commission" })).toBeTruthy();
  });

  it("add member: no one selectable replaces the form with the guided empty state naming Community and Features", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommissionMemberFormOptions.mockResolvedValue({
      kind: "ok",
      data: { commissionTitle: "K", today: "2026-11-19", people: [{ personId: "p1", displayName: "Ada", alreadyServes: true }] },
    });
    render(await AddCommissionMemberPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) }));
    expect(screen.getByText("No one is available to add")).toBeTruthy();
    expect(text()).toContain(`If Community is off for ${ORG}, turn on "Community: add people and record roll actions" under Features.`);
    expect(screen.queryByRole("button", { name: "Add to commission" })).toBeNull();
  });

  it("add member to an ended commission: the C15 sentence, no form", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommissionMemberFormOptions.mockResolvedValue({ kind: "commission_ended" });
    render(await AddCommissionMemberPage({ params: Promise.resolve({ slug: SLUG, commissionId: KID }) }));
    expect(text()).toContain("This commission has ended, so no one can be added.");
    expect(screen.queryByRole("button", { name: "Add to commission" })).toBeNull();
  });
});

describe("the list page's commissions section", () => {
  const list = (over: Record<string, unknown> = {}) => ({ kind: "ok", data: { today: "2026-11-19", commissions: [], endedCount: 0, showEnded: false, ...over } });

  it("reads `?show` as a fixed enum: ended, both, and anything else is no request", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommissionList.mockResolvedValue(list());
    const call = async (show: string | string[] | undefined) => {
      reads.readCommissionList.mockClear();
      reads.readCommitteeList.mockClear();
      render(await CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({ show }) }));
      cleanup();
    };
    await call("ended");
    expect(reads.readCommissionList).toHaveBeenCalledWith(IDENTITY, { showEnded: true });
    expect(reads.readCommitteeList).toHaveBeenCalledWith(IDENTITY, { showDissolved: false });
    await call(["dissolved", "ended"]);
    expect(reads.readCommissionList).toHaveBeenCalledWith(IDENTITY, { showEnded: true });
    expect(reads.readCommitteeList).toHaveBeenCalledWith(IDENTITY, { showDissolved: true });
    for (const show of ["yes", ["ended", "x"], "ENDED", undefined]) {
      await call(show);
      expect(reads.readCommissionList).toHaveBeenCalledWith(IDENTITY, { showEnded: false });
    }
  });

  it("renders the section below the committees with its empty state and the next action", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommissionList.mockResolvedValue(list());
    render(await CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 2, name: "Administrative commissions" })).toBeTruthy();
    expect(text()).toContain("No administrative commissions are recorded.");
    expect(screen.getByRole("link", { name: "Record a commission" })).toBeTruthy();
  });

  it("the show-ended toggle keeps the other list's toggle", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommitteeList.mockResolvedValue({ kind: "ok", data: { today: "2026-11-19", committees: [], dissolvedCount: 0, showDissolved: true } });
    reads.readCommissionList.mockResolvedValue(list({ endedCount: 2 }));
    render(await CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({ show: "dissolved" }) }));
    expect(screen.getByRole("link", { name: "Show ended commissions (2)" }).getAttribute("href")).toBe(`/o/${SLUG}/admin/committees?show=dissolved&show=ended`);
  });

  it("a throw in the commissions reader is its own section error with Try again, and the committees stay; an OrgAccessError is rethrown", async () => {
    gate.mockResolvedValue(okGate);
    reads.readCommissionList.mockRejectedValue(new Error("boom"));
    render(await CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({}) }));
    expect(text()).toContain("We couldn't load this. Try again.");
    expect(screen.getByRole("heading", { level: 1, name: "Committees & Commissions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New committee" })).toBeTruthy();
    cleanup();
    reads.readCommissionList.mockRejectedValue(new (OrgAccessError as unknown as new () => Error)());
    await expect(CommitteesPage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({}) })).rejects.toThrow("no active membership");
  });
});
