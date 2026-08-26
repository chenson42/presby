// @vitest-environment jsdom
/**
 * Tests for `<DirectoryGrid>` — the `org_portal.directory_v2` card grid.
 *
 * `DirectoryGrid` is an async Server Component (see its own header for why:
 * every card's photo resolves via `resolvePhotoSrc()`, in one `Promise.all`,
 * before it returns). Tested the same way `directory/page.tsx` already is
 * in this repo: `await DirectoryGrid(props)` directly, then hand the
 * resolved element to `render()` — no RSC runtime needed, because by the
 * time this function returns there are no async descendants left in the
 * tree.
 *
 * `@/lib/storage/blob-store` is mocked (the same one hop before `@/lib/db`
 * that `page.test.tsx` mocks, for the identical reason: `./person-avatar`'s
 * real `resolvePhotoSrc()` calls `getBlobStore().resolve()`, and the real
 * `blob-store.ts` opens a real connection at import time via `@/lib/db`).
 * `./person-avatar` itself is imported for real — these tests exercise the
 * REAL `<PersonAvatar>` rendering path, stubbing only the DB-shaped call
 * underneath it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DirectoryEntry } from "@/lib/directory";

const resolve = vi.fn();
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve, resolveMeta: vi.fn(), store: vi.fn() }),
}));

import { DirectoryGrid } from "./directory-grid";

afterEach(() => {
  cleanup();
  resolve.mockReset().mockResolvedValue(null);
});

function entry(overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    personId: "c0000000-0000-0000-0000-000000000001",
    firstName: "Marguerite",
    lastName: "Ashcombe",
    preferredName: null,
    email: null,
    phone: null,
    address: null,
    dateOfBirth: null,
    photoKey: null,
    ...overrides,
  };
}

async function renderGrid(props: Partial<Parameters<typeof DirectoryGrid>[0]> = {}) {
  const el = await DirectoryGrid({
    entries: [],
    organizationId: "org-1",
    search: "",
    status: "",
    orgName: "Alder Creek Presbyterian Church",
    slug: "alder-creek",
    ...props,
  });
  return render(el);
}

describe("DirectoryGrid — the search box", () => {
  it("has a labeled search input that round-trips the current search as its default value", async () => {
    await renderGrid({ search: "marguerite" });
    const input = screen.getByLabelText(/search the directory/i) as HTMLInputElement;
    expect(input.value).toBe("marguerite");
    expect(input.getAttribute("name")).toBe("search");
  });

  it("is a plain GET form — no client-side fetch, no onSubmit handler needed", async () => {
    await renderGrid();
    const form = document.querySelector("form");
    expect(form).toBeTruthy();
    expect(form?.getAttribute("method")).toBe("get");
  });
});

describe("DirectoryGrid — the member count", () => {
  it("shows a singular count for exactly one member", async () => {
    await renderGrid({ entries: [entry()] });
    expect(screen.getByText(/showing 1 member$/i)).toBeTruthy();
  });

  it("shows a plural count for more than one member", async () => {
    await renderGrid({
      entries: [entry({ personId: "a" }), entry({ personId: "b", firstName: "Tobias" })],
    });
    expect(screen.getByText(/showing 2 members/i)).toBeTruthy();
  });
});

describe("DirectoryGrid — the two distinct empty states", () => {
  it("shows the empty-directory copy (no search) when there are zero entries", async () => {
    await renderGrid({ entries: [], search: "" });
    expect(
      screen.getByText(/no one is listed in Alder Creek.*directory yet/i),
    ).toBeTruthy();
    expect(screen.queryByText(/no matches for/i)).toBeNull();
  });

  it("shows the zero-match copy, naming the query back, when a search matched nobody", async () => {
    await renderGrid({ entries: [], search: "zzz-nobody" });
    expect(screen.getByText(/no matches for.*zzz-nobody/i)).toBeTruthy();
    expect(screen.queryByText(/no one is listed/i)).toBeNull();
  });

  it("shows neither empty-state message when there is at least one entry", async () => {
    await renderGrid({ entries: [entry()], search: "" });
    expect(screen.queryByText(/no one is listed/i)).toBeNull();
    expect(screen.queryByText(/no matches for/i)).toBeNull();
  });
});

describe("DirectoryGrid — card content", () => {
  it("renders name, email, and phone as expected, and resolves the photo through the blob store", async () => {
    await renderGrid({
      entries: [
        entry({
          email: "m.ashcombe@example.invalid",
          phone: "555-0100",
          address: { line1: "1 Way", city: "Fixtureville", region: "OH", postalCode: "00000" },
          photoKey: "photo-key-1",
        }),
      ],
      organizationId: "org-42",
    });

    expect(screen.getByText("Marguerite Ashcombe")).toBeTruthy();
    const emailLink = screen.getByRole("link", { name: "m.ashcombe@example.invalid" });
    expect(emailLink.getAttribute("href")).toBe("mailto:m.ashcombe@example.invalid");
    const phoneLink = screen.getByRole("link", { name: "555-0100" });
    expect(phoneLink.getAttribute("href")).toBe("tel:555-0100");
    expect(screen.getByText("Fixtureville")).toBeTruthy();
    expect(resolve).toHaveBeenCalledWith({
      organizationId: "org-42",
      key: "photo-key-1",
    });
  });

  it("never calls the blob store for an entry with no photoKey", async () => {
    await renderGrid({ entries: [entry({ photoKey: null })] });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("prefers preferredName over firstName", async () => {
    await renderGrid({
      entries: [entry({ firstName: "Marguerite", preferredName: "Meg" })],
    });
    expect(screen.getByText("Meg Ashcombe")).toBeTruthy();
    expect(screen.queryByText("Marguerite Ashcombe")).toBeNull();
  });

  it("omits email/phone/city entirely when they are null, never rendering an empty label", async () => {
    await renderGrid({ entries: [entry()] });
    // Increment 3: the card's NAME always links to the person-detail route,
    // so exactly one link exists even with no contact detail — the
    // assertion is "no mailto:/tel: links", not "no links at all".
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "/o/alder-creek/directory/c0000000-0000-0000-0000-000000000001",
    );
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/email:/i);
    expect(body).not.toMatch(/phone:/i);
  });

  it("the name links to the person-detail route", async () => {
    await renderGrid({ entries: [entry()], slug: "bramblewood" });
    const link = screen.getByRole("link", { name: "Marguerite Ashcombe" });
    expect(link.getAttribute("href")).toBe(
      "/o/bramblewood/directory/c0000000-0000-0000-0000-000000000001",
    );
  });

  it("Increment 4: renders a lock badge for an entry with isHidden true", async () => {
    await renderGrid({ entries: [entry({ isHidden: true })] });
    expect(screen.getByText(/hidden from the directory/i)).toBeTruthy();
  });

  it("Increment 4: renders NO lock badge for an ordinary (isHidden false/undefined) entry", async () => {
    await renderGrid({ entries: [entry({ isHidden: false })] });
    expect(screen.queryByText(/hidden from the directory/i)).toBeNull();
    await renderGrid({ entries: [entry()] });
    expect(screen.queryByText(/hidden from the directory/i)).toBeNull();
  });

  it("Increment 5: renders a status select with every DIRECTORY_STATUSES option, defaulting to All", async () => {
    await renderGrid();
    const select = screen.getByLabelText(/^status$/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "",
      "active",
      "baptized",
      "affiliate",
      "other_participant",
    ]);
    expect(select.value).toBe("");
  });

  it("Increment 5: the status select round-trips the current status as its default value", async () => {
    await renderGrid({ status: "affiliate" });
    const select = screen.getByLabelText(/^status$/i) as HTMLSelectElement;
    expect(select.value).toBe("affiliate");
  });

  it("Increment 5: shows a status-specific empty message when a status filter matched nobody", async () => {
    await renderGrid({ entries: [], search: "", status: "baptized" });
    expect(
      screen.getByText(/no members with status "baptized"/i),
    ).toBeTruthy();
  });

  it("Increment 5: renders Pagination when a pagination prop is passed", async () => {
    await renderGrid({
      entries: [entry()],
      pagination: { page: 2, pageSize: 25, total: 60, totalPages: 3 },
    });
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(screen.getByText(/showing 1 member of 60/i)).toBeTruthy();
  });

  it("Increment 5: renders no pagination controls when pagination is omitted", async () => {
    await renderGrid({ entries: [entry()] });
    expect(screen.queryByText(/page \d+ of \d+/i)).toBeNull();
  });
});

describe("DirectoryGrid — card hover treatment (Increment 1, DECISION-099)", () => {
  it("applies the shadow-lift hover treatment to each card, WITHOUT cursor-pointer or an accent color flood", async () => {
    await renderGrid({ entries: [entry()] });
    const card = document.querySelector('[data-slot="card"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toContain("hover:shadow-md");
    expect(card.className).toContain("transition-shadow");
    expect(card.className).not.toContain("cursor-pointer");
    expect(card.className).not.toContain("hover:bg-accent");
  });

  it("renders Mail/Phone/MapPin icons inline before each present contact field", async () => {
    await renderGrid({
      entries: [
        entry({
          email: "m.ashcombe@example.invalid",
          phone: "555-0100",
          address: { line1: "1 Way", city: "Fixtureville", region: "OH", postalCode: "00000" },
        }),
      ],
    });
    // Three inline icons: Mail, Phone, MapPin (the Lock badge icon only
    // appears for isHidden entries, exercised separately above).
    expect(document.querySelectorAll("svg").length).toBe(3);
  });
});

describe("DirectoryGrid — responsive grid layout", () => {
  it("renders one card per entry in a responsive 1/2/3-column grid", async () => {
    await renderGrid({
      entries: [
        entry({ personId: "a" }),
        entry({ personId: "b", firstName: "Tobias", lastName: "Renwick" }),
        entry({ personId: "c", firstName: "Priya", lastName: "Balakrishnan" }),
      ],
    });
    const grid = document.querySelector(".grid");
    expect(grid).toBeTruthy();
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("sm:grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-3");
    expect(grid?.children).toHaveLength(3);
  });
});
