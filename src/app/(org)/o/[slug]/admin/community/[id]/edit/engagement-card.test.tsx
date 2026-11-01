// @vitest-environment jsdom
/**
 * The Engagement card (Increment 3a, Copy group A) and its two entry points
 * into `changeEngagementAction`: Save, and the visitor nudge. The binding
 * property (Phase 3 acknowledgement, "For Batch C" 1): every write sends the
 * engagement the page rendered as `expectedFrom`, and a stale form is shown the
 * refusal sentence and refreshed. Mocked at the `../../actions` boundary.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

const mockChange = vi.hoisted(() => vi.fn());
vi.mock("../../actions", () => ({
  changeEngagementAction: (...a: unknown[]) => mockChange(...a),
  archivePersonAction: vi.fn(),
  restorePersonAction: vi.fn(),
  updateVisitDetailsAction: vi.fn(),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { EngagementCard } from "./engagement-card";

afterEach(() => {
  cleanup();
  for (const m of [mockRefresh, mockChange, toastSuccess, toastError]) m.mockReset();
});

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const BASE = {
  slug: "alder-creek",
  personId: PERSON_ID,
  personName: "Wren Alder",
  engagement: "regular" as const,
  currentRoll: null as string | null,
  ended: null,
  signInConnected: false as boolean | null,
  addressOnFile: true as boolean | null,
  selfConnectEnabled: true as boolean | null,
};
const STALE = "This changed while you were looking. Reload the page to see the current setting.";
const ok = (to: string) => ({ ok: true, data: { from: "x", to, standingTo: "listed" } });

function pick(value: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Engagement for Wren Alder" }), { target: { value } });
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save engagement" }));

describe("the control", () => {
  it("renders the heading, helper, labelled select and Save, disabled until something changes", () => {
    render(<EngagementCard {...BASE} />);
    expect(screen.getByRole("heading", { name: "Engagement" })).toBeTruthy();
    expect(screen.getByLabelText("Engagement for Wren Alder")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Save engagement" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    pick("inactive");
    expect(button.disabled).toBe(false);
    pick("regular");
    expect(button.disabled).toBe(true);
  });

  it("the description follows the selected option (no roll)", () => {
    render(<EngagementCard {...BASE} />);
    expect(screen.getByText("Regular attender. Can appear in the member directory.")).toBeTruthy();
    pick("inactive");
    expect(screen.getByText("Inactive. Not attending lately. Does not appear in the member directory.")).toBeTruthy();
    pick("moved_away");
    expect(screen.getByText("Moved away. Does not appear in the member directory.")).toBeTruthy();
    pick("visitor");
    expect(screen.getByText("Visitor. Does not appear in the member directory.")).toBeTruthy();
  });

  it("on the roll: the three roll descriptions, and Visitor is not offered", () => {
    render(<EngagementCard {...BASE} currentRoll="active" />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Regular attender", "Inactive", "Moved away"]);
    pick("inactive");
    expect(
      screen.getByText("Inactive. Not attending lately. Can still appear in the member directory because they are on the roll."),
    ).toBeTruthy();
    pick("moved_away");
    expect(
      screen.getByText(
        "Moved away. Can still appear in the member directory because they are on the roll. A departure is recorded as a roll action, not here.",
      ),
    ).toBeTruthy();
  });

  it("the select and Save are disabled in the server render, before hydration (DECISION-159)", () => {
    const html = renderToString(<EngagementCard {...BASE} />);
    const select = html.match(/<select[^>]*>/)?.[0] ?? "";
    expect(select).toContain('disabled=""');
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toContain('disabled=""');
  });

  it("a staff record, an archived person and another ended connection get a line and no control", () => {
    const { rerender } = render(<EngagementCard {...BASE} engagement="staff" />);
    expect(screen.getByText("This is a staff record, so engagement isn't tracked.")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    rerender(<EngagementCard {...BASE} ended="archived" />);
    expect(screen.getByText("Wren Alder was archived. Restore them to change this.")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    rerender(<EngagementCard {...BASE} ended="other" />);
    expect(screen.getByText("Wren Alder's connection here has ended, so engagement can't be changed.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Save sends expectedFrom (direct save: the change does not move listing)", () => {
  it.each([
    ["inactive", "moved_away"],
    ["moved_away", "inactive"],
    ["inactive", "visitor"],
    ["visitor", "inactive"],
  ] as const)("%s to %s writes at once with expectedFrom %s", async (from, to) => {
    mockChange.mockResolvedValue(ok(to));
    render(<EngagementCard {...BASE} engagement={from} />);
    pick(to);
    save();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(mockChange).toHaveBeenCalledTimes(1));
    expect(mockChange).toHaveBeenCalledWith("alder-creek", { personId: PERSON_ID, to, expectedFrom: from });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("a person on the roll never gets a dialog: regular to inactive writes at once with expectedFrom regular", async () => {
    mockChange.mockResolvedValue(ok("inactive"));
    render(<EngagementCard {...BASE} currentRoll="baptized" />);
    pick("inactive");
    save();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(mockChange).toHaveBeenCalledWith("alder-creek", { personId: PERSON_ID, to: "inactive", expectedFrom: "regular" }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Wren Alder is now marked as inactive."));
  });

  it("stale form (direct save): the sentence in the refusal style, then a refresh so the next attempt starts from the current value", async () => {
    mockChange.mockResolvedValue({ ok: false, error: STALE });
    render(<EngagementCard {...BASE} engagement="inactive" />);
    pick("moved_away");
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("'already how this person is marked' is a refusal, not a success", async () => {
    mockChange.mockResolvedValue({ ok: false, error: "That is already how this person is marked." });
    render(<EngagementCard {...BASE} engagement="inactive" />);
    pick("moved_away");
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That is already how this person is marked."));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("a thrown error says nothing was changed and does not refresh", async () => {
    mockChange.mockRejectedValue(new Error("network"));
    render(<EngagementCard {...BASE} engagement="inactive" />);
    pick("moved_away");
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't save that change. Nothing was changed."));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("Save sends expectedFrom (through the dialog: the change moves listing)", () => {
  it("visitor to regular: the dialog, then the write with expectedFrom visitor", async () => {
    mockChange.mockResolvedValue(ok("regular"));
    render(<EngagementCard {...BASE} engagement="visitor" />);
    pick("regular");
    save();
    expect(mockChange).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Mark Wren Alder as a regular attender?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as regular attender" }));
    await waitFor(() =>
      expect(mockChange).toHaveBeenCalledWith("alder-creek", { personId: PERSON_ID, to: "regular", expectedFrom: "visitor" }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Wren Alder is now marked as a regular attender."));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("regular to moved away (no roll): the dialog says they leave the directory; the write carries expectedFrom regular", async () => {
    mockChange.mockResolvedValue(ok("moved_away"));
    render(<EngagementCard {...BASE} signInConnected />);
    pick("moved_away");
    save();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Mark Wren Alder as moved away?")).toBeTruthy();
    expect(within(dialog).getByText("They will no longer appear in the member directory.")).toBeTruthy();
    expect(
      within(dialog).getByText("Wren Alder has a sign-in connected, so this can also change what they can see."),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as moved away" }));
    await waitFor(() =>
      expect(mockChange).toHaveBeenCalledWith("alder-creek", { personId: PERSON_ID, to: "moved_away", expectedFrom: "regular" }),
    );
  });

  it("stale form (through the dialog): refusal style, dialog closed, refreshed", async () => {
    mockChange.mockResolvedValue({ ok: false, error: STALE });
    render(<EngagementCard {...BASE} engagement="visitor" />);
    pick("regular");
    save();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark as regular attender" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("the dialog's facts come from the props: unknown sign-in facts say 'if', and no auto-connect line without the toggle", () => {
    render(<EngagementCard {...BASE} engagement="visitor" signInConnected={null} selfConnectEnabled={null} />);
    pick("regular");
    save();
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText("If Wren Alder has a sign-in connected, this can also change what they can see."),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/could be connected to this record automatically/)).toBeNull();
  });

  it("Keep as it is writes nothing", () => {
    render(<EngagementCard {...BASE} engagement="visitor" />);
    pick("regular");
    save();
    fireEvent.click(screen.getByRole("button", { name: "Keep as it is" }));
    expect(mockChange).not.toHaveBeenCalled();
  });

  it("uses an AlertDialog, never a native dialog (Rule 2)", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm").mockImplementation(() => true);
    render(<EngagementCard {...BASE} engagement="visitor" />);
    pick("regular");
    save();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    alert.mockRestore();
    confirm.mockRestore();
  });
});

describe("the nudge (a person on the roll who is still marked Visitor) sends expectedFrom visitor", () => {
  const ROLLED_VISITOR = { ...BASE, engagement: "visitor" as const, currentRoll: "other_participant" };

  it("shows the sentence and the button, and the select keeps Visitor as the current, disabled option", () => {
    render(<EngagementCard {...ROLLED_VISITOR} />);
    expect(screen.getByText("Wren Alder is still marked as a visitor. Mark as a regular attender?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as regular attender" })).toBeTruthy();
    const current = screen.getByRole("option", { name: "Visitor (current)" }) as HTMLOptionElement;
    expect(current.disabled).toBe(true);
  });

  it("writes at once (the roll already lists them, so no dialog) with expectedFrom visitor", async () => {
    mockChange.mockResolvedValue(ok("regular"));
    render(<EngagementCard {...ROLLED_VISITOR} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular attender" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(mockChange).toHaveBeenCalledWith("alder-creek", { personId: PERSON_ID, to: "regular", expectedFrom: "visitor" }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Wren Alder is now marked as a regular attender."));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("stale form (nudge): refusal style and a refresh", async () => {
    mockChange.mockResolvedValue({ ok: false, error: STALE });
    render(<EngagementCard {...ROLLED_VISITOR} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as regular attender" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("is not shown to someone off the roll, or to a rolled person who is already Regular", () => {
    const { rerender } = render(<EngagementCard {...BASE} engagement="visitor" />);
    expect(screen.queryByTestId("engagement-nudge")).toBeNull();
    rerender(<EngagementCard {...BASE} currentRoll="active" />);
    expect(screen.queryByTestId("engagement-nudge")).toBeNull();
  });
});
