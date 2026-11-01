// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HelpLink } from "./help-link";
import { IndexGroups } from "./index-groups";
import { NeedsBlock } from "./needs-block";
import { OnThisPage } from "./on-this-page";
import { HelpBreadcrumb, PageNav } from "./page-nav";
import { PlannedPlaceholder } from "./planned-placeholder";
import type { HelpContentEntry, HelpPlannedEntry } from "@/lib/help/types";

afterEach(cleanup);

const page = (slug: string, title: string, order = 10): HelpContentEntry => ({
  slug,
  title,
  summary: `About ${title}.`,
  order,
  status: "published",
  audience: "everyone",
  covers: [],
  labels: [],
  verifiedIn: "0.47.0",
});

const planned: HelpPlannedEntry = {
  slug: "example-plan",
  title: "Example plan",
  summary: "Unused.",
  order: 10,
  status: "planned",
  forWhom: "Example groups",
  today: "There is nothing here today.",
  confirmedOn: "2026-10-26",
};

describe("HelpLink", () => {
  it("renders a same-tab link with a 44px target and a focus ring", () => {
    render(<HelpLink href="/help/signing-in">Help with signing in</HelpLink>);
    const a = screen.getByRole("link", { name: "Help with signing in" });
    expect(a.getAttribute("href")).toBe("/help/signing-in");
    expect(a.getAttribute("target")).toBeNull();
    expect(a.className).toContain("min-h-11");
    expect(a.className).toContain("focus-visible:ring-2");
    expect(a.className).toContain("focus-visible:ring-offset-2");
  });
});

