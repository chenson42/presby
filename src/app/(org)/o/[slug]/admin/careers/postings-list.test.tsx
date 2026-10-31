// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostingRow } from "@/lib/careers/postings";

vi.mock("./actions", () => ({ movePostingAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { PostingsList } from "./postings-list";

afterEach(cleanup);

const TODAY = "2026-11-03";

function row(overrides: Partial<PostingRow>): PostingRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "custodian",
    title: "Custodian",
    summary: "s",
    location: "Main campus",
    employmentType: "full_time",
    payMinCents: null,
    payMaxCents: null,
    payUnit: null,
    descriptionMd: "d",
    closingDate: null,
    status: "published",
    sortOrder: 0,
    version: 1,
    postedOn: "2026-10-30",
    firstPublishedAt: "2026-10-30T12:00:00Z",
    closedAt: null,
    updatedAt: "2026-10-30T12:00:00Z",
    visibleToPublic: true,
    ...overrides,
  };
}

const mk = (n: number, o: Partial<PostingRow>) =>
  row({ id: `${String(n).repeat(8)}-1111-4111-8111-111111111111`, slug: `slug-${n}`, title: `Opening ${n}`, ...o });

describe("PostingsList - T20", () => {
  it("empty: the helpful state with its next action", () => {
    render(<PostingsList slug="alder-creek" postings={[]} orgToday={TODAY} />);
    expect(screen.getByText("You haven't created any job openings yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create your first job opening" }).getAttribute("href")).toBe("/o/alder-creek/admin/careers/new");
  });

  it("sections carry their counts; Closed is a native <details>; empty sections are not rendered", () => {
    render(
      <PostingsList
        slug="alder-creek"
        orgToday={TODAY}
        postings={[
          mk(1, {}),
          mk(2, {}),
          mk(3, { status: "draft", firstPublishedAt: null, postedOn: null }),
          mk(4, { status: "closed", closedAt: "2026-11-01T00:00:00Z", visibleToPublic: false }),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Published (2)" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Drafts (1)" })).toBeTruthy();
    const closed = screen.getByTestId("careers-closed");
    expect(closed.tagName).toBe("DETAILS");
    expect(within(closed).getByText("Closed (1)").tagName).toBe("SUMMARY");
  });

  it("no Drafts or Closed section when there are none", () => {
    render(<PostingsList slug="alder-creek" orgToday={TODAY} postings={[mk(1, {})]} />);
    expect(screen.queryByText(/Drafts \(/)).toBeNull();
    expect(screen.queryByTestId("careers-closed")).toBeNull();
  });

  it("badges: Draft, Published, Closing date passed, Closed and Never published (a discarded draft)", () => {
    render(
      <PostingsList
        slug="alder-creek"
        orgToday={TODAY}
        postings={[
          mk(1, {}),
          mk(2, { closingDate: "2026-10-01", visibleToPublic: false }),
          mk(3, { status: "draft", firstPublishedAt: null, postedOn: null }),
          mk(4, { status: "closed", visibleToPublic: false }),
          mk(5, { status: "closed", visibleToPublic: false, firstPublishedAt: null, postedOn: null }),
        ]}
      />,
    );
    const texts = screen.getAllByTestId("posting-row").map((li) => within(li).getAllByText(/^(Draft|Published|Closing date passed|Closed|Never published)$/)[0]!.textContent);
    expect(texts).toEqual(["Published", "Closing date passed", "Draft", "Closed", "Never published"]);
  });

  it("the derived 'closing date has passed' row explains itself and offers no website link", () => {
    render(<PostingsList slug="alder-creek" orgToday={TODAY} postings={[mk(1, { closingDate: "2026-10-01", visibleToPublic: false })]} />);
    expect(screen.getByText("No longer shown on your website. It will be marked Closed automatically.")).toBeTruthy();
    expect(screen.getByText("Closing date: Thursday, October 1, 2026")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View on your website" })).toBeNull();
  });

  it("the stale hint appears at 60 days with no closing date, and not at 59 or with a date", () => {
    const { rerender } = render(<PostingsList slug="alder-creek" orgToday="2026-12-29" postings={[mk(1, { postedOn: "2026-10-30" })]} />);
    expect(screen.getByText(/Posted Friday, October 30, 2026 with no closing date. Close it if it has been filled./)).toBeTruthy();
    rerender(<PostingsList slug="alder-creek" orgToday="2026-12-28" postings={[mk(1, { postedOn: "2026-10-30" })]} />);
    expect(screen.queryByText(/with no closing date/)).toBeNull();
    rerender(<PostingsList slug="alder-creek" orgToday="2027-03-01" postings={[mk(1, { postedOn: "2026-10-30", closingDate: "2027-06-01" })]} />);
    expect(screen.queryByText(/with no closing date/)).toBeNull();
  });

  it("move buttons are on published rows only, named by title; the first can't go up and the last can't go down", () => {
    render(
      <PostingsList
        slug="alder-creek"
        orgToday={TODAY}
        postings={[mk(1, {}), mk(2, {}), mk(3, { status: "draft", firstPublishedAt: null, postedOn: null })]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Move / })).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Move Opening 3 up" })).toBeNull();
    // Disabled before hydration anyway (jsdom renders after hydration, so position decides).
    expect(screen.getByRole("button", { name: "Move Opening 1 up" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Move Opening 2 down" }).hasAttribute("disabled")).toBe(true);
  });

  it("'View on your website' only for a published, still-open row, as a slug URL", () => {
    render(
      <PostingsList
        slug="alder-creek"
        orgToday={TODAY}
        postings={[mk(1, {}), mk(2, { status: "draft", firstPublishedAt: null, postedOn: null })]}
      />,
    );
    const links = screen.getAllByRole("link", { name: "View on your website" });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/site/alder-creek/careers/slug-1");
  });

  it("title is a link to the edit page, and free text is text (a hostile or unbroken title)", () => {
    const { container } = render(
      <PostingsList slug="alder-creek" orgToday={TODAY} postings={[mk(1, { title: "<script>alert(1)</script>" }), mk(2, { title: "W".repeat(200) })]} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "<script>alert(1)</script>" }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/careers/11111111-1111-4111-8111-111111111111",
    );
    expect(container.innerHTML).toContain("[overflow-wrap:anywhere]");
  });

  it("shows location and type, pay, and the posted date", () => {
    render(<PostingsList slug="alder-creek" orgToday={TODAY} postings={[mk(1, { location: "Annex", employmentType: "intern", payMinCents: 1500, payMaxCents: 1500, payUnit: "hour" })]} />);
    expect(screen.getByText("Annex · Intern")).toBeTruthy();
    expect(screen.getByText("$15 per hour")).toBeTruthy();
    expect(screen.getAllByText(/^Posted Friday, October 30, 2026$/).length).toBeGreaterThan(0);
  });

  it("a row with no location shows the type alone", () => {
    render(<PostingsList slug="alder-creek" orgToday={TODAY} postings={[mk(1, { location: "" })]} />);
    expect(screen.getByText("Full-time")).toBeTruthy();
  });
});
