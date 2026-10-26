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

const snap = (over: Partial<PhotoStateSnapshot> = {}): PhotoStateSnapshot => ({
  first: "Nora",
  listed: true,
  website: null,
  directory: null,
  minor: false,
  directoryWithheld: null,
  websiteWithheld: null,
  ...over,
});
const LISTED_NO_WEBSITE = snap();

function dialog(purpose: "directory" | "website", state = LISTED_NO_WEBSITE, onOpenChange = vi.fn(), clear = false) {
  render(
    <DesignateDialog
      slug="alder-creek"
      personId="p-1"
      photoId="ph-1"
      purpose={purpose}
      clear={clear}
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
  it("the body is exactly the ruled text: who sees it, and the unless-clause (R-a5, T6)", () => {
    dialog("directory");
    expect(
      screen.getByText(
        "Members who can see Nora Ashgrove in the directory will see this photo instead of their initials, unless Nora has hidden their photo or appears to be under 18.",
      ),
    ).toBeTruthy();
  });

  it("shows the title, the body naming the person, an UNTICKED native checkbox, and a confirm that is already enabled", () => {
    dialog("directory");
    expect(screen.getByText(DESIGNATE_COPY.directory.title)).toBeTruthy();
    expect(screen.getByText(DESIGNATE_COPY.directory.body("Nora Ashgrove", "Nora"))).toBeTruthy();
    const box = screen.getByLabelText(DESIGNATE_COPY.directory.checkbox("Nora")) as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
    expect((screen.getByRole("button", { name: DESIGNATE_COPY.directory.confirm }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("follows the tick: unticked a listed person with no website photo gets no website sentence; ticked, the hedged 'can also appear' one", () => {
    dialog("directory");
    expect(screen.queryByText(CONSEQUENCE_COPY.directoryAlsoOnWebsite("Nora"))).toBeNull();
    fireEvent.click(screen.getByLabelText(DESIGNATE_COPY.directory.checkbox("Nora")));
    expect(screen.getByText(CONSEQUENCE_COPY.directoryAlsoOnWebsite("Nora"))).toBeTruthy();
    expect(screen.queryByText(/will (also )?appear/)).toBeNull();
  });

  it("someone who appears to be under 18: the only sentence is the blocked one, and the confirm is disabled", () => {
    dialog("directory", snap({ minor: true }));
    expect(
      screen.getByText("Nora appears to be under 18, so a photo of Nora can't be chosen for the directory or the website yet."),
    ).toBeTruthy();
    expect(document.querySelectorAll("[aria-live='polite'] p")).toHaveLength(1);
    const confirm = screen.getByRole("button", { name: DESIGNATE_COPY.directory.confirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(mockDesignate).not.toHaveBeenCalled();
  });

  it("a hidden photo: the directory dialog says the directory won't show it", () => {
    dialog("directory", snap({ directoryWithheld: "hide_photo" }));
    expect(screen.getByText(CONSEQUENCE_COPY.directoryHidden("Nora"))).toBeTruthy();
    expect(screen.getByText(/Nora has hidden their photo, so the directory won't show this photo while that is so\./)).toBeTruthy();
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

  it("a hidden photo on a listed person: the website dialog says the website won't show it, and never 'listed, so this photo can appear'", () => {
    dialog("website", snap({ websiteWithheld: "hide_photo" }));
    expect(screen.getByText("Nora has hidden their photo, so the website won't show this photo while that is so.")).toBeTruthy();
    expect(screen.queryByText(CONSEQUENCE_COPY.websiteListed("Nora"))).toBeNull();
  });

  it("someone who appears to be under 18: the blocked sentence, and the confirm stays disabled even once ticked", () => {
    dialog("website", snap({ minor: true }));
    expect(
      screen.getByText("Nora appears to be under 18, so a photo of Nora can't be chosen for the directory or the website yet."),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText(DESIGNATE_COPY.website.checkbox("Nora")));
    expect((screen.getByRole("button", { name: DESIGNATE_COPY.website.confirm }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says whether the person is listed, and when it replaces another photo", () => {
    dialog("website", snap({ listed: false, website: { photoId: "other" } }));
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

describe("DesignateDialog — clear for website (R-b2, T6)", () => {
  const CLEAR_TITLE = "Clear this photo for the website?";
  const CLEAR_BODY =
    "This is Nora's directory photo. Clearing it lets the public website use it too when Nora is listed and no website photo is chosen. Anyone on the internet can see a photo on the public website. Search engines and web archives may keep copies, and removing the photo later can't recall them.";
  const CHECKBOX =
    "I have Nora's permission to also use this photo on the public website if they are listed there and no website photo is chosen.";
  const confirmBtn = () => screen.getByRole("button", { name: "Clear for website" }) as HTMLButtonElement;

  it("shows the clear title, the body naming the residual, and the directory checkbox, unticked", () => {
    dialog("directory", snap({ directory: { photoId: "ph-1", attested: false } }), vi.fn(), true);
    expect(screen.getByText(CLEAR_TITLE)).toBeTruthy();
    expect(screen.getByText(CLEAR_BODY)).toBeTruthy();
    expect((screen.getByLabelText(CHECKBOX) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(DESIGNATE_COPY.directory.title)).toBeNull();
  });

  it("the confirm is disabled until the box is ticked, and a click on it does nothing", () => {
    dialog("directory", snap({ directory: { photoId: "ph-1", attested: false } }), vi.fn(), true);
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.click(confirmBtn());
    expect(mockDesignate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(CHECKBOX));
    expect(confirmBtn().disabled).toBe(false);
  });

  it("ticked, the consequence under the box is the hedged website sentence", () => {
    dialog("directory", snap({ directory: { photoId: "ph-1", attested: false } }), vi.fn(), true);
    fireEvent.click(screen.getByLabelText(CHECKBOX));
    expect(screen.getByText(CONSEQUENCE_COPY.directoryAlsoOnWebsite("Nora"))).toBeTruthy();
  });

  it("is disabled for someone who appears to be under 18, even once ticked", () => {
    dialog("directory", snap({ minor: true, directory: { photoId: "ph-1", attested: false } }), vi.fn(), true);
    fireEvent.click(screen.getByLabelText(CHECKBOX));
    expect(confirmBtn().disabled).toBe(true);
  });

  it("on confirm posts the directory purpose with the attestation, then closes", async () => {
    mockDesignate.mockResolvedValue({ ok: true });
    const onOpenChange = dialog("directory", snap({ directory: { photoId: "ph-1", attested: false } }), vi.fn(), true);
    fireEvent.click(screen.getByLabelText(CHECKBOX));
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockDesignate).toHaveBeenCalledWith("alder-creek", "p-1", { photoId: "ph-1", purpose: "directory", attested: true });
  });
});
