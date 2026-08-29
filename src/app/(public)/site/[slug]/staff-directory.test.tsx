// @vitest-environment jsdom
/**
 * Tests for <PublicStaffDirectory> — public-staff-directory Phase 3/4
 * (docs/work-log/2026-08-27-public-staff-directory.md), ux-developer slice;
 * `filter` prop widening in docs/work-log/2026-08-28-public-directory-
 * primitives.md, Phase 4 steps 5/6.
 *
 * `@/lib/sites` is mocked at the module boundary — same reasoning
 * `[[...path]]/page.test.tsx`'s header gives for mocking the same module —
 * this file pins the COMPONENT's own mapping/branching, not
 * `getPublicStaffRoster()`'s own SQL-backed filter behavior (covered by
 * `sites.test.ts`, against a real dev database).
 *
 * What this file exists to pin:
 *   - an empty roster gets the explicit "No one has been listed here yet."
 *     branch, NOT a silent `null` (Phase 1 Gap "Empty state" — `StaffList`
 *     itself returns `null` on an empty array, which this component must
 *     never delegate to for the empty case) — including when a filter
 *     narrows to zero currently-public rows, not just zero overall;
 *   - a non-empty roster renders every entry's name and role/title;
 *   - `photoUrl` is built as `/site/<slug>/assets/<photoKey>` when a
 *     `photoKey` is present, and left `undefined` (no broken `<img>`) when
 *     it is `null`;
 *   - FIELD SCOPE IS ENFORCED AT THIS MAPPING LAYER — no `mailto:` link
 *     ever renders, because `phone`/`email` are never set on the
 *     `StaffPerson` object, regardless of what a future `PublicStaffRosterEntry`
 *     might carry;
 *   - `parseStaffRosterFilter()`'s own defensive narrowing: a well-formed
 *     `filter` is passed through to `getPublicStaffRoster()` verbatim, and a
 *     malformed one (wrong `typeof`, an invalid `kind` value) is silently
 *     dropped rather than thrown or passed through raw — the marker's own
 *     JSON is a lower-trust, author-typed input (Phase 1's own "silent
 *     filter-typo failure" gap, named not solved).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getPublicStaffRoster = vi.fn();
vi.mock("@/lib/sites", () => ({
  getPublicStaffRoster: (...args: unknown[]) => getPublicStaffRoster(...args),
}));

import { PublicStaffDirectory } from "./staff-directory";

afterEach(() => {
  cleanup();
  getPublicStaffRoster.mockReset();
});

describe("PublicStaffDirectory — empty roster", () => {
  it("renders an explicit 'no one listed yet' message, never a silent blank", async () => {
    getPublicStaffRoster.mockResolvedValue([]);

    const el = await PublicStaffDirectory({ slug: "alder-creek", filter: {} });
    render(el);

    expect(
      screen.getByText("No one has been listed here yet."),
    ).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("PublicStaffDirectory — a non-empty roster", () => {
  it("renders each entry's name and role/title", async () => {
    getPublicStaffRoster.mockResolvedValue([
      {
        displayName: "Wren Halloway",
        roleLabel: "Office Administrator",
        department: null,
        photoKey: null,
      },
      {
        displayName: "Corwin Aldridge",
        roleLabel: "Clerk of Session",
        department: null,
        photoKey: "blob-key-1",
      },
    ]);

    const el = await PublicStaffDirectory({ slug: "alder-creek", filter: {} });
    render(el);

    expect(screen.getByText("Wren Halloway")).toBeTruthy();
    expect(screen.getByText("Office Administrator")).toBeTruthy();
    expect(screen.getByText("Corwin Aldridge")).toBeTruthy();
    expect(screen.getByText("Clerk of Session")).toBeTruthy();
  });

  it("builds photoUrl from the slug + photoKey when present, and renders no <img> when photoKey is null", async () => {
    getPublicStaffRoster.mockResolvedValue([
      {
        displayName: "Wren Halloway",
        roleLabel: "Office Administrator",
        department: null,
        photoKey: null,
      },
      {
        displayName: "Corwin Aldridge",
        roleLabel: "Clerk of Session",
        department: null,
        photoKey: "blob-key-1",
      },
    ]);

    const el = await PublicStaffDirectory({ slug: "alder-creek", filter: {} });
    render(el);

    const images = screen.getAllByRole("img");
    expect(images.length).toBe(1);
    expect(images[0].getAttribute("src")).toBe(
      "/site/alder-creek/assets/blob-key-1",
    );
    expect(images[0].getAttribute("alt")).toBe("Corwin Aldridge");
  });

  it("never renders a mailto: link or a phone number — field scope is enforced at this mapping layer", async () => {
    getPublicStaffRoster.mockResolvedValue([
      {
        displayName: "Wren Halloway",
        roleLabel: "Office Administrator",
        department: null,
        photoKey: null,
      },
    ]);

    const el = await PublicStaffDirectory({ slug: "alder-creek", filter: {} });
    const { container } = render(el);

    expect(container.querySelector("a[href^='mailto:']")).toBeNull();
    expect(container.querySelector("[data-slot='phone']")).toBeNull();
  });
});

describe("PublicStaffDirectory — a filter that narrows to zero currently-public rows", () => {
  it("still renders the explicit empty-state branch, not a silent blank", async () => {
    getPublicStaffRoster.mockResolvedValue([]);

    const el = await PublicStaffDirectory({
      slug: "alder-creek",
      filter: { department: "Nonexistent Department" },
    });
    render(el);

    expect(
      screen.getByText("No one has been listed here yet."),
    ).toBeTruthy();
  });
});

describe("PublicStaffDirectory — filter narrowing (parseStaffRosterFilter)", () => {
  it("passes a well-formed filter through to getPublicStaffRoster() verbatim", async () => {
    getPublicStaffRoster.mockResolvedValue([]);

    await PublicStaffDirectory({
      slug: "alder-creek",
      filter: { kind: "officer", department: "Finance", office: "clerk_of_session", hasPriority: true },
    });

    expect(getPublicStaffRoster).toHaveBeenCalledWith("alder-creek", {
      kind: "officer",
      department: "Finance",
      office: "clerk_of_session",
      hasPriority: true,
    });
  });

  it("drops a malformed filter value rather than throwing or passing it through raw — a marker author's typo degrades to no-op narrowing, not a crash", async () => {
    getPublicStaffRoster.mockResolvedValue([]);

    await PublicStaffDirectory({
      slug: "alder-creek",
      filter: {
        kind: "not-a-real-kind",
        department: 12345,
        office: null,
        hasPriority: "yes",
      },
    });

    expect(getPublicStaffRoster).toHaveBeenCalledWith("alder-creek", {});
  });

  it("an empty filter object (the shipped feature's own unfiltered marker, with no content-repo migration needed) narrows to nothing", async () => {
    getPublicStaffRoster.mockResolvedValue([]);

    await PublicStaffDirectory({ slug: "alder-creek", filter: {} });

    expect(getPublicStaffRoster).toHaveBeenCalledWith("alder-creek", {});
  });
});
