// @vitest-environment jsdom
/**
 * `DistrictCardControls` - Rename, Archive and Restore (Copy C2; tag CMP).
 * The rules (name shape, unique active name, the archive state machine, the
 * authority) are proven against Postgres in `parishes.test.ts`; this pins the
 * dialogs, their copy, and that each failure is the action's message verbatim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const renameAction = vi.hoisted(() => vi.fn());
const archiveAction = vi.hoisted(() => vi.fn());
const restoreAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  renameDistrictAction: (...args: unknown[]) => renameAction(...args),
  archiveDistrictAction: (...args: unknown[]) => archiveAction(...args),
  restoreDistrictAction: (...args: unknown[]) => restoreAction(...args),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DistrictCardControls } from "./district-card-controls";

beforeEach(() => {
  for (const mock of [renameAction, archiveAction, restoreAction, refresh, toastSuccess, toastError]) {
    mock.mockReset();
  }
});
afterEach(cleanup);

function renderControls(overrides: Partial<React.ComponentProps<typeof DistrictCardControls>> = {}) {
  return render(
    <DistrictCardControls
      slug="alder-creek"
      orgUnitId="u-north"
      name="North District"
      archived={false}
      householdCount={4}
      deaconName={null}
      {...overrides}
    />,
  );
}

describe("active district: Rename and Archive", () => {
  it("offers Rename and Archive (44px each) and no Restore", () => {
    renderControls();
    expect(screen.getByRole("button", { name: "Rename North District" }).className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "Archive North District" }).className).toContain("min-h-11");
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
  });

  it("Rename opens a dialog prefilled with the current name; Save name sends the new one and refreshes", async () => {
    renameAction.mockResolvedValue({ ok: true, data: { name: "Northside" } });
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename North District" }));
    });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Rename district")).toBeTruthy();
    const input = within(dialog).getByLabelText("District name") as HTMLInputElement;
    expect(input.value).toBe("North District");
    fireEvent.change(input, { target: { value: "Northside" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    });
    await waitFor(() => expect(renameAction).toHaveBeenCalled());
    expect(renameAction).toHaveBeenCalledWith("alder-creek", { orgUnitId: "u-north", name: "Northside" });
    expect(toastSuccess).toHaveBeenCalledWith("District renamed.");
    expect(refresh).toHaveBeenCalled();
  });

  it("Rename shows the server's refusal inline (a taken name) and keeps the dialog open", async () => {
    renameAction.mockResolvedValue({ ok: false, error: "A district with that name already exists." });
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename North District" }));
    });
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("District name"), { target: { value: "South District" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    });
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe("A district with that name already exists."),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("Rename refuses an empty name before the server is called", async () => {
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename North District" }));
    });
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("District name"), { target: { value: "   " } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    });
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe("Enter a name for the district."),
    );
    expect(renameAction).not.toHaveBeenCalled();
  });

  it("Archive confirms with the household count and, when a deacon term is open, who", async () => {
    renderControls({ deaconName: "Dee Deaconson" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive North District" }));
    });
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Archive North District?")).toBeTruthy();
    expect(dialog.textContent).toContain(
      "4 households are still in it. They stay there until they are moved to another district. No households can be moved into an archived district. You can restore it later.",
    );
    expect(dialog.textContent).toContain(
      "Dee Deaconson is still recorded as this district's Deacon. End that term in Officers if they have stepped down.",
    );
    expect(archiveAction).not.toHaveBeenCalled();
  });

  it("Archive with no open deacon term does not mention one", async () => {
    renderControls({ householdCount: 0 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive North District" }));
    });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("No households are in it. You can restore it later.");
    expect(dialog.textContent).not.toMatch(/Deacon\./);
  });

  it("Archive district calls the action, toasts `{name} archived.` and refreshes", async () => {
    archiveAction.mockResolvedValue({ ok: true, data: { name: "North District" } });
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive North District" }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive district" }));
    });
    expect(archiveAction).toHaveBeenCalledWith("alder-creek", { orgUnitId: "u-north" });
    expect(toastSuccess).toHaveBeenCalledWith("North District archived.");
    expect(refresh).toHaveBeenCalled();
  });

  it("an Archive refusal is the server's message, verbatim", async () => {
    archiveAction.mockResolvedValue({ ok: false, error: "You don't have permission to do that." });
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive North District" }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive district" }));
    });
    expect(toastError).toHaveBeenCalledWith("You don't have permission to do that.");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("archived district: Restore", () => {
  it("offers only Restore, which is one tap, then toasts `{name} restored.`", async () => {
    restoreAction.mockResolvedValue({ ok: true, data: { name: "East District" } });
    renderControls({ archived: true, name: "East District", orgUnitId: "u-east" });
    expect(screen.queryByRole("button", { name: /Rename|Archive/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore East District" }));
    });
    expect(restoreAction).toHaveBeenCalledWith("alder-creek", { orgUnitId: "u-east" });
    expect(toastSuccess).toHaveBeenCalledWith("East District restored.");
    expect(refresh).toHaveBeenCalled();
  });

  it("a restore into a taken name shows the collision copy", async () => {
    restoreAction.mockResolvedValue({
      ok: false,
      error: "Another district already uses that name. Rename that one first, or leave this one archived.",
    });
    renderControls({ archived: true, name: "East District", orgUnitId: "u-east" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore East District" }));
    });
    expect(toastError).toHaveBeenCalledWith(
      "Another district already uses that name. Rename that one first, or leave this one archived.",
    );
  });
});
