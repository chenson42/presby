// @vitest-environment jsdom
/**
 * The commissions section of the list (docs/work-log/2026-11-19-presbytery-committees.md,
 * C15): its own empty state with the next action, rows with the title as the link, the
 * congregation line, appointed date, status badge and serving count in BOTH the card
 * (below `sm`) and the table layouts, the ended toggle, and never a charge.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CommissionList, CommissionListRow } from "@/lib/committees/reads";
import { CommissionsSection } from "./commissions-section";

afterEach(cleanup);

const row = (over: Partial<CommissionListRow>): CommissionListRow => ({
  id: "k-x",
  title: "Commission on Alder Creek",
  aboutOrgId: "o1",
  congregationName: "Alder Creek Church",
  appointedOn: "2026-03-01",
  endedOn: null,
  servingCount: 2,
  ...over,
});

const list = (commissions: CommissionListRow[], extra: Partial<CommissionList> = {}): CommissionList => ({
  today: "2026-11-19",
  commissions,
  endedCount: 0,
  showEnded: false,
  ...extra,
});

const render_ = (l: CommissionList) => render(<CommissionsSection list={l} slug="northern-reach" toggleHref="/o/northern-reach/admin/committees?show=ended" />);

describe("CommissionsSection (C15)", () => {
  it("nothing recorded: the guided empty state with one 'Record a commission' to the new page, and the intro that says no access", () => {
    render_(list([]));
    expect(screen.getByRole("heading", { level: 2, name: "Administrative commissions" })).toBeTruthy();
    expect(screen.getByText("No administrative commissions are recorded.")).toBeTruthy();
    expect(
      screen.getByText(
        "The presbytery's own record of the administrative commissions it has appointed. A record gives no one access to a congregation's PresbyPortal, and the congregation does not see it.",
      ),
    ).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Record a commission" });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/o/northern-reach/admin/committees/commissions/new");
  });

  it("a row: the title links to its page; the congregation, appointed date, status and serving count show in both layouts", () => {
    const { container } = render_(list([row({})]));
    const cards = container.querySelector("ul")!;
    expect(within(cards).getByRole("link", { name: "Commission on Alder Creek" }).getAttribute("href")).toBe(
      "/o/northern-reach/admin/committees/commissions/k-x",
    );
    expect(within(cards).getByText("About Alder Creek Church")).toBeTruthy();
    expect(within(cards).getByText("Active")).toBeTruthy();
    expect(within(cards).getByText("2 serving")).toBeTruthy();
    const table = container.querySelector("table")!;
    for (const head of ["Title", "Congregation", "Appointed", "Status", "Serving"]) expect(within(table).getByText(head)).toBeTruthy();
    expect(within(table).getByText("About Alder Creek Church")).toBeTruthy();
    expect(within(table).getByText("2 serving")).toBeTruthy();
  });

  it("a commission about no congregation says so", () => {
    render_(list([row({ aboutOrgId: null, congregationName: null })]));
    expect(screen.getAllByText("No congregation recorded").length).toBeGreaterThan(0);
  });

  it("orders active ones newest-appointed first", () => {
    const { container } = render_(
      list([
        row({ id: "a", title: "Older", appointedOn: "2025-01-01" }),
        row({ id: "b", title: "Newer", appointedOn: "2026-06-01" }),
      ]),
    );
    const titles = Array.from(container.querySelectorAll("ul li a")).map((a) => a.textContent);
    expect(titles).toEqual(["Newer", "Older"]);
  });

  it("only ended ones exist: no empty state, 'Record a commission' stays and 'Show ended commissions (n)' links to the toggle", () => {
    render_(list([], { endedCount: 3 }));
    expect(screen.queryByText("No administrative commissions are recorded.")).toBeNull();
    expect(screen.getByRole("link", { name: "Record a commission" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show ended commissions (3)" }).getAttribute("href")).toBe("/o/northern-reach/admin/committees?show=ended");
  });

  it("when ended ones are shown they carry 'Ended {date}' and no serving count; the toggle reads 'Hide ended commissions'", () => {
    const { container } = render_(list([row({ id: "e", title: "Done", endedOn: "2026-09-01", servingCount: 0 })], { endedCount: 1, showEnded: true }));
    const cards = container.querySelector("ul")!;
    expect(within(cards).getByText(/^Ended/)).toBeTruthy();
    expect(within(cards).queryByText(/serving/)).toBeNull();
    expect(screen.getByRole("link", { name: "Hide ended commissions" })).toBeTruthy();
  });

  it("never carries a charge", () => {
    render_(list([{ ...row({}), charge: "SECRET CHARGE" } as CommissionListRow]));
    expect(document.body.textContent).not.toContain("SECRET CHARGE");
  });
});
