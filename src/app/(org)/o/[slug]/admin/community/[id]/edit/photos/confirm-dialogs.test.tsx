// @vitest-environment jsdom
/**
 * U10 (remove and un-designate dialogs): Copy C5. The body is the consequence
 * sentences chosen from the person's live state; the residuals are present; a
 * refusal leaves the dialog open.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockRemove = vi.hoisted(() => vi.fn());
const mockUndesignate = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  removePersonPhotoAction: (...args: unknown[]) => mockRemove(...args),
  undesignatePersonPhotoAction: (...args: unknown[]) => mockUndesignate(...args),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ConfirmDialog } from "./confirm-dialogs";
import { CONFIRM_COPY, CONSEQUENCE_COPY } from "@/lib/person-photos/copy";
import type { PhotoStateSnapshot } from "@/lib/person-photos/consequences";

const STANDING_IN: PhotoStateSnapshot = {
  first: "Nora",
  listed: true,
  website: null,
  directory: { photoId: "ph-1", attested: true },
};

function show(
  action: React.ComponentProps<typeof ConfirmDialog>["action"],
  state: PhotoStateSnapshot = STANDING_IN,
  onOpenChange = vi.fn(),
) {
  render(<ConfirmDialog slug="alder-creek" personId="p-1" state={state} action={action} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConfirmDialog", () => {
  it("remove: the title, the file-stays-in-storage residual, and what leaves each surface", () => {
    show({ kind: "remove", photoId: "ph-1" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(CONFIRM_COPY.remove.title)).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.removeBase)).toBeTruthy();
    expect(screen.getByText(/can't be erased from here/)).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.removeIsDirectory("Nora"))).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.removeIsFallback)).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.removeCaches)).toBeTruthy();
  });

  it("remove of a photo used nowhere carries no website or cache sentence", () => {
    show({ kind: "remove", photoId: "other" }, { first: "Nora", listed: true, website: null, directory: null });
    expect(screen.queryByText(CONSEQUENCE_COPY.removeCaches)).toBeNull();
    expect(screen.queryByText(CONSEQUENCE_COPY.removeIsWebsite)).toBeNull();
  });

  it("stop using in the directory: initials, plus the website ending when the photo was standing in there", () => {
    show({ kind: "stop_directory" });
    expect(screen.getByText(CONFIRM_COPY.stopDirectory.title)).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.directoryInitials("Nora"))).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.directoryAlsoOnWebsiteEnds)).toBeTruthy();
  });

  it("stop using on the website: falls back to the cleared directory photo, and states the cache and archive residual", () => {
    show({ kind: "stop_website" }, { first: "Nora", listed: true, website: { photoId: "ph-2" }, directory: { photoId: "ph-1", attested: true } });
    expect(screen.getByText(CONFIRM_COPY.stopWebsite.title)).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.websiteFallsBack("Nora"))).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.websiteCaches)).toBeTruthy();
  });

  it("stop using on the website with no cleared directory photo says the website will show none", () => {
    show({ kind: "stop_website" }, { first: "Nora", listed: true, website: { photoId: "ph-2" }, directory: null });
    expect(screen.getByText(CONSEQUENCE_COPY.websiteShowsNone("Nora"))).toBeTruthy();
  });

  it("confirming remove calls the remove action with the photo id, then closes", async () => {
    mockRemove.mockResolvedValue({ ok: true });
    const onOpenChange = show({ kind: "remove", photoId: "ph-1" });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_COPY.remove.confirm }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockRemove).toHaveBeenCalledWith("alder-creek", "p-1", "ph-1");
  });

  it("confirming a stop calls un-designate with the purpose", async () => {
    mockUndesignate.mockResolvedValue({ ok: true });
    show({ kind: "stop_website" });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_COPY.stopWebsite.confirm }));
    await waitFor(() => expect(mockUndesignate).toHaveBeenCalledWith("alder-creek", "p-1", "website"));
  });

  it("a refusal keeps the dialog open and shows the server's string", async () => {
    mockRemove.mockResolvedValue({ ok: false, error: "That photo was already removed." });
    const onOpenChange = show({ kind: "remove", photoId: "ph-1" });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_COPY.remove.confirm }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That photo was already removed."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Cancel closes without calling anything", () => {
    const onOpenChange = show({ kind: "remove", photoId: "ph-1" });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_COPY.cancel }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
