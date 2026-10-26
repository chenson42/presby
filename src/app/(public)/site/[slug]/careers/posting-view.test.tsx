// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicPosting } from "@/lib/careers/contract";
import { buildSiteUrls } from "@/lib/site-urls";
import { ClosedPostingView, OpenPostingView } from "./posting-view";

afterEach(cleanup);

const urls = buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: "https://presby.invalid" });
const posting: PublicPosting = {
  slug: "music-director",
  title: "Music Director",
  location: "Sanctuary",
  employmentType: "part_time",
  payMinCents: 2500000,
  payMaxCents: 3200000,
  payUnit: "year",
  summary: "Lead the choir.",
  postedOn: "2026-11-03",
  closingDate: null,
  descriptionMd: "## About the role\n\n- Lead the choir\n\nWrite to [the office](mailto:office@example.invalid).",
};

describe("OpenPostingView - T17", () => {
  it("shows the description rendered, the apply notice with the phone, and no form", () => {
    const { container } = render(
      <OpenPostingView organizationName="Alder Creek Presbyterian Church" contactPhone="614-555-0123" posting={posting} urls={urls} backHref="/site/alder-creek/employment" />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Music Director");
    expect(screen.getByRole("heading", { level: 2, name: "About the role" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "the office" }).getAttribute("href")).toBe("mailto:office@example.invalid");
    const apply = screen.getByTestId("how-to-apply");
    expect(within(apply).getByRole("heading", { name: "How to apply" })).toBeTruthy();
    expect(apply.textContent).toBe(
      "How to applyTo apply, please contact Alder Creek Presbyterian Church. You can reach us at 614-555-0123, or through the contact details on our website.",
    );
    expect(container.querySelector("form, input, textarea, button")).toBeNull();
  });

  it("drops the phone clause when the profile has no phone", () => {
    render(<OpenPostingView organizationName="Alder Creek" contactPhone={null} posting={posting} urls={urls} backHref="/x" />);
    expect(screen.getByTestId("how-to-apply").textContent).toBe(
      "How to applyTo apply, please contact Alder Creek. You can reach us through the contact details on our website.",
    );
  });

  it("every href is SiteUrls' or the back target, with no query string", () => {
    const { container } = render(
      <OpenPostingView organizationName="Alder Creek" contactPhone="614-555-0123" posting={posting} urls={urls} backHref="/site/alder-creek/employment" />,
    );
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => !h!.startsWith("mailto:"))).toEqual([
      urls.home(),
      "/site/alder-creek/employment",
      urls.home(),
    ]);
    for (const href of hrefs) expect(href!.includes("?")).toBe(false);
    expect(screen.getByRole("link", { name: /Back to Alder Creek/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All job openings" })).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("renders hostile description text inertly", () => {
    const { container } = render(
      <OpenPostingView organizationName="Alder Creek" contactPhone={null} posting={{ ...posting, descriptionMd: "<script>alert(1)</script> [x](javascript:alert(1))" }} urls={urls} backHref="/x" />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe("ClosedPostingView - T17", () => {
  it("shows the title, the closed sentence and a link to the other openings - and no description", () => {
    const { container } = render(<ClosedPostingView organizationName="Alder Creek" title="Music Director" urls={urls} backHref="/site/alder-creek/careers" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Music Director");
    expect(screen.getByText("This position is no longer accepting applications.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See other job openings" }).getAttribute("href")).toBe("/site/alder-creek/careers");
    expect(screen.queryByText("How to apply")).toBeNull();
    expect(container.querySelector('[data-testid="posting-description"]')).toBeNull();
  });
});
