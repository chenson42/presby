import { describe, expect, it } from "vitest";
import {
  helpRedirects,
  indexGroups,
  neighbours,
  pendingPages,
  plannedPages,
  publishedPages,
} from "./select";
import type { HelpEntry } from "./types";

const page = (
  slug: string,
  status: "published" | "pending",
  audience: "prospective" | "everyone" | "administrator" | "treasurer",
  order: number,
  extra: Record<string, unknown> = {},
): HelpEntry =>
  ({
    status,
    slug,
    title: `T ${slug}`,
    summary: "s",
    order,
    audience,
    covers: [],
    labels: [],
    verifiedIn: status === "published" ? "0.47.0" : null,
    ...(status === "pending" ? { requires: "tok" } : {}),
    ...extra,
  }) as HelpEntry;
const plan = (slug: string, order: number): HelpEntry => ({
  status: "planned",
  slug,
  title: slug,
  summary: "s",
  order,
  forWhom: "w",
  today: "t",
  confirmedOn: "2026-10-26",
});

const PAGES: HelpEntry[] = [
  page("b-second", "published", "everyone", 20),
  page("a-first", "published", "everyone", 10),
  page("hidden", "pending", "everyone", 15),
  page("admin-one", "published", "administrator", 10),
  page("pros", "published", "prospective", 10),
  page("treas", "pending", "treasurer", 10),
  plan("worship-planning", 1),
  plan("children-check-in", 2),
];

describe("selectors", () => {
  it("separate the three statuses", () => {
    expect(publishedPages(PAGES).map((p) => p.slug).sort()).toEqual(["a-first", "admin-one", "b-second", "pros"]);
    expect(pendingPages(PAGES).map((p) => p.slug).sort()).toEqual(["hidden", "treas"]);
    expect(plannedPages(PAGES).map((p) => p.slug)).toEqual(["worship-planning", "children-check-in"]);
  });
  it("return nothing, without throwing, for the empty registry", () => {
    expect(publishedPages([])).toEqual([]);
    expect(plannedPages([])).toEqual([]);
    expect(indexGroups([])).toEqual([]);
  });
  it("operate on the real (empty at first) registry by default", () => {
    expect(() => publishedPages()).not.toThrow();
    expect(() => indexGroups()).not.toThrow();
  });
});

describe("indexGroups", () => {
  it("orders groups by audience, pages by order, and omits groups with no published page", () => {
    const groups = indexGroups(PAGES);
    expect(groups.map((g) => g.audience)).toEqual(["prospective", "everyone", "administrator"]);
    expect(groups.map((g) => g.label)).toEqual([
      "Thinking about PresbyPortal",
      "Everyone who signs in",
      "Church administrators",
    ]);
    expect(groups[1].pages.map((p) => p.slug)).toEqual(["a-first", "b-second"]);
  });
  it("shows the Treasurers group once it has a published page", () => {
    const groups = indexGroups([...PAGES, page("t2", "published", "treasurer", 5)]);
    expect(groups.at(-1)).toMatchObject({ audience: "treasurer", label: "Treasurers" });
  });
});

describe("neighbours", () => {
  it("walks published pages within the audience group, skipping pending", () => {
    const withMiddle = [...PAGES, page("c-third", "published", "everyone", 30)];
    expect(neighbours("b-second", withMiddle)).toMatchObject({
      previous: { slug: "a-first" },
      next: { slug: "c-third" },
    });
  });
  it("has no previous at the start and no next at the end", () => {
    expect(neighbours("a-first", PAGES).previous).toBeNull();
    expect(neighbours("b-second", PAGES).next).toBeNull();
  });
  it("never crosses an audience group", () => {
    expect(neighbours("admin-one", PAGES)).toEqual({ previous: null, next: null });
  });
  it("is null/null for an unknown or unpublished slug", () => {
    expect(neighbours("hidden", PAGES)).toEqual({ previous: null, next: null });
    expect(neighbours("nope", PAGES)).toEqual({ previous: null, next: null });
  });
});

describe("helpRedirects", () => {
  const withMoves: HelpEntry[] = [
    page("new-name", "published", "everyone", 10, { aliases: ["old-name"], replaces: ["worship-planning"] }),
    page("pending-one", "pending", "everyone", 11, { aliases: ["ignored"], replaces: ["ignored-planned"] }),
  ];
  it("is empty when no page has an alias or replaces (first release)", () => {
    expect(helpRedirects("host.invalid", PAGES)).toEqual([]);
    expect(helpRedirects("host.invalid", [])).toEqual([]);
  });
  it("redirects aliases and replaced planned slugs permanently, on the platform host only (F151)", () => {
    expect(helpRedirects("presbyportal.example", withMoves)).toEqual([
      {
        source: "/help/old-name",
        destination: "/help/new-name",
        permanent: true,
        has: [{ type: "host", value: "presbyportal.example" }],
      },
      {
        source: "/help/planned/worship-planning",
        destination: "/help/new-name",
        permanent: true,
        has: [{ type: "host", value: "presbyportal.example" }],
      },
    ]);
  });
  it("gives every entry a host condition", () => {
    for (const r of helpRedirects("h.invalid", withMoves)) expect(r.has).toEqual([{ type: "host", value: "h.invalid" }]);
  });
  it("ignores pending pages' aliases (they are not live)", () => {
    expect(helpRedirects("h.invalid", withMoves).some((r) => r.source.includes("ignored"))).toBe(false);
  });
});
