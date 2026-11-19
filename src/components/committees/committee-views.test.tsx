// @vitest-environment jsdom
/**
 * The committees' read-only views (docs/work-log/2026-11-19-presbytery-
 * committees.md, "Component / Page Plan"): the list's sections and guided empty
 * state; the roster's three sections with role, dates and status badges visible in
 * BOTH the card (below `sm`) and the table (at `sm` and above) layouts; the end
 * control chosen by the seat's state; no write control on a dissolved committee.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions", () => ({
  endCommitteeSeatAction: vi.fn(),
  setCommitteeSeatPublicListedAction: vi.fn(),
}));
vi.mock("@/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions", () => ({
  endCommissionMemberAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import type { CommitteeList, CommitteeListRow, SeatRow } from "@/lib/committees/reads";
import { CommitteesList } from "./committees-list";
import { Roster } from "./roster";

afterEach(cleanup);

const row = (over: Partial<CommitteeListRow>): CommitteeListRow => ({
  id: "c-" + (over.name ?? "x"),
  name: "Ministry",
  meetsWhen: null,
  kind: "required",
  dissolvedOn: null,
  chairNames: [],
  servingCount: 0,
  ...over,
});

const list = (committees: CommitteeListRow[], extra: Partial<CommitteeList> = {}): CommitteeList => ({
  today: "2026-11-19",
  committees,
  dissolvedCount: 0,
  showDissolved: false,
  ...extra,
});

describe("CommitteesList (C2)", () => {
  it("a presbytery with no committee sees the guided empty state with the next action, never a bare 'No committees'", () => {
    render(<CommitteesList list={list([])} slug="northern-reach" />);
    expect(screen.getByText("No committees yet")).toBeTruthy();
    expect(screen.getByText(/Start with the committees your presbytery is required to have/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Create your first committee" });
    expect(link.getAttribute("href")).toBe("/o/northern-reach/admin/committees/new");
  });

  it("groups by kind in the fixed order, omits an empty section and carries the unlabelled prompt", () => {
    render(
      <CommitteesList
        list={list([
          row({ name: "Ad Hoc One", kind: "ad_hoc" }),
          row({ name: "Standing One", kind: "standing" }),
          row({ name: "Required One", kind: "required" }),
          row({ name: "Loose One", kind: null }),
        ])}
        slug="s"
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Required committees", "Standing committees", "Ad hoc committees", "Not yet labelled"]);
    expect(screen.getByText("No label has been chosen for these committees yet. Open each one and choose Required, Standing or Ad hoc.")).toBeTruthy();
  });

  it("shows chair, how many serve and when it meets, in both the card and the table", () => {
    render(
      <CommitteesList
        list={list([row({ name: "Ministry", chairNames: ["Ada Lovelace", "Grace Hopper"], servingCount: 1, meetsWhen: "Monthly" }), row({ name: "Vacant", id: "v", chairNames: [], servingCount: 0 })])}
        slug="s"
      />,
    );
    expect(screen.getAllByText("Chair: Ada Lovelace, Grace Hopper")).toHaveLength(2);
    expect(screen.getAllByText("No chair serving")).toHaveLength(2);
    expect(screen.getAllByText("1 serving")).toHaveLength(2);
    expect(screen.getAllByText("Meets Monthly")).toHaveLength(2);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Chair", "Serving", "Meets"]);
  });

  it("the committee's name is the link, to its own page", () => {
    render(<CommitteesList list={list([row({ id: "abc", name: "Ministry" })])} slug="northern-reach" />);
    const links = screen.getAllByRole("link", { name: "Ministry" });
    expect(links.length).toBe(2);
    for (const link of links) expect(link.getAttribute("href")).toBe("/o/northern-reach/admin/committees/abc");
  });

  it("offers 'Show dissolved committees (n)' as a plain query link, and 'Hide' once shown with the Dissolved section", () => {
    const { rerender } = render(<CommitteesList list={list([row({ name: "Live" })], { dissolvedCount: 2 })} slug="s" />);
    expect(screen.getByRole("link", { name: "Show dissolved committees (2)" }).getAttribute("href")).toBe("/o/s/admin/committees?show=dissolved");
    expect(screen.queryByText("Dissolved committees")).toBeNull();
    rerender(
      <CommitteesList
        list={list([row({ name: "Live" }), row({ name: "Gone", id: "g", dissolvedOn: "2025-05-01" })], { dissolvedCount: 1, showDissolved: true })}
        slug="s"
      />,
    );
    expect(screen.getByRole("heading", { name: "Dissolved committees" })).toBeTruthy();
    expect(screen.getAllByText(/Dissolved/).length).toBeGreaterThan(1);
    expect(screen.getByRole("link", { name: "Hide dissolved committees" }).getAttribute("href")).toBe("/o/s/admin/committees");
  });
});

const seat = (over: Partial<SeatRow>): SeatRow => ({
  membershipId: "m-" + (over.displayName ?? "x"),
  personId: "p",
  displayName: "Ada Lovelace",
  role: "member",
  startsOn: "2026-01-01",
  endsOn: null,
  publicListed: false,
  connected: true,
  deceased: false,
  ...over,
});

const rosterProps = { slug: "s", committeeId: "c1", committeeName: "Ministry", today: "2026-11-19", carries: false, canWrite: true };

describe("Roster (C3)", () => {
  it("splits into Serving now, Starting later and Past members; Past is omitted when empty", () => {
    const { rerender } = render(
      <Roster
        {...rosterProps}
        seats={[
          seat({ displayName: "Serving One" }),
          seat({ displayName: "Later One", startsOn: "2026-12-19" }),
          seat({ displayName: "Past One", endsOn: "2026-06-01" }),
        ]}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Serving now", "Starting later", "Past members"]);
    rerender(<Roster {...rosterProps} seats={[seat({ displayName: "Serving One" })]} />);
    expect(screen.queryByText("Past members")).toBeNull();
  });

  it("role, dates and the two status badges are in the card AND the table (never hidden)", () => {
    render(
      <Roster
        {...rosterProps}
        seats={[
          seat({ displayName: "Chair Person", role: "chair", endsOn: "2027-02-17" }),
          seat({ displayName: "Gone Person", connected: false }),
          seat({ displayName: "Dead Person", deceased: true }),
        ]}
      />,
    );
    expect(screen.getAllByText("Chair")).toHaveLength(2);
    expect(screen.getAllByText("No longer connected to this presbytery")).toHaveLength(2);
    expect(screen.getAllByText("Recorded as deceased")).toHaveLength(2);
    expect(screen.getAllByText(/^Since/)).toHaveLength(6);
    expect(screen.getAllByText(/^Ends/)).toHaveLength(2);
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("chooses the end control by the seat's state: End term, Change end date, Cancel planned term", () => {
    render(
      <Roster
        {...rosterProps}
        seats={[
          seat({ displayName: "Open Seat" }),
          seat({ displayName: "Set End", endsOn: "2027-01-31" }),
          seat({ displayName: "Not Yet", startsOn: "2026-12-19" }),
        ]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^End term/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Change end date/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Cancel planned term/ })).toHaveLength(2);
    // Change role is a link to the role page, named for the person
    const links = screen.getAllByRole("link", { name: "Change role for Open Seat" });
    expect(links[0]!.getAttribute("href")).toBe("/o/s/admin/committees/c1/members/m-Open Seat/role");
  });

  it("the public listing switch is on Serving now rows only", () => {
    render(<Roster {...rosterProps} seats={[seat({ displayName: "Serving One", publicListed: true }), seat({ displayName: "Later One", startsOn: "2026-12-19" })]} />);
    expect(screen.getAllByRole("switch")).toHaveLength(2); // one serving seat, rendered in the card and the table
    expect(screen.getAllByText("Public")).toHaveLength(2);
  });

  it("a past seat has no action, and says 'Ended the day it started' for a zero-length one", () => {
    render(
      <Roster
        {...rosterProps}
        seats={[seat({ displayName: "Past One", startsOn: "2026-03-01", endsOn: "2026-06-01" }), seat({ displayName: "Zero One", startsOn: "2026-11-19", endsOn: "2026-11-19" })]}
      />,
    );
    expect(screen.queryByRole("button", { name: /End term|Change end date|Cancel planned term/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Change role/ })).toBeNull();
    expect(screen.getAllByText("Ended the day it started")).toHaveLength(2);
    expect(screen.getAllByText(/^Started/)).toHaveLength(2);
  });

  it("a dissolved committee (canWrite false) shows no write control at all", () => {
    render(<Roster {...rosterProps} canWrite={false} seats={[seat({ displayName: "Past One", endsOn: "2026-06-01" })]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
  });
});
