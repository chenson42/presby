// @vitest-environment jsdom
/**
 * Tests for <PublicCommitteeDirectory> — public-directory-primitives Phase
 * 3/4 (docs/work-log/2026-08-28-public-directory-primitives.md), ux-developer
 * slice.
 *
 * `@/lib/sites` and `presby-site-kit` are mocked at the module boundary —
 * same reasoning `staff-directory.test.tsx`'s header gives for the identical
 * pattern one file over: this file pins the COMPONENT's own
 * grouping/mapping/branching, not `getPublicCommitteeRoster()`'s own
 * SQL-backed filter behavior (covered by `sites.test.ts`, against a real dev
 * database) and not `PersonCard`'s own rendering (covered by
 * `presby-site-kit`'s own `PersonCard.test.tsx`, in the sibling repo).
 *
 * What this file exists to pin:
 *   - an empty result gets the explicit "No committees have been listed here
 *     yet." branch, NOT a silent blank (matching `PublicStaffDirectory`'s own
 *     precedent exactly) — whether the flag is off, nobody has opted in, or
 *     a filter narrows to zero rows;
 *   - a flat, already-`groupName`-clustered roster is grouped into one
 *     `<section>`/`<h2>` per committee, in ONE sequential pass — this is the
 *     SAME render path for "one committee's page" and "an all-committees
 *     page" (Phase 3 Design Decision 2), so a single-committee result still
 *     produces a heading, not a special-cased headless section;
 *   - `groupRole` maps through `GROUP_ROLE_LABELS`: "chair"/"leader" render a
 *     subtitle, "member" renders none at all (matching `StaffPerson.title`'s
 *     own "optional, omit the redundant common case" prior art);
 *   - `photoKey` builds the same `/site/<slug>/assets/<key>` URL shape
 *     `PublicStaffDirectory` already establishes, and is left `undefined`
 *     (no broken `<img>`) when `null`;
 *   - FIELD SCOPE: no `mailto:`/phone ever renders — `PersonCard` has no such
 *     props to set in the first place, so this is a type-level guarantee,
 *     not merely a runtime assertion, but the assertion still pins the
 *     rendered DOM has no such content;
 *   - `parseCommitteeRosterFilter()`'s own defensive narrowing, matching
 *     `parseStaffRosterFilter()`'s conventions in the sibling file.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getPublicCommitteeRoster = vi.fn();
vi.mock("@/lib/sites", () => ({
  getPublicCommitteeRoster: (...args: unknown[]) =>
    getPublicCommitteeRoster(...args),
}));

// PersonCard has no CSS of its own to verify here (see committee-directory
// .tsx's own header) — a lightweight, real (not mocked) import of the actual
// component from the installed presby-site-kit v4.0.0 dependency, so this
// file exercises real prop-to-DOM mapping (name/title/photoUrl), not a test
// double standing in for it.
import { PublicCommitteeDirectory } from "./committee-directory";
import { buildSiteUrls } from "@/lib/site-urls";

/** Slug-mode url builder (a platform host): photo URLs keep today's /site/<slug>/assets/<key> shape. */
const SLUG_URLS = buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: "http://localhost:3000" });
/** Host-mode url builder (a church's own domain): photo URLs are CLEAN, with no slug anywhere. */
const HOST_URLS = buildSiteUrls({ mode: "host", host: "church-one.invalid", slug: "alder-creek", platformOrigin: "http://localhost:3000" });

afterEach(() => {
  cleanup();
  getPublicCommitteeRoster.mockReset();
});

describe("PublicCommitteeDirectory — empty result", () => {
  it("renders an explicit 'no committees listed yet' message, never a silent blank", async () => {
    getPublicCommitteeRoster.mockResolvedValue([]);

    const el = await PublicCommitteeDirectory({ slug: "alder-creek", urls: SLUG_URLS, filter: {} });
    render(el);

    expect(
      screen.getByText("No committees have been listed here yet."),
    ).toBeTruthy();
  });

  it("a filter that narrows to zero rows gets the same explicit branch, not a different empty state", async () => {
    getPublicCommitteeRoster.mockResolvedValue([]);

    const el = await PublicCommitteeDirectory({
      slug: "alder-creek",
      urls: SLUG_URLS,
      filter: { committee: "Nonexistent Committee" },
    });
    render(el);

    expect(
      screen.getByText("No committees have been listed here yet."),
    ).toBeTruthy();
  });
});

