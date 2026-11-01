// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MembersList } from "./members-list";
import type { DirectoryEntry } from "@/lib/directory";
import type { CommunityRow } from "@/lib/community";
import type { CommunityView } from "@/lib/community-labels";
import {
  COMMUNITY_ARCHIVE_ENDED_REASON,
  PARTICIPANT_REMOVAL_ENDED_REASON,
} from "@/lib/roll-action-kinds";

// The row buttons' dialogs call useRouter; nothing here opens one.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// The Community engagement Server Actions reach the database; the screens under
// test only call them through the dialogs, which these files do not drive.
vi.mock("./actions", () => ({
  changeEngagementAction: vi.fn(),
  archivePersonAction: vi.fn(),
  restorePersonAction: vi.fn(),
  updateVisitDetailsAction: vi.fn(),
}));


afterEach(cleanup);

const ENTRY: DirectoryEntry = {
  personId: "p-1",
  firstName: "Nora",
  lastName: "Ashgrove",
  preferredName: null,
  email: "nora@example.invalid",
  phone: null,
  address: null,
  dateOfBirth: null,
  photoKey: null,
};

const BASE = {
  slug: "alder-creek",
  view: "all" as CommunityView,
  badges: {},
  canManage: true,
  canStaffLink: false,
  search: "",
};

