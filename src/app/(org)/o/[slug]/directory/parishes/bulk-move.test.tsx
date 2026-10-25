// @vitest-environment jsdom
/**
 * `BulkMove` - "Move all N households to..." for an archived district (Copy C5;
 * tag CMP). The server enforces every rule (archived source, active target, the
 * cap, the count); this pins the dialogs, the copy, and that the request carries
 * no household ids.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const bulkAction = vi.hoisted(() => vi.fn());
vi.mock("./[orgUnitId]/actions", () => ({
  bulkMoveAction: (...args: unknown[]) => bulkAction(...args),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { BulkMove } from "./bulk-move";

const TARGETS = [
  { orgUnitId: "u-north", name: "North District", deaconName: "Dee Deaconson" },
  { orgUnitId: "u-south", name: "South District", deaconName: null },
];
const SOURCE = { orgUnitId: "u-east", name: "East District" };

beforeEach(() => {
  bulkAction.mockReset();
  refresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

function renderBulk(count = 3, targets = TARGETS) {
  return render(<BulkMove slug="alder-creek" source={SOURCE} count={count} targets={targets} />);
}

async function openPicker() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Move all/ }));
  });
}

describe("BulkMove - the trigger", () => {
  it("reads `Move all N households to…` and is a full-width 44px control", () => {
    renderBulk(3);
    const trigger = screen.getByRole("button", { name: "Move all 3 households to…" });
    expect(trigger.className).toContain("min-h-11");
    expect(trigger.className).toContain("w-full");
  });

  it("over 100 households there is NO picker, only the cap message", () => {
    renderBulk(101);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("bulk-over-cap").textContent).toBe(
      "This district has more than 100 households, so they can't be moved all at once.",
    );
  });

  it("exactly 100 still offers the picker", () => {
    renderBulk(100);
    expect(screen.getByRole("button", { name: "Move all 100 households to…" })).toBeTruthy();
  });

  it("renders nothing for an empty district", () => {
    const { container } = renderBulk(0);
    expect(container.textContent).toBe("");
  });

  it("is disabled when there is no active district to move to", () => {
    renderBulk(3, []);
    expect((screen.getByRole("button", { name: /^Move all/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("BulkMove - step one, the picker", () => {
  it("names the source, offers the active districts, and Continue stays disabled until one is chosen", async () => {
    renderBulk(3);
    await openPicker();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Move 3 households")).toBeTruthy();
    expect(within(dialog).getByText("Choose where East District's households should go.")).toBeTruthy();
    const select = within(dialog).getByLabelText("Move to") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Choose a district…",
      "North District",
      "South District",
    ]);
    const next = within(dialog).getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "u-north" } });
    expect(next.disabled).toBe(false);
    expect(bulkAction).not.toHaveBeenCalled();
  });

  it("Cancel closes without writing", async () => {
    renderBulk(3);
    await openPicker();
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bulkAction).not.toHaveBeenCalled();
  });
});

async function pickAndContinue(value: string) {
  await openPicker();
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Move to"), { target: { value } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  });
}

describe("BulkMove - step two, the confirmation", () => {
  it("names the destination's deacon as `recorded`, says households can't move back, and that there is no bulk undo", async () => {
    renderBulk(3);
    await pickAndContinue("u-north");
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Move 3 households to North District?")).toBeTruthy();
    expect(dialog.textContent).toContain(
      "All 3 households in East District will move to North District. Dee Deaconson is recorded as North District's Deacon.",
    );
    expect(dialog.textContent).toContain(
      "East District is archived, so households can't be moved back into it. This can't be undone in one step; households can be moved again one at a time.",
    );
    expect(within(dialog).getByRole("button", { name: "Move 3 households" })).toBeTruthy();
  });

  it("says plainly when the destination has no deacon yet", async () => {
    renderBulk(2);
    await pickAndContinue("u-south");
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "No deacon is recorded for South District yet.",
    );
  });

  it("Confirm sends the source, the target and the count - and NO household ids", async () => {
    bulkAction.mockResolvedValue({ ok: true, data: { moved: 3, skipped: 0, toName: "North District" } });
    renderBulk(3);
    await pickAndContinue("u-north");
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move 3 households" }));
    });
    expect(bulkAction).toHaveBeenCalledTimes(1);
    expect(bulkAction).toHaveBeenCalledWith("alder-creek", {
      sourceOrgUnitId: "u-east",
      targetOrgUnitId: "u-north",
      expectedCount: 3,
    });
    expect(Object.keys(bulkAction.mock.calls[0]![1]).sort()).toEqual([
      "expectedCount",
      "sourceOrgUnitId",
      "targetOrgUnitId",
    ]);
    expect(toastSuccess).toHaveBeenCalledWith("Moved 3 households to North District.");
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("reports the skipped count, counts only", async () => {
    bulkAction.mockResolvedValue({ ok: true, data: { moved: 2, skipped: 1, toName: "North District" } });
    renderBulk(3);
    await pickAndContinue("u-north");
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Move 3/ }));
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Moved 2 households to North District. 1 had already been moved by someone else and were left alone.",
    );
  });

  it("a refusal is the server's message, verbatim, the dialog closes and the page is refreshed", async () => {
    bulkAction.mockResolvedValue({
      ok: false,
      error:
        "The households in this district changed while you were looking. We've refreshed the page. Check the count and try again.",
    });
    renderBulk(3);
    await pickAndContinue("u-north");
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Move 3/ }));
    });
    expect(toastError).toHaveBeenCalledWith(
      "The households in this district changed while you were looking. We've refreshed the page. Check the count and try again.",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a thrown error is the `nothing was changed` line", async () => {
    bulkAction.mockRejectedValue(new Error("network down"));
    renderBulk(3);
    await pickAndContinue("u-north");
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Move 3/ }));
    });
    expect(toastError).toHaveBeenCalledWith("Could not move the households. Nothing was changed.");
  });

  it("Cancel on the confirmation writes nothing", async () => {
    renderBulk(3);
    await pickAndContinue("u-north");
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    });
    expect(bulkAction).not.toHaveBeenCalled();
  });
});
