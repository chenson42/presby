// @vitest-environment jsdom
/**
 * The row buttons and their three dialogs (Increment 3a, Copy groups B, C and D).
 * Mocked at the `./actions` boundary: the actions' own behaviour is
 * `actions.test.ts`'s job. These pin the CLIENT contract: the row's rendered
 * engagement goes to the server as `expectedFrom` (and a stale form is refused
 * in the refusal style, then refreshed), the dialog lines follow the facts the
 * row carries, no native dialog, and every button is disabled until hydration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

const mockChange = vi.hoisted(() => vi.fn());
const mockArchive = vi.hoisted(() => vi.fn());
const mockRestore = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  changeEngagementAction: (...a: unknown[]) => mockChange(...a),
  archivePersonAction: (...a: unknown[]) => mockArchive(...a),
  restorePersonAction: (...a: unknown[]) => mockRestore(...a),
  updateVisitDetailsAction: vi.fn(),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { CommunityRowActions } from "./community-row-actions";

afterEach(() => {
  cleanup();
  for (const m of [mockRefresh, mockChange, mockArchive, mockRestore, toastSuccess, toastError]) m.mockReset();
});

const BASE = {
  slug: "alder-creek",
  personId: "11111111-1111-4111-8111-111111111111",
  personName: "Wren Alder",
  organization: "Alder Creek Presbyterian Church",
  engagementStatus: "inactive" as const,
  archived: false,
  signInConnected: false,
  hasAddress: true,
  invitationOpen: false,
  selfConnectEnabled: true as boolean | null,
};

const STALE = "This changed while you were looking. Reload the page to see the current setting.";

describe("pre-hydration and native dialogs", () => {
  it("every row button is disabled in the server render, before hydration (DECISION-159)", () => {
    const html = renderToString(<CommunityRowActions {...BASE} view="inactive" />);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b).toContain('disabled=""');
  });

  it("opens an AlertDialog, never a native dialog (Rule 2)", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm").mockImplementation(() => true);
    render(<CommunityRowActions {...BASE} view="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular Wren Alder" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    alert.mockRestore();
    confirm.mockRestore();
  });
});

describe("Mark as regular (an Inactive row) sends expectedFrom: the engagement the row rendered", () => {
  it.each(["inactive", "moved_away"] as const)("a %s row: the action carries expectedFrom %s", async (engagementStatus) => {
    mockChange.mockResolvedValue({ ok: true, data: { from: engagementStatus, to: "regular", standingTo: "listed" } });
    render(<CommunityRowActions {...BASE} view="inactive" engagementStatus={engagementStatus} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular Wren Alder" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Mark Wren Alder as a regular attender?")).toBeTruthy();
    expect(within(dialog).getByText("They can then appear in the member directory.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as regular attender" }));
    await waitFor(() => expect(mockChange).toHaveBeenCalledTimes(1));
    expect(mockChange).toHaveBeenCalledWith("alder-creek", {
      personId: BASE.personId,
      to: "regular",
      expectedFrom: engagementStatus,
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Wren Alder is now marked as a regular attender."));
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("stale form: another administrator changed the person, so the dialog shows the sentence in the refusal style, closes and refreshes", async () => {
    mockChange.mockResolvedValue({ ok: false, error: STALE });
    render(<CommunityRowActions {...BASE} view="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular Wren Alder" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark as regular attender" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("'already how this person is marked' is a refusal, not a success", async () => {
    mockChange.mockResolvedValue({ ok: false, error: "That is already how this person is marked." });
    render(<CommunityRowActions {...BASE} view="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular Wren Alder" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark as regular attender" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That is already how this person is marked."));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("a thrown error leaves the dialog open for a retry and says nothing was changed", async () => {
    mockChange.mockRejectedValue(new Error("network"));
    render(<CommunityRowActions {...BASE} view="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular Wren Alder" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark as regular attender" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't save that change. Nothing was changed."));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("Keep as it is closes it and writes nothing", () => {
    render(<CommunityRowActions {...BASE} view="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular Wren Alder" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep as it is" }));
    expect(mockChange).not.toHaveBeenCalled();
  });
});

describe("the lines in the Mark as regular dialog follow the row's facts (EC-25)", () => {
  function lines(props: Partial<React.ComponentProps<typeof CommunityRowActions>>) {
    render(<CommunityRowActions {...BASE} view="inactive" {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular Wren Alder" }));
    return within(screen.getByRole("alertdialog"))
      .getAllByText(/./, { selector: "p" })
      .map((p) => p.textContent);
  }
  const BODY = "They can then appear in the member directory.";
  const CONNECTED = "Wren Alder has a sign-in connected, so this can also change what they can see.";
  const AUTO = "Wren Alder could be connected to this record automatically when they sign in with an address on file.";

  it("connected: the connected line, and never the auto-connect line", () => {
    expect(lines({ signInConnected: true })).toEqual([BODY, CONNECTED]);
  });
  it("not connected, an address, the toggle on: the auto-connect line", () => {
    expect(lines({})).toEqual([BODY, AUTO]);
  });
  it("the toggle unknown (the read failed): no auto-connect line", () => {
    expect(lines({ selfConnectEnabled: null })).toEqual([BODY]);
  });
  it("the toggle off, or no address on file: no auto-connect line", () => {
    expect(lines({ selfConnectEnabled: false })).toEqual([BODY]);
    cleanup();
    expect(lines({ hasAddress: false })).toEqual([BODY]);
  });
});

describe("Archive (Visitors and Inactive rows)", () => {
  const ARCHIVE_BODY = (list: string) =>
    `Wren Alder will leave the ${list} list and appear under Former. Their record is kept and you can restore it any time.`;

  it("a visitor row names the Visitors list; a connected person with an open invitation gets both added lines", () => {
    render(<CommunityRowActions {...BASE} view="visitors" engagementStatus="visitor" signInConnected invitationOpen />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Wren Alder" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Archive Wren Alder?")).toBeTruthy();
    expect(within(dialog).getByText(ARCHIVE_BODY("Visitors"))).toBeTruthy();
    expect(
      within(dialog).getByText("Wren Alder has a sign-in connected and will no longer reach Alder Creek Presbyterian Church through this record."),
    ).toBeTruthy();
    expect(within(dialog).getByText("An invitation to Wren Alder is still open. It will stop working.")).toBeTruthy();
  });

  it("an inactive row names the Inactive list and omits both lines when the facts are absent", () => {
    render(<CommunityRowActions {...BASE} view="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Wren Alder" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(ARCHIVE_BODY("Inactive"))).toBeTruthy();
    expect(within(dialog).queryByText(/has a sign-in connected/)).toBeNull();
    expect(within(dialog).queryByText(/invitation to/i)).toBeNull();
  });

  it("confirming archives by person id only, toasts, closes and refreshes", async () => {
    mockArchive.mockResolvedValue({ ok: true, data: { personId: BASE.personId } });
    render(<CommunityRowActions {...BASE} view="visitors" engagementStatus="visitor" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Wren Alder" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(mockArchive).toHaveBeenCalledWith("alder-creek", { personId: BASE.personId }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Wren Alder is archived. You can restore them from Former."));
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a refusal shows its sentence and keeps the dialog open", async () => {
    const holds = "This person still holds an office, a role or a staff position here. End that first, then try again.";
    mockArchive.mockResolvedValue({ ok: false, error: holds });
    render(<CommunityRowActions {...BASE} view="visitors" engagementStatus="visitor" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Wren Alder" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(holds));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("a thrown error shows the archive database sentence", async () => {
    mockArchive.mockRejectedValue(new Error("boom"));
    render(<CommunityRowActions {...BASE} view="visitors" engagementStatus="visitor" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Wren Alder" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't archive them. Nothing was changed."));
  });
});

describe("your own row (isSelf): Archive is not offered — regression for Archive offered on your own record", () => {
  it("an Inactive row for yourself keeps Mark as regular and drops Archive", () => {
    render(<CommunityRowActions {...BASE} view="inactive" isSelf />);
    expect(screen.getByRole("button", { name: "Mark as regular Wren Alder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive Wren Alder" })).toBeNull();
  });

  it("another person's Inactive row still offers both", () => {
    render(<CommunityRowActions {...BASE} view="inactive" isSelf={false} />);
    expect(screen.getByRole("button", { name: "Mark as regular Wren Alder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive Wren Alder" })).toBeTruthy();
  });

  it("a Visitors row for yourself renders nothing at all", () => {
    const { container } = render(<CommunityRowActions {...BASE} view="visitors" engagementStatus="visitor" isSelf />);
    expect(container.innerHTML).toBe("");
  });

  it("a Former archived row still shows Restore, whoever it is", () => {
    render(<CommunityRowActions {...BASE} view="former" archived isSelf />);
    expect(screen.getByRole("button", { name: "Restore Wren Alder" })).toBeTruthy();
  });
});

describe("Restore (an archived Former row)", () => {
  const FORMER = { ...BASE, view: "former" as const, archived: true };

  it("an archived visitor returns to Visitors; the connected line only when the sign-in is connected", () => {
    render(<CommunityRowActions {...FORMER} engagementStatus="visitor" signInConnected />);
    fireEvent.click(screen.getByRole("button", { name: "Restore Wren Alder" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Restore Wren Alder?")).toBeTruthy();
    expect(within(dialog).getByText("Wren Alder will return to the Visitors list.")).toBeTruthy();
    expect(
      within(dialog).getByText("Wren Alder has a sign-in connected and will reach Alder Creek Presbyterian Church again."),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep archived" })).toBeTruthy();
  });

  it("anyone else returns to Inactive, and the toast names the list the server used", async () => {
    mockRestore.mockResolvedValue({ ok: true, data: { personId: BASE.personId, list: "inactive" } });
    render(<CommunityRowActions {...FORMER} engagementStatus="moved_away" />);
    fireEvent.click(screen.getByRole("button", { name: "Restore Wren Alder" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Wren Alder will return to the Inactive list.")).toBeTruthy();
    expect(within(dialog).queryByText(/has a sign-in connected/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith("alder-creek", { personId: BASE.personId }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Wren Alder is back on the Inactive list."));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("a refusal (not archived, deceased or merged) keeps the dialog open with the sentence", async () => {
    mockRestore.mockResolvedValue({ ok: false, error: "That person wasn't archived here." });
    render(<CommunityRowActions {...FORMER} engagementStatus="visitor" />);
    fireEvent.click(screen.getByRole("button", { name: "Restore Wren Alder" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That person wasn't archived here."));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("what renders", () => {
  it("nothing for a removed participant on Former, or for a Staff row", () => {
    const { container } = render(
      <CommunityRowActions {...BASE} view="former" archived={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