describe("IndexGroups", () => {
  it("renders a heading per group and a titled, summarised link per page", () => {
    render(
      <IndexGroups
        groups={[
          { audience: "everyone", label: "Everyone who signs in", pages: [page("signing-in", "Signing in")] },
          { audience: "administrator", label: "Church administrators", pages: [page("first-day", "First day", 10)] },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Everyone who signs in" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Church administrators" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Signing in" }).getAttribute("href")).toBe("/help/signing-in");
    expect(screen.getByText("About Signing in.")).toBeTruthy();
  });

  it("renders nothing for an empty list of groups (an empty group is never passed in)", () => {
    const { container } = render(<IndexGroups groups={[]} />);
    expect(container.querySelectorAll("section")).toHaveLength(0);
  });
});

describe("NeedsBlock", () => {
  it("names who, and says a default-on toggle is on by default", () => {
    render(
      <NeedsBlock
        needs={{ who: "A church administrator", turnOn: { toggleKey: "calendar", name: "Calendar", defaultOn: true }, appliesTo: "congregations" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "What you need" })).toBeTruthy();
    expect(screen.getByText("A church administrator")).toBeTruthy();
    expect(screen.getByText('In Features, turn on "Calendar". It is on by default.')).toBeTruthy();
    expect(screen.getByText("Congregations.")).toBeTruthy();
  });

  it("says a default-off toggle is off by default", () => {
    render(<NeedsBlock needs={{ who: "x", turnOn: { toggleKey: "careers", name: "Job openings", defaultOn: false } }} />);
    expect(screen.getByText('In Features, turn on "Job openings". It is off by default.')).toBeTruthy();
  });

  it("replaces the Turn on row with Switched on for you when the team turns it on", () => {
    render(
      <NeedsBlock needs={{ who: "x", turnOn: { toggleKey: "domains", name: "Website address", defaultOn: false }, operatorEnabled: true }} />,
    );
    expect(screen.queryByText("Turn on")).toBeNull();
    expect(screen.getByText("Switched on for you")).toBeTruthy();
    // Plain text: the <dd> is not markdown, so a link would show raw brackets (the latent 14th reader).
    const text = `The PresbyPortal team turns on "Website address" for you. To ask for it, file a ticket (Administration, then Tickets) or ask the person who invited you.`;
    const dd = screen.getByText(text);
    expect(dd.tagName).toBe("DD");
    expect(dd.textContent).not.toMatch(/[\[\]]|\(\/help/);
  });

  it.each([
    ["all", "Any organization on PresbyPortal."],
    ["congregations", "Congregations."],
    ["congregations-and-nwcs", "Congregations and new worshiping communities."],
    ["presbyteries", "Presbyteries."],
  ] as const)("states the scope for %s", (appliesTo, text) => {
    render(<NeedsBlock needs={{ who: "x", appliesTo }} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("omits rows the entry does not have", () => {
    render(<NeedsBlock needs={{ who: "Anyone" }} />);
    expect(screen.queryByText("Turn on")).toBeNull();
    expect(screen.queryByText("Applies to")).toBeNull();
  });
});

describe("OnThisPage", () => {
  const three = "## One\n\ntext\n\n### Two\n\n## Three\n";

  it("is a native details with the h2 and h3 headings linked by their ids", () => {
    const { container } = render(<OnThisPage markdown={three} />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.hasAttribute("open")).toBe(false);
    expect(screen.getByText("On this page")).toBeTruthy();
    expect([...container.querySelectorAll("li a")].map((a) => a.getAttribute("href"))).toEqual(["#one", "#two", "#three"]);
  });

  it("puts no display utility on the summary (it breaks <details> on iOS)", () => {
    const { container } = render(<OnThisPage markdown={three} />);
    const cls = container.querySelector("summary")?.className ?? "";
    expect(cls).not.toMatch(/(^|\s)(flex|inline-flex|block|inline-block|grid|inline|hidden|contents)(\s|$)/);
    expect(cls).toContain("min-h-11");
  });

  it("is hidden in print", () => {
    const { container } = render(<OnThisPage markdown={three} />);
    expect(container.querySelector("details")?.className).toContain("print:hidden");
  });

  it("renders nothing under three h2 or h3 headings, and ignores deeper ones", () => {
    expect(render(<OnThisPage markdown={"## One\n\n## Two\n\n#### Deep\n\n#### Deeper\n"} />).container.innerHTML).toBe("");
  });
});

describe("HelpBreadcrumb and PageNav", () => {
  it("breadcrumb links Help and marks the current page", () => {
    render(<HelpBreadcrumb current="Signing in" />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Help" }).getAttribute("href")).toBe("/help");
    expect(document.querySelector('[aria-current="page"]')?.textContent).toContain("Signing in");
  });

  it("page nav links previous, next and the index", () => {
    render(<PageNav previous={{ slug: "a", title: "Alpha" }} next={{ slug: "c", title: "Gamma" }} />);
    expect(screen.getByRole("link", { name: "Previous: Alpha" }).getAttribute("href")).toBe("/help/a");
    expect(screen.getByRole("link", { name: "Next: Gamma" }).getAttribute("href")).toBe("/help/c");
    expect(screen.getByRole("link", { name: "Back to the help index" }).getAttribute("href")).toBe("/help");
  });

  it("page nav omits an absent neighbour and keeps the way back", () => {
    render(<PageNav previous={null} next={null} />);
    expect(screen.queryByRole("link", { name: /Previous|Next/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the help index" })).toBeTruthy();
  });
});

describe("PlannedPlaceholder", () => {
  it("carries the fixed label, who it is for and Today, and no steps", () => {
    const { container } = render(<PlannedPlaceholder entry={planned} />);
    expect(screen.getByRole("heading", { level: 1, name: "Example plan" })).toBeTruthy();
    expect(screen.getByText("Planned. Not available yet. There is no date.")).toBeTruthy();
    expect(screen.getByText("Who it is for: Example groups")).toBeTruthy();
    expect(screen.getByText("Today: There is nothing here today.")).toBeTruthy();
    expect(container.querySelector("ol, button, input, img")).toBeNull();
  });

  it("in list form the name is an h2 link to its own page, still labelled", () => {
    render(<PlannedPlaceholder entry={planned} asLink />);
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Example plan" }).getAttribute("href")).toBe("/help/planned/example-plan");
    expect(screen.getByText("Planned. Not available yet. There is no date.")).toBeTruthy();
  });
});
