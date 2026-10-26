// @vitest-environment jsdom
/**
 * Orchestration tests for the photos page (docs/work-log/
 * 2026-10-26-person-photos-inc1.md): the four states (off, forbidden, error,
 * not found), the data state with its status lines, counter and empty state,
 * the under-18 notice, the "view larger" panel, and that the page repeats no
 * check `readPhotoSet` already does. No `loading.tsx` exists (the page calls
 * `notFound()`; CLAUDE.md, the (org) contract).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  }
  return {
    OrgAccessError: MockOrgAccessError,
    resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
    assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
  };
});

const readPhotoSet = vi.fn();
vi.mock("@/lib/person-photos/reader", () => ({
  readPhotoSet: (...args: unknown[]) => readPhotoSet(...args),
}));

vi.mock("./actions", () => ({
  addPersonPhotoAction: vi.fn(),
  designatePersonPhotoAction: vi.fn(),
  undesignatePersonPhotoAction: vi.fn(),
  removePersonPhotoAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PersonPhotosPage from "./page";
import { OrgAccessError } from "@/lib/authz";
import { PAGE_COPY, UPLOAD_COPY } from "@/lib/person-photos/copy";
import type { PhotoSetView } from "@/lib/person-photos/types";

const OK_RESOLVED = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "actor-1", name: "Alder Creek Presbyterian Church", slug: "alder-creek" },
};

const params = () => Promise.resolve({ slug: "alder-creek", id: "p-1" });
const search = (view?: string) => Promise.resolve({ view });

function setView(over: Partial<PhotoSetView> = {}): PhotoSetView {
  return {
    personId: "p-1",
    displayName: "Nora Ashgrove",
    firstName: "Nora",
    organizationName: "Alder Creek Presbyterian Church",
    photos: [],
    count: 0,
    isMinor: false,
    directory: { photoId: null, thumbKey: null, withheld: null },
    website: { imageKey: null, source: null, withheld: null, unattestedDirectoryOnly: false },
    listings: [],
    lines: {
      directory: "Directory: no photo chosen, so members see initials.",
      website: "Website: no photo chosen, so the website shows none.",
      listing: "Nora isn't listed on your public website, so no photo shows there. Listing is set separately, under Staff, Officers or Groups, by whoever manages those.",
    },
    state: { first: "Nora", listed: false, website: null, directory: null },
    viewed: null,
    ...over,
  };
}

function arrange() {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
}

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  readPhotoSet.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

describe("PersonPhotosPage — gate", () => {
  it("signed out → redirects to /signin with the deep link", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(PersonPhotosPage({ params: params(), searchParams: search() })).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent("/o/alder-creek/admin/community/p-1/edit/photos")}`,
    );
    expect(readPhotoSet).not.toHaveBeenCalled();
  });

  it("an unknown organization → notFound()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(PersonPhotosPage({ params: params(), searchParams: search() })).rejects.toThrow("NOT_FOUND");
  });

  it("reads once, as the acting person in this organization, passing ?view= straight through", async () => {
    arrange();
    readPhotoSet.mockResolvedValue({ kind: "ok", set: setView() });
    render(await PersonPhotosPage({ params: params(), searchParams: search("ph-9") }));
    expect(readPhotoSet).toHaveBeenCalledTimes(1);
    expect(readPhotoSet).toHaveBeenCalledWith({ organizationId: "org-1", actorPersonId: "actor-1" }, "p-1", { viewPhotoId: "ph-9" });
  });

  it("an array-valued ?view= is ignored, not guessed at", async () => {
    arrange();
    readPhotoSet.mockResolvedValue({ kind: "ok", set: setView() });
    render(await PersonPhotosPage({ params: params(), searchParams: Promise.resolve({ view: ["a", "b"] }) }));
    expect(readPhotoSet.mock.calls[0]![2]).toEqual({ viewPhotoId: null });
  });
});

describe("PersonPhotosPage — states", () => {
  it("toggle off → the off state naming the org and who can turn it on, no controls", async () => {
    arrange();
    readPhotoSet.mockResolvedValue({ kind: "feature_off" });
    render(await PersonPhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByText(PAGE_COPY.off("Alder Creek Presbyterian Church"))).toBeTruthy();
    expect(screen.queryByLabelText(UPLOAD_COPY.label)).toBeNull();
  });

  it("forbidden → the shared forbidden state, headed Photos", async () => {
    arrange();
    readPhotoSet.mockResolvedValue({ kind: "forbidden" });
    render(await PersonPhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByRole("heading", { name: "Photos" })).toBeTruthy();
    expect(screen.getByText(/don't have permission/i)).toBeTruthy();
  });

  it("not found → notFound()", async () => {
    arrange();
    readPhotoSet.mockResolvedValue({ kind: "not_found" });
    await expect(PersonPhotosPage({ params: params(), searchParams: search() })).rejects.toThrow("NOT_FOUND");
  });

  it("a read error → the load-error state with a way back, not the raw error", async () => {
    arrange();
    readPhotoSet.mockRejectedValue(new Error("connection reset by peer"));
    render(await PersonPhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByText(/couldn't load this right now/i)).toBeTruthy();
    expect(screen.queryByText(/connection reset/)).toBeNull();
    expect(screen.getByRole("link", { name: /try again/i }).getAttribute("href")).toBe("/o/alder-creek/admin/community/p-1/edit");
  });

  it("re-throws OrgAccessError", async () => {
    arrange();
    readPhotoSet.mockRejectedValue(new OrgAccessError("actor-1", "org-1"));
    await expect(PersonPhotosPage({ params: params(), searchParams: search() })).rejects.toBeInstanceOf(OrgAccessError);
  });
});

describe("PersonPhotosPage — data", () => {
  it("empty: the heading, the three status lines, '0 of 10 photos', the empty state naming the next action, and the upload control", async () => {
    arrange();
    const set = setView();
    readPhotoSet.mockResolvedValue({ kind: "ok", set });
    render(await PersonPhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByRole("heading", { level: 1, name: "Photos" })).toBeTruthy();
    expect(screen.getByText("Nora Ashgrove · Alder Creek Presbyterian Church")).toBeTruthy();
    expect(screen.getByRole("heading", { name: PAGE_COPY.whereHeading })).toBeTruthy();
    for (const line of [set.lines.directory, set.lines.website, set.lines.listing]) expect(screen.getByText(line!)).toBeTruthy();
    expect(screen.getByText("0 of 10 photos")).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.emptyTitle)).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.emptyBody)).toBeTruthy();
    expect(screen.getByLabelText(UPLOAD_COPY.label)).toBeTruthy();
    expect(screen.getByRole("link", { name: PAGE_COPY.backToEdit }).getAttribute("href")).toBe("/o/alder-creek/admin/community/p-1/edit");
  });

  it("with photos: the counter and one tile per photo, and no empty state", async () => {
    arrange();
    const tile = (id: string) => ({
      id,
      thumbSrc: "data:image/webp;base64,AAAA",
      width: 800,
      height: 1000,
      createdAt: "2026-10-26T00:00:00.000Z",
      isDirectory: false,
      isWebsite: false,
      directoryAttested: false,
    });
    readPhotoSet.mockResolvedValue({ kind: "ok", set: setView({ photos: [tile("a"), tile("b")], count: 2 }) });
    render(await PersonPhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByText("2 of 10 photos")).toBeTruthy();
    expect(screen.getAllByRole("listitem").some((li) => li.querySelector("img"))).toBe(true);
    expect(screen.queryByText(PAGE_COPY.emptyTitle)).toBeNull();
  });

  it("a person who appears to be under 18: the notice shows and the add control is disabled", async () => {
    arrange();
    readPhotoSet.mockResolvedValue({ kind: "ok", set: setView({ isMinor: true }) });
    render(await PersonPhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByText(PAGE_COPY.minorNotice("Nora"))).toBeTruthy();
    expect((screen.getByLabelText(UPLOAD_COPY.label) as HTMLInputElement).disabled).toBe(true);
  });

  it("a viewed master renders larger, with a way back to all photos", async () => {
    arrange();
    readPhotoSet.mockResolvedValue({
      kind: "ok",
      set: setView({
        photos: [{ id: "a", thumbSrc: null, width: 1, height: 1, createdAt: "x", isDirectory: false, isWebsite: false, directoryAttested: false }],
        count: 1,
        viewed: { photoId: "a", src: "data:image/jpeg;base64,BBBB" },
      }),
    });
    render(await PersonPhotosPage({ params: params(), searchParams: search("a") }));
    const large = screen.getAllByAltText("Nora Ashgrove, photo 1").find((i) => i.getAttribute("src") === "data:image/jpeg;base64,BBBB");
    expect(large).toBeTruthy();
    expect(screen.getByRole("link", { name: PAGE_COPY.backToAll }).getAttribute("href")).toBe("/o/alder-creek/admin/community/p-1/edit/photos");
  });
});

describe("the segment", () => {
  it("has no loading.tsx (the page calls notFound(); a Suspense boundary would flush a 200 first)", () => {
    expect(existsSync(path.resolve(__dirname, "loading.tsx"))).toBe(false);
  });
});