describe("PublicCommitteeDirectory — grouping (all-committees case)", () => {
  it("groups a flat, groupName-clustered roster into one heading per committee, in one sequential pass", async () => {
    getPublicCommitteeRoster.mockResolvedValue([
      { groupName: "Missions Committee", groupRole: "chair", displayName: "Wren Halloway", photoKey: null },
      { groupName: "Missions Committee", groupRole: "member", displayName: "Corwin Aldridge", photoKey: null },
      { groupName: "Worship Committee", groupRole: "leader", displayName: "Iris Bramblewood", photoKey: null },
    ]);

    const el = await PublicCommitteeDirectory({ slug: "alder-creek", urls: SLUG_URLS, filter: {} });
    render(el);

    expect(screen.getByRole("heading", { name: "Missions Committee" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Worship Committee" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(2);
    expect(screen.getByText("Wren Halloway")).toBeTruthy();
    expect(screen.getByText("Corwin Aldridge")).toBeTruthy();
    expect(screen.getByText("Iris Bramblewood")).toBeTruthy();
  });

  it("a single-committee filter result still renders through the SAME grouping path — one heading, not a headless special case", async () => {
    getPublicCommitteeRoster.mockResolvedValue([
      { groupName: "Missions Committee", groupRole: "chair", displayName: "Wren Halloway", photoKey: null },
    ]);

    const el = await PublicCommitteeDirectory({
      slug: "alder-creek",
      urls: SLUG_URLS,
      filter: { committee: "Missions Committee" },
    });
    render(el);

    expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(1);
    expect(screen.getByRole("heading", { name: "Missions Committee" })).toBeTruthy();
  });
});

describe("PublicCommitteeDirectory — groupRole -> subtitle mapping", () => {
  it("renders a subtitle for chair and leader, and none at all for member", async () => {
    getPublicCommitteeRoster.mockResolvedValue([
      { groupName: "Missions Committee", groupRole: "chair", displayName: "Wren Halloway", photoKey: null },
      { groupName: "Missions Committee", groupRole: "leader", displayName: "Iris Bramblewood", photoKey: null },
      { groupName: "Missions Committee", groupRole: "member", displayName: "Corwin Aldridge", photoKey: null },
    ]);

    const el = await PublicCommitteeDirectory({ slug: "alder-creek", urls: SLUG_URLS, filter: {} });
    const { container } = render(el);

    expect(screen.getByText("Chair")).toBeTruthy();
    expect(screen.getByText("Leader")).toBeTruthy();
    // Exactly two subtitle <p data-slot="title"> elements — chair + leader —
    // never a third, empty one for the member row.
    expect(container.querySelectorAll("[data-slot='title']").length).toBe(2);
  });
});

describe("PublicCommitteeDirectory — photoUrl and field scope", () => {
  it("builds photoUrl from slug + photoKey when present, and renders no <img> when photoKey is null", async () => {
    getPublicCommitteeRoster.mockResolvedValue([
      { groupName: "Missions Committee", groupRole: "chair", displayName: "Wren Halloway", photoKey: "blob-key-1" },
      { groupName: "Missions Committee", groupRole: "member", displayName: "Corwin Aldridge", photoKey: null },
    ]);

    const el = await PublicCommitteeDirectory({ slug: "alder-creek", urls: SLUG_URLS, filter: {} });
    render(el);

    const images = screen.getAllByRole("img");
    expect(images.length).toBe(1);
    expect(images[0].getAttribute("src")).toBe("/site/alder-creek/assets/blob-key-1");
    expect(images[0].getAttribute("alt")).toBe("Wren Halloway");
  });

  it("never renders a mailto: link or a phone number — PersonCard has no such props to set", async () => {
    getPublicCommitteeRoster.mockResolvedValue([
      { groupName: "Missions Committee", groupRole: "chair", displayName: "Wren Halloway", photoKey: null },
    ]);

    const el = await PublicCommitteeDirectory({ slug: "alder-creek", urls: SLUG_URLS, filter: {} });
    const { container } = render(el);

    expect(container.querySelector("a[href^='mailto:']")).toBeNull();
    expect(container.querySelector("[data-slot='phone']")).toBeNull();
  });
});

describe("PublicCommitteeDirectory — filter narrowing (parseCommitteeRosterFilter)", () => {
  it("passes a well-formed filter through to getPublicCommitteeRoster() verbatim", async () => {
    getPublicCommitteeRoster.mockResolvedValue([]);

    await PublicCommitteeDirectory({
      slug: "alder-creek",
      urls: SLUG_URLS,
      filter: { committee: "Missions Committee", hasPriority: true },
    });

    expect(getPublicCommitteeRoster).toHaveBeenCalledWith("alder-creek", {
      committee: "Missions Committee",
      hasPriority: true,
    });
  });

  it("drops a malformed filter value rather than throwing or passing it through raw", async () => {
    getPublicCommitteeRoster.mockResolvedValue([]);

    await PublicCommitteeDirectory({
      slug: "alder-creek",
      urls: SLUG_URLS,
      filter: { committee: 12345, hasPriority: "yes" },
    });

    expect(getPublicCommitteeRoster).toHaveBeenCalledWith("alder-creek", {});
  });

  it("an empty filter object narrows to nothing", async () => {
    getPublicCommitteeRoster.mockResolvedValue([]);

    await PublicCommitteeDirectory({ slug: "alder-creek", urls: SLUG_URLS, filter: {} });

    expect(getPublicCommitteeRoster).toHaveBeenCalledWith("alder-creek", {});
  });
});

describe("PublicCommitteeDirectory - host mode (Track F)", () => {
  it("builds CLEAN photo URLs on a church's own domain: /assets/<key>, no /site/ and no slug", async () => {
    getPublicCommitteeRoster.mockResolvedValue([
      { groupName: "Missions Committee", groupRole: "chair", displayName: "Wren Halloway", photoKey: "blob-key-1" },
    ]);

    render(await PublicCommitteeDirectory({ slug: "alder-creek", urls: HOST_URLS, filter: {} }));

    const src = screen.getByRole("img").getAttribute("src");
    expect(src).toBe("/assets/blob-key-1");
    expect(src).not.toContain("/site/");
    expect(src).not.toContain("alder-creek");
    expect(getPublicCommitteeRoster).toHaveBeenCalledWith("alder-creek", expect.anything());
  });
});
