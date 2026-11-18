// @vitest-environment jsdom
/**
 * The building photo upload island (C14): no `capture`, the pre-hydration gate,
 * the downscaled file posted under the one `photo` field, and every failure shown
 * as a fixed copy-constant string (never raw error text).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockAdd = vi.hoisted(() => vi.fn());
vi.mock("@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/[buildingId]/photos/actions", () => ({
  addBuildingPhotoAction: (...args: unknown[]) => mockAdd(...args),
}));
const mockDownscale = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/image/downscale", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/image/downscale")>("@/lib/storage/image/downscale");
  return { ...actual, downscaleToJpeg: (...args: unknown[]) => mockDownscale(...args) };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { PhotoUploadIsland } from "./photo-upload-island";
import { DownscaleError } from "@/lib/storage/image/downscale";
import { PHOTO_COPY, PHOTO_REFUSAL, TOAST } from "@/lib/oversight/copy";

const PREPARED = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });
const island = () => <PhotoUploadIsland slug="northern-reach" aboutOrgId="a1" buildingId="b1" />;
function choose(file = new File([new Uint8Array(5)], "Site Visit.png", { type: "image/png" })) {
  fireEvent.change(screen.getByLabelText(PHOTO_COPY.addPhoto, { selector: "input" }), { target: { files: [file] } });
}

beforeEach(() => {
  mockDownscale.mockResolvedValue(PREPARED);
  mockAdd.mockResolvedValue({ ok: true, data: { id: "p1", cover: true } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PhotoUploadIsland", () => {
  it("offers camera and library (no capture attribute) and a 44px button", () => {
    render(island());
    const input = screen.getByLabelText(PHOTO_COPY.addPhoto, { selector: "input" }) as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.hasAttribute("capture")).toBe(false);
    expect(input.accept).toBe("image/jpeg,image/png,image/webp,image/heic,image/heif");
    expect(screen.getByRole("button", { name: PHOTO_COPY.addPhoto }).className).toContain("min-h-11");
  });

  it("is inoperable before hydration (the server HTML has the gate disabled)", () => {
    const html = renderToString(island());
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });

  it("downscales, then posts only the prepared file under 'photo', never the original name, and refreshes", async () => {
    render(island());
    choose();
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const [slug, aboutOrgId, buildingId, body] = mockAdd.mock.calls[0] as [string, string, string, FormData];
    expect([slug, aboutOrgId, buildingId]).toEqual(["northern-reach", "a1", "b1"]);
    expect([...body.keys()]).toEqual(["photo"]);
    expect((body.get("photo") as File).name).toBe("photo.jpg");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TOAST.photoAdded));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's fixed refusal as is and does not refresh", async () => {
    mockAdd.mockResolvedValue({ ok: false, error: PHOTO_REFUSAL.cap_reached, kind: "cap_reached" });
    render(island());
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(PHOTO_REFUSAL.cap_reached));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("maps a too-big downscale failure and an undecodable one to the refusal strings, without calling the action", async () => {
    mockDownscale.mockRejectedValueOnce(new DownscaleError("too_big"));
    render(island());
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(PHOTO_REFUSAL.too_large));
    mockDownscale.mockRejectedValueOnce(new Error("secret internals"));
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(PHOTO_REFUSAL.unsupported_type));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("a rejected action call (413, dropped connection) is the one fixed string, never the raw error", async () => {
    mockAdd.mockRejectedValue(new Error("Body exceeded 1 MB limit"));
    render(island());
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(PHOTO_COPY.uploadFailed));
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain("Body exceeded");
  });
});
