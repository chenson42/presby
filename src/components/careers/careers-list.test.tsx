// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicPostingSummary } from "@/lib/careers/contract";
import { buildSiteUrls } from "@/lib/site-urls";
import { CareersEmptyNotice, CareersUnavailableNotice } from "./careers-notice";
import { CareersList } from "./careers-list";
import { PostingMeta } from "./posting-meta";

afterEach(cleanup);

const urls = buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: "https://presby.invalid" });

const base: PublicPostingSummary = {
  slug: "music-director",
  title: "Music Director",
  location: "Fellowship Hall",
  employmentType: "part_time",
  payMinCents: 2500000,
  payMaxCents: 3200000,
  payUnit: "year",
  summary: "Lead the choir.",
  postedOn: "2026-11-03",
  closingDate: "2026-12-31",
};

describe("CareersList - T17", () => {
  it("shows type, location, pay, dates and one link per card from SiteUrls, with no query string", () => {
    render(<CareersList postings={[base, { ...base, slug: "custodian", title: "Custodian", closingDate: null, payMinCents: null, payMaxCents: null, payUnit: null }]} urls={urls} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Music Director", "Custodian"]);
    expect(screen.getAllByText("Part-time").length).toBeGreaterThan(0);
    expect(screen.getByText("$25,000 to $32,000 per year")).toBeTruthy();
    expect(screen.getAllByText(/^Posted/)).toHaveLength(2);
    expect(screen.getByText(/Closing date:/).textContent).toBe("Closing date: Thursday, December 31, 2026");
    expect(screen.getAllByText(/Closing date:/)).toHaveLength(1);
    const hrefs = screen.getAllByRole("link", { name: /View this position/ }).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([urls.careersPosting("music-director"), urls.careersPosting("custodian")]);
    for (const href of hrefs) expect(href).not.toContain("?");
  });

  it("describes each identical link by its card title", () => {
    render(<CareersList postings={[base]} urls={urls} />);
    const link = screen.getByRole("link", { name: /View this position/ });
    const described = link.getAttribute("aria-describedby")!;
    expect(document.getElementById(described)!.textContent).toBe("Music Director");
  });

  it("renders hostile and unbroken strings as text, not elements or links", () => {
    const hostile = { ...base, title: "<script>alert(1)</script>", summary: "https://evil.invalid/x <b>hi</b>", location: "x".repeat(300) };
    const { container } = render(<CareersList postings={[hostile, { ...base, slug: "long", title: "W".repeat(300) }]} urls={urls} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(2); // only the two card links, never an auto-link
    expect(container.innerHTML).toContain("[overflow-wrap:anywhere]");
  });

  it("carries no uuid-shaped string anywhere", () => {
    const { container } = render(<CareersList postings={[base]} urls={urls} />);
    expect(container.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});

describe("PostingMeta", () => {
  it("omits an empty location, no pay and no closing date", () => {
    render(<PostingMeta posting={{ ...base, location: "", payMinCents: null, payMaxCents: null, payUnit: null, closingDate: null }} />);
    expect(screen.getByText("Part-time")).toBeTruthy();
    expect(screen.queryByText(/Closing date/)).toBeNull();
    expect(screen.queryByText(/per year/)).toBeNull();
    expect(screen.getByText(/Posted/).textContent).toBe("Posted Tuesday, November 3, 2026");
  });
});

describe("notices", () => {
  it("P1 is the one unavailable sentence", () => {
    render(<CareersUnavailableNotice />);
    expect(screen.getByTestId("careers-unavailable").textContent).toBe(
      "Our job openings aren't available right now. Please check back soon.",
    );
  });

  it("P2 adds the phone only when the profile has one", () => {
    const { rerender } = render(<CareersEmptyNotice contactPhone="614-555-0123" />);
    expect(screen.getByTestId("careers-empty").textContent).toBe(
      "We don't have any open positions right now. Please check back soon. You can also call us at 614-555-0123.",
    );
    rerender(<CareersEmptyNotice contactPhone={null} />);
    expect(screen.getByTestId("careers-empty").textContent).toBe(
      "We don't have any open positions right now. Please check back soon.",
    );
  });
});
