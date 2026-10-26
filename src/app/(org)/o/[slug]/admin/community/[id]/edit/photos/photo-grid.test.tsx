// @vitest-environment jsdom
/**
 * U10 (tiles): Copy C2. Chips, the per-tile buttons that toggle with the
 * photo's designation, the group label that names which photo a button
 * belongs to, the View larger link, and the unreadable-thumbnail plate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("./actions", () => ({
  designatePersonPhotoAction: vi.fn(),
  removePersonPhotoAction: vi.fn(),
  undesignatePersonPhotoAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PhotoGrid } from "./photo-grid";
import { CONFIRM_COPY, DESIGNATE_COPY, PAGE_COPY } from "@/lib/person-photos/copy";
import type { PhotoSetView, PhotoTileView } from "@/lib/person-photos/types";

const tile = (over: Partial<PhotoTileView> & { id: string }): PhotoTileView => ({
  thumbSrc: "data:image/webp;base64,AAAA",
  width: 800,
  height: 1000,
  createdAt: "2026-10-26T00:00:00.000Z",
  isDirectory: false,
  isWebsite: false,
  directoryAttested: false,
  ...over,
});

function set(photos: PhotoTileView[], state: Partial<PhotoSetView["state"]> = {}): PhotoSetView {
  return {
    personId: "p-1",
    displayName: "Nora Ashgrove",
    firstName: "Nora",
    organizationName: "Alder Creek Presbyterian Church",
    photos,
    count: photos.length,
    isMinor: false,
    directory: { photoId: null, thumbKey: null, withheld: null },
    website: { imageKey: null, source: null, withheld: null, unattestedDirectoryOnly: false },
    listings: [],
    lines: { directory: "d", website: "w", listing: "l" },
    state: {
      first: "Nora",
      listed: false,
      website: null,
      directory: null,
      minor: false,
      directoryWithheld: null,
      websiteWithheld: null,
      ...state,
    },
    viewed: null,
  };
}

afterEach(cleanup);

describe("PhotoGrid", () => {
  it("renders each photo with the alt '{name}, photo {n}', numbered in order", () => {
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "a" }), tile({ id: "b" })])} />);
    expect(screen.getByAltText("Nora Ashgrove, photo 1")).toBeTruthy();
    expect(screen.getByAltText("Nora Ashgrove, photo 2")).toBeTruthy();
  });

  it("chips: Directory, Website, and 'Directory, cleared for website' for an attested directory photo", () => {
    render(
      <PhotoGrid
        slug="alder-creek"
        set={set([
          tile({ id: "a", isDirectory: true, directoryAttested: true }),
          tile({ id: "b", isWebsite: true }),
          tile({ id: "c", isDirectory: true }),
          tile({ id: "d" }),
        ])}
      />,
    );
    expect(screen.getByText(PAGE_COPY.chipDirectoryCleared)).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.chipWebsite)).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.chipDirectory, { exact: true })).toBeTruthy();
    // The unchosen photo carries no chip at all.
    const fourth = screen.getByRole("group", { name: "Nora Ashgrove, photo 4" }).closest("li")!;
    expect(fourth.querySelectorAll('[data-slot="badge"]')).toHaveLength(0);
  });

  it("each tile's buttons say Use when the photo is not chosen and Stop using when it is", () => {
    render(
      <PhotoGrid slug="alder-creek" set={set([tile({ id: "a", isDirectory: true, isWebsite: true }), tile({ id: "b" })])} />,
    );
    const first = within(screen.getByRole("group", { name: "Nora Ashgrove, photo 1" }));
    expect(first.getByRole("button", { name: PAGE_COPY.stopInDirectory })).toBeTruthy();
    expect(first.getByRole("button", { name: PAGE_COPY.stopOnWebsite })).toBeTruthy();
    const second = within(screen.getByRole("group", { name: "Nora Ashgrove, photo 2" }));
    expect(second.getByRole("button", { name: PAGE_COPY.useInDirectory })).toBeTruthy();
    expect(second.getByRole("button", { name: PAGE_COPY.useOnWebsite })).toBeTruthy();
    expect(second.getByRole("button", { name: PAGE_COPY.remove })).toBeTruthy();
  });

  it("'Clear for website' is on the current directory photo when it is NOT cleared, and nowhere else (T7)", () => {
    render(
      <PhotoGrid
        slug="alder-creek"
        set={set([
          tile({ id: "a", isDirectory: true, directoryAttested: false }),
          tile({ id: "b", isDirectory: true, directoryAttested: true }),
          tile({ id: "c" }),
          tile({ id: "d", isWebsite: true }),
        ])}
      />,
    );
    const names = (n: number) =>
      within(screen.getByRole("group", { name: `Nora Ashgrove, photo ${n}` })).queryAllByRole("button").map((b) => b.textContent);
    expect(names(1)).toEqual(["Stop using in directory", "Clear for website", "Use on website", "Remove"]);
    expect(names(2)).toEqual(["Stop using in directory", "Use on website", "Remove"]); // an attested directory photo
    expect(names(3)).toEqual(["Use in directory", "Use on website", "Remove"]); // not the directory photo
    expect(names(4)).toEqual(["Use in directory", "Stop using on website", "Remove"]);
  });

  it("'Clear for website' is absent when the person appears to be under 18", () => {
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "a", isDirectory: true })], { minor: true })} />);
    expect(screen.queryByRole("button", { name: PAGE_COPY.clearForWebsite })).toBeNull();
  });

  it("'Clear for website' opens the clear dialog, with its confirm disabled until the box is ticked (never the plain directory dialog)", () => {
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "a", isDirectory: true })])} />);
    fireEvent.click(screen.getByRole("button", { name: PAGE_COPY.clearForWebsite }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(DESIGNATE_COPY.clear.title)).toBeTruthy();
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: DESIGNATE_COPY.clear.confirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("every button is a 44px target", () => {
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "a" })])} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toContain("min-h-11");
    expect(screen.getByRole("link", { name: PAGE_COPY.viewLarger }).className).toContain("min-h-11");
  });

  it("View larger links to ?view=<photo id> on the same page", () => {
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "11111111-1111-4111-8111-111111111111" })])} />);
    expect(screen.getByRole("link", { name: PAGE_COPY.viewLarger }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/community/p-1/edit/photos?view=11111111-1111-4111-8111-111111111111",
    );
  });

  it("an unreadable thumbnail renders a plate that still carries the alt text and the buttons", () => {
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "a", thumbSrc: null })])} />);
    expect(screen.getByRole("img", { name: "Nora Ashgrove, photo 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: PAGE_COPY.remove })).toBeTruthy();
  });

  it("the remove button opens the AlertDialog (never a native confirm)", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "a" })])} />);
    fireEvent.click(screen.getByRole("button", { name: PAGE_COPY.remove }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(CONFIRM_COPY.remove.title)).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Use on website opens the designate dialog with its confirm disabled", () => {
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "a" })])} />);
    fireEvent.click(screen.getByRole("button", { name: PAGE_COPY.useOnWebsite }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByRole("button", { name: DESIGNATE_COPY.website.confirm }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reopening the website dialog starts with the box unticked again", () => {
    render(<PhotoGrid slug="alder-creek" set={set([tile({ id: "a" })])} />);
    fireEvent.click(screen.getByRole("button", { name: PAGE_COPY.useOnWebsite }));
    fireEvent.click(screen.getByLabelText(DESIGNATE_COPY.website.checkbox("Nora")));
    fireEvent.click(screen.getByRole("button", { name: DESIGNATE_COPY.cancel }));
    fireEvent.click(screen.getByRole("button", { name: PAGE_COPY.useOnWebsite }));
    expect((screen.getByLabelText(DESIGNATE_COPY.website.checkbox("Nora")) as HTMLInputElement).checked).toBe(false);
  });
});