describe("MembersList — empty states (one per view)", () => {
  const cases: Array<[CommunityView, RegExp, RegExp | null]> = [
    ["all", /^no one is listed yet$/i, /add your first person to get started/i],
    ["inactive", /^no one is marked inactive or moved away$/i, /people on the roll who are marked inactive stay under members or participants/i],
    ["members", /^no members yet$/i, /once the session approves their roll action/i],
    ["participants", /^no participants yet$/i, /choose participant/i],
    ["visitors", /^no visitors yet$/i, /add a visitor to keep track/i],
    ["staff", /^no one holds a staff position yet$/i, null],
    ["former", /^no one has been removed or archived$/i, /people you remove as participants or archive appear here/i],
  ];

  it.each(cases)("%s: headline and next step", (view, headline, detail) => {
    render(<MembersList {...BASE} view={view} entries={view === "all" || view === "members" || view === "participants" ? [] : undefined} rows={view === "all" || view === "members" || view === "participants" ? undefined : []} />);
    expect(screen.getByText(headline)).toBeTruthy();
    if (detail) expect(screen.getByText(detail)).toBeTruthy();
  });

  it("Everyone's detail points an administrator at the other views and no one else (Copy group C, audience)", () => {
    const { rerender } = render(<MembersList {...BASE} entries={[]} />);
    expect(
      screen.getByText(
        "Add your first person to get started. People appear here once they are members, participants or regular attenders; visitors, inactive people and staff contacts are under their own views.",
      ),
    ).toBeTruthy();
    rerender(<MembersList {...BASE} canManage={false} entries={[]} />);
    expect(
      screen.getByText("People appear here once they are members, participants or regular attenders."),
    ).toBeTruthy();
    expect(screen.queryByText(/under their own views/i)).toBeNull();
  });

  it("a search with no match names the view: inactive people and former people (Group C)", () => {
    const { rerender } = render(<MembersList {...BASE} view="inactive" rows={[]} search="Zed" />);
    expect(screen.getByText('No inactive people match "Zed". Try a different name or email.')).toBeTruthy();
    rerender(<MembersList {...BASE} view="former" rows={[]} search="Zed" />);
    expect(screen.getByText('No former people match "Zed". Try a different name or email.')).toBeTruthy();
  });

  it("offers Add person on Everyone, Participants and Visitors for a manager", () => {
    for (const view of ["all", "participants", "visitors"] as const) {
      cleanup();
      render(
        <MembersList
          {...BASE}
          view={view}
          entries={view === "visitors" ? undefined : []}
          rows={view === "visitors" ? [] : undefined}
        />,
      );
      expect(screen.getByRole("link", { name: /add person/i })).toBeTruthy();
    }
  });

  it("omits the CTA when the viewer cannot manage", () => {
    render(<MembersList {...BASE} canManage={false} entries={[]} />);
    expect(screen.getByText(/^no one is listed yet$/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /add person/i })).toBeNull();
  });

  it("Staff empty state links to the Staff page only when canStaffLink", () => {
    const { rerender } = render(
      <MembersList {...BASE} view="staff" rows={[]} canStaffLink={true} />,
    );
    expect(
      screen.getByRole("link", { name: /staff page/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/staff");
    rerender(<MembersList {...BASE} view="staff" rows={[]} canStaffLink={false} />);
    expect(screen.queryByRole("link", { name: /staff page/i })).toBeNull();
  });

  it("a search that matched nobody is not the product-empty state", () => {
    render(<MembersList {...BASE} entries={[]} search="zzzznomatch" />);
    expect(screen.getByText(/no people match "zzzznomatch"/i)).toBeTruthy();
    expect(screen.queryByText(/^no one yet$/i)).toBeNull();
  });
});

describe("MembersList — directory entries", () => {
  it("links each card to the person's directory detail page", () => {
    render(<MembersList {...BASE} entries={[ENTRY]} />);
    expect(
      screen
        .getByRole("link", { name: /^nora ashgrove/i })
        .getAttribute("href"),
    ).toBe("/o/alder-creek/directory/p-1");
  });

  it("shows an Edit link to the edit route when the viewer can manage", () => {
    render(<MembersList {...BASE} entries={[ENTRY]} />);
    expect(
      screen.getByRole("link", { name: /^edit/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/community/p-1/edit");
  });

  it("omits the Edit link when the viewer cannot manage", () => {
    render(<MembersList {...BASE} canManage={false} entries={[ENTRY]} />);
    expect(screen.queryByRole("link", { name: /^edit/i })).toBeNull();
  });

  it.each([
    ["active", "Active member"],
    ["baptized", "Baptized member"],
    ["affiliate", "Affiliate member"],
    ["participant", "Participant"],
    ["visitor", "Visitor"],
    ["waiting", "Waiting for the Session"],
  ] as const)("renders the %s badge as %s", (badge, label) => {
    render(<MembersList {...BASE} entries={[ENTRY]} badges={{ "p-1": { roll: badge, engagement: null } }} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("a rolled person marked inactive or moved away carries the engagement badge beside the roll badge (Group C, EC-30)", () => {
    const { rerender } = render(
      <MembersList {...BASE} entries={[ENTRY]} badges={{ "p-1": { roll: "active", engagement: "inactive" } }} />,
    );
    expect(screen.getByText("Active member")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
    rerender(
      <MembersList {...BASE} entries={[ENTRY]} badges={{ "p-1": { roll: "participant", engagement: "moved_away" } }} />,
    );
    expect(screen.getByText("Participant")).toBeTruthy();
    expect(screen.getByText("Moved away")).toBeTruthy();
  });

  it("an engagement badge shows alone when there is no roll badge, and nothing shows when both are null", () => {
    const { rerender } = render(
      <MembersList {...BASE} entries={[ENTRY]} badges={{ "p-1": { roll: null, engagement: "moved_away" } }} />,
    );
    expect(screen.getByText("Moved away")).toBeTruthy();
    rerender(<MembersList {...BASE} entries={[ENTRY]} badges={{ "p-1": { roll: null, engagement: null } }} />);
    expect(screen.queryByText("Moved away")).toBeNull();
  });

  it("renders no badge for a person without one", () => {
    render(<MembersList {...BASE} entries={[ENTRY]} />);
    expect(screen.queryByText(/participant|visitor|waiting|member$/i)).toBeNull();
  });

  it("counts people, singular and plural", () => {
    render(<MembersList {...BASE} entries={[ENTRY]} />);
    expect(screen.getByText(/showing 1 person$/i)).toBeTruthy();
  });
});

describe("MembersList — admin rows (Visitors, Staff, Former)", () => {
  const ROW: CommunityRow = {
    personId: "p-9",
    displayName: "Wren Alder",
    email: "wren@example.invalid",
    firstVisitDate: "2026-03-01",
    positions: ["Organist", "Sexton"],
    endedOn: "2026-04-02",
    engagementStatus: "visitor",
    endedReason: null,
    signInConnected: false,
  };

  it("Visitors: links to the edit page and shows the first visit", () => {
    render(<MembersList {...BASE} view="visitors" rows={[ROW]} />);
    expect(screen.getByText(/first visit/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /^edit/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/community/p-9/edit");
  });

  it("Staff: shows the open position titles", () => {
    render(<MembersList {...BASE} view="staff" rows={[ROW]} />);
    expect(screen.getByText("Organist, Sexton")).toBeTruthy();
  });

  it("Staff: an anchor with no position reads 'No position yet' and links to the Staff page only when canStaffLink", () => {
    const anchor = { ...ROW, positions: [] };
    const { rerender } = render(
      <MembersList {...BASE} view="staff" rows={[anchor]} canStaffLink={true} />,
    );
    expect(screen.getByText(/no position yet/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /add a position/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/staff");
    // The row still links to the edit page.
    expect(
      screen.getByRole("link", { name: /^edit/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/community/p-9/edit");
    rerender(<MembersList {...BASE} view="staff" rows={[anchor]} canStaffLink={false} />);
    expect(screen.getByText(/no position yet/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /add a position/i })).toBeNull();
  });

  it("Staff: a row with a position never shows the 'No position yet' note", () => {
    render(<MembersList {...BASE} view="staff" rows={[ROW]} canStaffLink={true} />);
    expect(screen.queryByText(/no position yet/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /add a position/i })).toBeNull();
  });

  it("Former: shows the removal date", () => {
    render(<MembersList {...BASE} view="former" rows={[ROW]} />);
    expect(screen.getByText(/removed/i)).toBeTruthy();
  });

  it.each([
    ["removed participant", "participant_removed", "visitor", /^Removed\s/],
    ["archived visitor", "community_archive", "visitor", /^Archived visitor, /],
    ["archived inactive person", "community_archive", "inactive", /^Archived, /],
  ] as const)("Former detail: %s (Group D)", (_label, reason, engagement, expected) => {
    render(
      <MembersList
        {...BASE}
        view="former"
        rows={[{ ...ROW, endedReason: reason === "participant_removed" ? PARTICIPANT_REMOVAL_ENDED_REASON : COMMUNITY_ARCHIVE_ENDED_REASON, engagementStatus: engagement }]}
      />,
    );
    const detail = document.querySelector("li p.text-muted-foreground:last-of-type") as HTMLElement;
    expect(detail.textContent ?? "").toMatch(expected);
  });

  it("Inactive: the row detail reads Inactive or Moved away", () => {
    const { rerender } = render(
      <MembersList {...BASE} view="inactive" rows={[{ ...ROW, engagementStatus: "inactive", endedOn: null }]} />,
    );
    expect(screen.getByText("Inactive", { selector: "p" })).toBeTruthy();
    rerender(
      <MembersList {...BASE} view="inactive" rows={[{ ...ROW, engagementStatus: "moved_away", endedOn: null }]} />,
    );
    expect(screen.getByText("Moved away", { selector: "p" })).toBeTruthy();
  });

  describe("the row buttons (Group C)", () => {
    const names = () =>
      screen
        .queryAllByRole("button")
        .map((b) => b.textContent)
        .filter((t) => t !== "Search");

    it("Visitors: Archive only", () => {
      render(<MembersList {...BASE} view="visitors" rows={[{ ...ROW, endedOn: null }]} />);
      expect(names()).toEqual(["Archive Wren Alder"]);
    });

    it("Inactive: Mark as regular and Archive, each named for the person", () => {
      render(<MembersList {...BASE} view="inactive" rows={[{ ...ROW, engagementStatus: "inactive", endedOn: null }]} />);
      expect(names()).toEqual(["Mark as regular Wren Alder", "Archive Wren Alder"]);
    });

    it("Former: Restore on an archived row, nothing on a removed participant", () => {
      const { rerender } = render(
        <MembersList {...BASE} view="former" rows={[{ ...ROW, endedReason: COMMUNITY_ARCHIVE_ENDED_REASON }]} />,
      );
      expect(names()).toEqual(["Restore Wren Alder"]);
      rerender(
        <MembersList {...BASE} view="former" rows={[{ ...ROW, endedReason: PARTICIPANT_REMOVAL_ENDED_REASON }]} />,
      );
      expect(names()).toEqual([]);
    });

    it("Staff: no row buttons", () => {
      render(<MembersList {...BASE} view="staff" rows={[ROW]} />);
      expect(names()).toEqual([]);
    });
  });
});

describe("MembersList — search form", () => {
  it("renders a search input and no status select", () => {
    render(<MembersList {...BASE} entries={[]} />);
    expect(screen.getByLabelText(/search people/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^status$/i)).toBeNull();
  });

  it("pre-fills the search and carries the view as a hidden field", () => {
    const { container } = render(
      <MembersList {...BASE} view="participants" entries={[ENTRY]} search="Nora" />,
    );
    expect((screen.getByLabelText(/search people/i) as HTMLInputElement).value).toBe(
      "Nora",
    );
    const hidden = container.querySelector('input[type="hidden"][name="view"]');
    expect((hidden as HTMLInputElement).value).toBe("participants");
  });

  it("omits the hidden view field on Everyone", () => {
    const { container } = render(<MembersList {...BASE} entries={[]} />);
    expect(container.querySelector('input[type="hidden"][name="view"]')).toBeNull();
  });
});

describe("MembersList — pagination", () => {
  it("renders Pagination when there is more than one page, keeping view and search", () => {
    render(
      <MembersList
        {...BASE}
        view="members"
        search="Nora"
        entries={[ENTRY]}
        pagination={{ page: 1, pageSize: 25, total: 30, totalPages: 2 }}
      />,
    );
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    const next = within(document.body)
      .getAllByRole("link")
      .find((a) => /page=2/.test(a.getAttribute("href") ?? ""));
    expect(next?.getAttribute("href")).toContain("view=members");
    expect(next?.getAttribute("href")).toContain("search=Nora");
  });

  it("renders no pagination controls when pagination is omitted", () => {
    render(<MembersList {...BASE} entries={[ENTRY]} />);
    expect(screen.queryByText(/page \d+ of \d+/i)).toBeNull();
  });
});
