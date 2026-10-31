// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MembersList } from "./members-list";
import type { DirectoryEntry } from "@/lib/directory";
import type { CommunityRow } from "@/lib/community";
import type { CommunityView } from "@/lib/community-labels";

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
  photoThumbKey: null,
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
    ["all", /^no one yet$/i, /add your first person to get started/i],
    ["members", /^no members yet$/i, /once the session approves their roll action/i],
    ["participants", /^no participants yet$/i, /choose participant/i],
    ["visitors", /^no visitors yet$/i, /add a visitor to keep track/i],
    ["staff", /^no one holds a staff position yet$/i, null],
    ["former", /^no former participants$/i, null],
  ];

  it.each(cases)("%s: headline and next step", (view, headline, detail) => {
    render(<MembersList {...BASE} view={view} entries={view === "all" || view === "members" || view === "participants" ? [] : undefined} rows={view === "all" || view === "members" || view === "participants" ? undefined : []} />);
    expect(screen.getByText(headline)).toBeTruthy();
    if (detail) expect(screen.getByText(detail)).toBeTruthy();
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
    expect(screen.getByText(/^no one yet$/i)).toBeTruthy();
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
    render(<MembersList {...BASE} entries={[ENTRY]} badges={{ "p-1": badge }} />);
    expect(screen.getByText(label)).toBeTruthy();
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
