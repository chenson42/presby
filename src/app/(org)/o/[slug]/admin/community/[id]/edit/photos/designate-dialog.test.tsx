// @vitest-environment jsdom
/**
 * U10 (designate dialog): Copy C4. The website variant cannot be confirmed until
 * the attestation is ticked; the directory variant's box starts unticked and
 * its consequence line follows the tick; a refusal leaves the dialog open.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockDesignate = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ designatePersonPhotoAction: (...args: unknown[]) => mockDesignate(...args) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { DesignateDialog } from "./designate-dialog";
import { CONSEQUENCE_COPY, DESIGNATE_COPY } from "@/lib/person-photos/copy";
import type { PhotoStateSnapshot } from "@/lib/person-photos/consequences";

const LISTED_NO_WEBSITE: PhotoStateSnapshot = { first: "Nora", listed: true, website: null, directory: null };

function dialog(purpose: "directory" | "website", state = LISTED_NO_WEBSITE, onOpenChange = vi.fn()) {
  render(
    <DesignateDialog
      slug="alder-creek"
      personId="p-1"
      photoId="ph-1"
      purpose={purpose}
      state={state}
      name="Nora Ashgrove"
      open
      onOpenChange={onOpenChange}
    />,
  );
  return onOpenChange;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DesignateDialog — directory", () => {
  it("shows the title, the body naming the person, an UNTICKED native checkbox, and a confirm that is already enabled", () => {
    dialog("directory");
    expect(screen.getByText(DESIGNATE_COPY.directory.title)).toBeTruthy();
    expect(screen.getByText(DESIGNATE_COPY.directory.body("Nora Ashgrove"))).toBeTruthy();
    const box = screen.getByLabelText(DESIGNATE_COPY.directory.checkbox("Nora")) as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
    expect((screen.getByRole("button", { name: DESIGNATE_COPY.directory.confirm }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("follows the tick: unticked a listed person with no website photo gets no website sentence; ticked, the 'will also appear' one", () => {
    dialog("directory");
    expect(screen.queryByText(CONSEQUENCE_COPY.directoryAlsoOnWebsite("Nora"))).toBeNull();
    fireEvent.click(screen.getByLabelText(DESIGNATE_COPY.directory.checkbox("Nora")));
    expect(screen.getByText(CONSEQUENCE_COPY.directoryAlsoOnWebsite("Nora"))).toBeTruthy();
  });

  it("posts attested false when unticked and true when ticked", async () => {
    mockDesignate.mockResolvedValue({ ok: true });
    const onOpenChange = dialog("directory");
    fireEvent.click(screen.getByRole("button", { name: DESIGNATE_COPY.directory.confirm }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockDesignate).toHaveBeenCalledWith("alder-creek", "p-1", { photoId: "ph-1", purpose: "directory", attested: false });
  });

  it("posts attested true when ticked", async () => {
    mockDesignate.mockResolvedValue({ ok: true });
    dialog("directory");
    fireEvent.click(screen.getByLabelText(DESIGNATE_COPY.directory.checkbox("Nora")));
    fireEvent.click(screen.getByRole("button", { name: DESIGNATE_COPY.directory.confirm }));
    await waitFor(() => expect(mockDesignate).toHaveBeenCalled());
    expect(mockDesignate.mock.calls[0]![2]).toMatchObject({ attested: true });
  });
});

describe("DesignateDialog — website", () => {
  it("the confirm is disabled until the permission box is ticked, and a click on it does nothing", () => {
    dialog("website");
    expect(screen.getByText(DESIGNATE_COPY.website.title)).toBeTruthy();
    expect(screen.getByText(DESIGNATE_COPY.website.body)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: DESIGNATE_COPY.website.confirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(mockDesignate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(DESIGNATE_COPY.website.checkbox("Nora")));
    expect(confirm.disabled).toBe(false);
  });

  it("states the standing residual: copies kept by search engines and archives cannot be recalled", () => {
    dialog("website");
    expect(screen.getByText(/search engines and web archives may keep copies/i)).toBeTruthy();
    expect(screen.getByText(/can't recall them/i)).toBeTruthy();
  });

  it("says whether the person is listed, and when it replaces another photo", () => {
    dialog("website", { first: "Nora", listed: false, website: { photoId: "other" }, directory: null });
    expect(screen.getByText(CONSEQUENCE_COPY.websiteNotListed("Nora"))).toBeTruthy();
    expect(screen.getByText(CONSEQUENCE_COPY.websiteReplaces)).toBeTruthy();
  });

  it("posts attested true for the website, then closes", async () => {
    mockDesignate.mockResolvedValue({ ok: true });
    const onOpenChange = dialog("website");
    fireEvent.click(screen.getByLabelText(DESIGNATE_COPY.website.checkbox("Nora")));
    fireEvent.click(screen.getByRole("button", { name: DESIGNATE_COPY.website.confirm }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockDesignate).toHaveBeenCalledWith("alder-creek", "p-1", { photoId: "ph-1", purpose: "website", attested: true });
  });

  it("a refusal stays open and shows the server's string", async () => {
    mockDesignate.mockResolvedValue({ ok: false, error: "That photo was already removed." });
    const onOpenChange = dialog("website");
    fireEvent.click(screen.getByLabelText(DESIGNATE_COPY.website.checkbox("Nora")));
    fireEvent.click(screen.getByRole("button", { name: DESIGNATE_COPY.website.confirm }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That photo was already removed."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
