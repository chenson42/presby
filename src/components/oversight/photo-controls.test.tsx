// @vitest-environment jsdom
/**
 * The larger view's controls (C14): the caption form validates with the module's
 * own rule and shows the server's refusal under the field, make-cover and remove
 * toast the action's own string or the constant, and remove goes through an
 * AlertDialog and returns to the grid.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const act = vi.hoisted(() => ({ caption: vi.fn(), cover: vi.fn(), remove: vi.fn() }));
vi.mock("@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/[buildingId]/photos/actions", () => ({
  setPhotoCaptionAction: act.caption,
  setPhotoCoverAction: act.cover,
  removePhotoAction: act.remove,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { PhotoControls } from "./photo-controls";
import { PHOTO_COPY, TOAST, VALIDATION } from "@/lib/oversight/copy";

const props = { slug: "s", aboutOrgId: "a", buildingId: "b", photoId: "p", caption: "Old", isCover: false, photosHref: "/o/s/photos" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PhotoControls", () => {
  it("every control is at least 44px", () => {
    render(<PhotoControls {...props} />);
    for (const name of [PHOTO_COPY.editCaption, PHOTO_COPY.makeCover, PHOTO_COPY.removePhoto]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
  });

  it("hides Make this the cover on the cover", () => {
    render(<PhotoControls {...props} isCover />);
    expect(screen.queryByRole("button", { name: PHOTO_COPY.makeCover })).toBeNull();
  });

  it("make cover toasts the constant and refreshes; a refusal toasts the action's string", async () => {
    act.cover.mockResolvedValueOnce({ ok: true, data: { id: "p" } });
    render(<PhotoControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: PHOTO_COPY.makeCover }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TOAST.coverChanged));
    expect(router.refresh).toHaveBeenCalled();
    act.cover.mockResolvedValueOnce({ ok: false, error: "That photo was already removed.", kind: "already_removed" });
    fireEvent.click(screen.getByRole("button", { name: PHOTO_COPY.makeCover }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That photo was already removed."));
  });

  it("edits the caption: the field is labelled, prefilled, saved through the action, and toasts the constant", async () => {
    act.caption.mockResolvedValue({ ok: true, data: { id: "p" } });
    render(<PhotoControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: PHOTO_COPY.editCaption }));
    const field = screen.getByLabelText(PHOTO_COPY.captionLabel) as HTMLInputElement;
    expect(field.value).toBe("Old");
    fireEvent.change(field, { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Save caption" }));
    await waitFor(() => expect(act.caption).toHaveBeenCalledWith("s", "a", "b", "p", { caption: "New" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TOAST.captionSaved));
  });

  it("a caption over 200 characters shows the module's sentence under the field and calls nothing", async () => {
    render(<PhotoControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: PHOTO_COPY.editCaption }));
    fireEvent.change(screen.getByLabelText(PHOTO_COPY.captionLabel), { target: { value: "x".repeat(201) } });
    fireEvent.click(screen.getByRole("button", { name: "Save caption" }));
    expect(await screen.findByText(VALIDATION.captionTooLong)).toBeTruthy();
    expect(act.caption).not.toHaveBeenCalled();
  });

  it("remove asks first; Cancel does nothing, Remove photo calls the action, toasts and returns to the grid", async () => {
    act.remove.mockResolvedValue({ ok: true, data: { id: "p" } });
    render(<PhotoControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: PHOTO_COPY.removePhoto }));
    let dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: PHOTO_COPY.removeDialog.cancel }));
    expect(act.remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: PHOTO_COPY.removePhoto }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: PHOTO_COPY.removeDialog.confirm }));
    await waitFor(() => expect(act.remove).toHaveBeenCalledWith("s", "a", "b", "p"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TOAST.photoRemoved));
    expect(router.push).toHaveBeenCalledWith("/o/s/photos");
  });
});
