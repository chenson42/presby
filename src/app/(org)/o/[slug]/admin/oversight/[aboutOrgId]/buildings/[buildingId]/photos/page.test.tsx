// @vitest-environment jsdom
/**
 * The building photos page (Increment 2, B6; Copy C14): the gate runs before any
 * read, a malformed id segment 404s before any reader, the key is Locked, a miss
 * is a 404, an empty building offers "Add a photo", a building at the cap shows
 * the cap sentence and no upload, `?view=` renders the master (and hides "Make
 * this the cover" on the cover), a bad `?view=` is ignored, and a tile whose
 * thumbnail could not be read still renders. Every sentence is read from the copy
 * constants.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {}
  return { OrgAccessError: MockOrgAccessError };
});
vi.mock("./actions", () => ({
  addBuildingPhotoAction: vi.fn(),
  setPhotoCaptionAction: vi.fn(),
  setPhotoCoverAction: vi.fn(),
  removePhotoAction: vi.fn(),
}));

const gate = vi.fn();
vi.mock("@/lib/presbytery-reports/gate", () => ({ gateOversightPage: (...a: unknown[]) => gate(...a) }));

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/oversight/reads", () => ({ readOversightAccess: access }));
const readPhotos = vi.hoisted(() => vi.fn());
vi.mock("@/lib/oversight/photo-reads", () => ({ readBuildingPhotos: readPhotos }));

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { PHOTO_COPY, PHOTO_REFUSAL } from "@/lib/oversight/copy";
import PhotosPage from "./page";

const A = "22222222-2222-4222-8222-222222222222";
const B = "b0890000-0000-4000-8000-000000000002";
const P1 = "b0890000-0000-4000-8000-0000000000a1";
const P2 = "b0890000-0000-4000-8000-0000000000a2";
const IDENTITY = {
  personId: "p1",
  organizationId: "org-1",
  organizationName: "Presbytery of the Northern Reach",
  organizationType: "presbytery",
  slug: "northern-reach",
};
const CONG = { id: A, name: "Alder Creek Presbyterian Church", platformStatus: "managed" };

const tile = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  caption: null,
  isCover: false,
  thumbSrc: "data:image/webp;base64,AAAA",
  width: 160,
  height: 160,
  ...over,
});
const view = (over: Record<string, unknown> = {}) => ({
  buildingId: B,
  buildingName: "Sanctuary",
  photos: [],
  count: 0,
  cap: 10,
  atCap: false,
  viewed: null,
  ...over,
});

const params = (extra: Record<string, string> = {}) => Promise.resolve({ slug: "northern-reach", aboutOrgId: A, buildingId: B, ...extra });
const search = (view?: string) => Promise.resolve(view === undefined ? {} : { view });

function setup() {
  gate.mockResolvedValue({ ok: true, identity: IDENTITY });
  access.mockResolvedValue({ kind: "ok", data: { manage: true, finance: false, congregation: CONG } });
}

afterEach(() => {
  cleanup();
  gate.mockReset();
  access.mockReset();
  readPhotos.mockReset();
  notFoundMock.mockClear();
});

describe("the building photos page", () => {
  it("renders the gate's state before any read", async () => {
    gate.mockResolvedValue({ ok: false, state: { kind: "flag_off", name: "Presbytery of the Northern Reach" } });
    render(await PhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByText(/isn.t turned on/i)).toBeTruthy();
    expect(access).not.toHaveBeenCalled();
    expect(readPhotos).not.toHaveBeenCalled();
  });

  it("404s a non-UUID building or congregation segment before any reader is called", async () => {
    setup();
    await expect(PhotosPage({ params: params({ buildingId: "nope" }), searchParams: search() })).rejects.toThrow("NOT_FOUND");
    await expect(PhotosPage({ params: params({ aboutOrgId: "nope" }), searchParams: search() })).rejects.toThrow("NOT_FOUND");
    expect(access).not.toHaveBeenCalled();
    expect(readPhotos).not.toHaveBeenCalled();
  });

  it("neither key is the forbidden state, and a viewer without the manage key gets a Locked page and no grid or upload", async () => {
    gate.mockResolvedValue({ ok: true, identity: IDENTITY });
    access.mockResolvedValue({ kind: "forbidden" });
    render(await PhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByText(/don.t have permission to manage congregation oversight records/i)).toBeTruthy();
    cleanup();
    setup();
    readPhotos.mockResolvedValue({ kind: "forbidden" });
    render(await PhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: PHOTO_COPY.addPhoto })).toBeNull();
  });

  it("a building that is not this congregation's is a 404", async () => {
    setup();
    readPhotos.mockResolvedValue({ kind: "not_found" });
    await expect(PhotosPage({ params: params(), searchParams: search() })).rejects.toThrow("NOT_FOUND");
  });

  it("a load failure renders the load error, not a raw error", async () => {
    setup();
    readPhotos.mockRejectedValue(new Error("db down"));
    render(await PhotosPage({ params: params(), searchParams: search() }));
    expect(screen.queryByText(/db down/)).toBeNull();
    expect(screen.queryByRole("heading", { name: PHOTO_COPY.pageTitle("Sanctuary") })).toBeNull();
    expect(screen.queryByRole("button", { name: PHOTO_COPY.addPhoto })).toBeNull();
  });

  it("an empty building shows the title, the back link, All photos (0) and Add a photo", async () => {
    setup();
    readPhotos.mockResolvedValue({ kind: "ok", data: view() });
    render(await PhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByRole("heading", { level: 1, name: PHOTO_COPY.pageTitle("Sanctuary") })).toBeTruthy();
    expect(screen.getByRole("link", { name: PHOTO_COPY.backToBuilding("Sanctuary") }).getAttribute("href")).toBe(
      `/o/northern-reach/admin/oversight/${A}/buildings/${B}`,
    );
    expect(screen.getByRole("heading", { name: PHOTO_COPY.allPhotos(0) })).toBeTruthy();
    expect(screen.getByRole("button", { name: PHOTO_COPY.addPhoto })).toBeTruthy();
  });

  it("the grid is a list of 44px tiles named 'View larger: caption or photo', each linking to ?view=; a null thumbnail still renders the tile", async () => {
    setup();
    readPhotos.mockResolvedValue({
      kind: "ok",
      data: view({ photos: [tile(P1, { isCover: true, caption: "North door" }), tile(P2, { thumbSrc: null })], count: 2 }),
    });
    const { container } = render(await PhotosPage({ params: params(), searchParams: search() }));
    const first = screen.getByRole("link", { name: PHOTO_COPY.viewLarger("North door") });
    const second = screen.getByRole("link", { name: PHOTO_COPY.viewLarger(null) });
    expect(first.getAttribute("href")).toContain(`/photos?view=${P1}`);
    expect(second.getAttribute("href")).toContain(`?view=${P2}`);
    expect(first.className).toContain("min-h-11");
    expect(container.querySelector("ul")?.className).toContain("grid-cols-2");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("at the cap the upload is replaced by the cap sentence", async () => {
    setup();
    readPhotos.mockResolvedValue({
      kind: "ok",
      data: view({
        photos: Array.from({ length: 10 }, (_, i) => tile(`b0890000-0000-4000-8000-00000000010${i % 10}`)),
        count: 10,
        atCap: true,
      }),
    });
    render(await PhotosPage({ params: params(), searchParams: search() }));
    expect(screen.getByText(PHOTO_REFUSAL.cap_reached)).toBeTruthy();
    expect(screen.queryByRole("button", { name: PHOTO_COPY.addPhoto })).toBeNull();
  });

  it("?view= renders the master with the three controls; Make this the cover is hidden on the cover", async () => {
    setup();
    const viewed = { id: P2, caption: "Roof", src: "data:image/jpeg;base64,BBBB", width: 1200, height: 800 };
    readPhotos.mockResolvedValue({
      kind: "ok",
      data: view({ photos: [tile(P1, { isCover: true }), tile(P2, { caption: "Roof" })], count: 2, viewed }),
    });
    const a = render(await PhotosPage({ params: params(), searchParams: search(P2) }));
    expect(readPhotos.mock.calls[0][3]).toEqual({ viewPhotoId: P2 });
    expect(a.container.querySelector('img[src^="data:image/jpeg"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: PHOTO_COPY.editCaption })).toBeTruthy();
    expect(screen.getByRole("button", { name: PHOTO_COPY.makeCover })).toBeTruthy();
    expect(screen.getByRole("button", { name: PHOTO_COPY.removePhoto })).toBeTruthy();
    expect(screen.getByRole("link", { name: PHOTO_COPY.backToAll })).toBeTruthy();
    a.unmount();
    readPhotos.mockResolvedValue({
      kind: "ok",
      data: view({ photos: [tile(P1, { isCover: true })], count: 1, viewed: { ...viewed, id: P1, caption: null } }),
    });
    render(await PhotosPage({ params: params(), searchParams: search(P1) }));
    expect(screen.queryByRole("button", { name: PHOTO_COPY.makeCover })).toBeNull();
  });

  it("a ?view= that is not a UUID is never passed to the reader", async () => {
    setup();
    readPhotos.mockResolvedValue({ kind: "ok", data: view() });
    render(await PhotosPage({ params: params(), searchParams: search("../../etc") }));
    expect(readPhotos.mock.calls[0][3]).toEqual({ viewPhotoId: null });
  });

  it("the remove control opens an AlertDialog with the C14 words (no native confirm)", async () => {
    setup();
    const viewed = { id: P1, caption: null, src: "data:image/jpeg;base64,BBBB", width: 10, height: 10 };
    readPhotos.mockResolvedValue({ kind: "ok", data: view({ photos: [tile(P1, { isCover: true })], count: 1, viewed }) });
    render(await PhotosPage({ params: params(), searchParams: search(P1) }));
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: PHOTO_COPY.removePhoto }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(PHOTO_COPY.removeDialog.title)).toBeTruthy();
    expect(within(dialog).getByText(PHOTO_COPY.removeDialog.body)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: PHOTO_COPY.removeDialog.confirm })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: PHOTO_COPY.removeDialog.cancel })).toBeTruthy();
  });
});
