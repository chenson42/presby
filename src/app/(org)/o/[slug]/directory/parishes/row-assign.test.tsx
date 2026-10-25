// @vitest-environment jsdom
/**
 * `RowAssign` - the per-household district picker (docs/work-log/2026-10-25-
 * parish-management.md, Phase 3 P3-1, F261; tag CMP).
 *
 * The property this file exists to pin: the native select NEVER commits on
 * selection. Arrow keys on a closed select fire `change` once per keypress on
 * Windows desktop browsers, which would write one move (and one audit row) per
 * keypress. A change event here must call no action; only the explicit button
 * does. Pre-hydration behaviour is the browser spec's job
 * (e2e/hydration/parishes-controls.spec.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const moveAction = vi.hoisted(() => vi.fn());
const assignAction = vi.hoisted(() => vi.fn());
vi.mock("./[orgUnitId]/actions", () => ({
  moveHouseholdAction: (...args: unknown[]) => moveAction(...args),
}));
vi.mock("./unassigned/actions", () => ({
  assignHouseholdAction: (...args: unknown[]) => assignAction(...args),
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { RowAssign } from "./row-assign";

const TARGETS = [
  { orgUnitId: "u-north", name: "North District" },
  { orgUnitId: "u-south", name: "South District" },
];

beforeEach(() => {
  moveAction.mockReset();
  assignAction.mockReset();
  refresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

function renderRow(mode: "move" | "assign", current: string | null = mode === "move" ? "u-east" : null) {
  return render(
    <RowAssign
      slug="alder-creek"
      mode={mode}
      householdId="h-1"
      householdName="The Smith Family"
      currentOrgUnitId={current}
      targets={TARGETS}
    />,
  );
}

function select(): HTMLSelectElement {
  return screen.getByLabelText(/^(Move|Assign) to/) as HTMLSelectElement;
}

describe("RowAssign - the controls", () => {
  it("move mode: label `Move to`, a placeholder, `Remove from district`, every target, and a Move button", () => {
    renderRow("move");
    const options = Array.from(select().options).map((o) => o.textContent);
    expect(options).toEqual([
      "Choose a district…",
      "Remove from district",
      "North District",
      "South District",
    ]);
    expect(screen.getByRole("button", { name: "Move The Smith Family" }).textContent).toBe("Move");
  });

  it("assign mode: label `Assign to`, no Remove option, an Assign button", () => {
    renderRow("assign");
    const options = Array.from(select().options).map((o) => o.textContent);
    expect(options).toEqual(["Choose a district…", "North District", "South District"]);
    expect(screen.getByRole("button", { name: "Assign The Smith Family" }).textContent).toBe("Assign");
  });

  it("is a full-width control with 44px targets (the 360px rules)", () => {
    renderRow("move");
    expect(select().className).toContain("w-full");
    expect(select().className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: /^Move/ }).className).toContain("min-h-11");
  });
});

describe("RowAssign - it never commits on selection (F261)", () => {
  it("a change event, however many times it fires, calls no action", () => {
    renderRow("move");
    for (const value of ["u-north", "u-south", "u-north", "u-south"]) {
      fireEvent.change(select(), { target: { value } });
    }
    expect(moveAction).not.toHaveBeenCalled();
    expect(assignAction).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("only the button writes, once, with the district the viewer saw as the expected value", async () => {
    moveAction.mockResolvedValue({
      ok: true,
      data: { changed: true, fromOrgUnitId: "u-east", toOrgUnitId: "u-north", fromName: "East", toName: "North District" },
    });
    renderRow("move");
    fireEvent.change(select(), { target: { value: "u-north" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Move/ }));
    });
    expect(moveAction).toHaveBeenCalledTimes(1);
    expect(moveAction).toHaveBeenCalledWith("alder-creek", {
      householdId: "h-1",
      expectedOrgUnitId: "u-east",
      targetOrgUnitId: "u-north",
    });
    expect(assignAction).not.toHaveBeenCalled();
  });
});

describe("RowAssign - the button", () => {
  it("with nothing chosen it says `Choose a district first.` and writes nothing", async () => {
    renderRow("assign");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Assign/ }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Choose a district first.");
    expect(assignAction).not.toHaveBeenCalled();
  });

  it("assign mode uses the assign action, with expected null for a first assignment", async () => {
    assignAction.mockResolvedValue({
      ok: true,
      data: { changed: true, fromOrgUnitId: null, toOrgUnitId: "u-south", fromName: null, toName: "South District" },
    });
    renderRow("assign");
    fireEvent.change(select(), { target: { value: "u-south" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Assign/ }));
    });
    expect(assignAction).toHaveBeenCalledWith("alder-creek", {
      householdId: "h-1",
      expectedOrgUnitId: null,
      targetOrgUnitId: "u-south",
    });
    expect(moveAction).not.toHaveBeenCalled();
  });

  it("`Remove from district` sends a null target (a clear is a write, not a delete)", async () => {
    moveAction.mockResolvedValue({
      ok: true,
      data: { changed: true, fromOrgUnitId: "u-east", toOrgUnitId: null, fromName: "East", toName: null },
    });
    renderRow("move");
    fireEvent.change(select(), { target: { value: "__none__" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Move/ }));
    });
    expect(moveAction).toHaveBeenCalledWith("alder-creek", {
      householdId: "h-1",
      expectedOrgUnitId: "u-east",
      targetOrgUnitId: null,
    });
    expect(toastSuccess.mock.calls[0]![0]).toBe("Removed from East.");
  });

  it("shows an in-flight state, disabling the select and the button, until the action settles", async () => {
    let finish!: (value: unknown) => void;
    assignAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderRow("assign");
    fireEvent.change(select(), { target: { value: "u-north" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Assign/ }));
    });
    const busy = screen.getByRole("button", { name: /^Assign/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toBe("Assigning…");
    expect(select().disabled).toBe(true);
    await act(async () => {
      finish({ ok: true, data: { changed: false, fromOrgUnitId: null, toOrgUnitId: "u-north", fromName: null, toName: "North District" } });
    });
    expect((screen.getByRole("button", { name: /^Assign/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("RowAssign - results", () => {
  it("a success toasts `Assigned to {district}.` for the Undo window, and refreshes the page", async () => {
    assignAction.mockResolvedValue({
      ok: true,
      data: { changed: true, fromOrgUnitId: null, toOrgUnitId: "u-north", fromName: null, toName: "North District" },
    });
    renderRow("assign");
    fireEvent.change(select(), { target: { value: "u-north" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Assign/ }));
    });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [message, options] = toastSuccess.mock.calls[0]!;
    expect(message).toBe("Assigned to North District.");
    expect(options.duration).toBe(10_000);
    expect(options.action.label).toBe("Undo");
    expect(refresh).toHaveBeenCalled();
  });

  it("Undo is the same call with expected and target swapped, flagged undo, then `Undone.`", async () => {
    moveAction.mockResolvedValueOnce({
      ok: true,
      data: { changed: true, fromOrgUnitId: "u-east", toOrgUnitId: "u-north", fromName: "East", toName: "North District" },
    });
    renderRow("move");
    fireEvent.change(select(), { target: { value: "u-north" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Move/ }));
    });
    moveAction.mockResolvedValueOnce({ ok: true, data: { changed: true } });
    const undo = toastSuccess.mock.calls[0]![1].action.onClick as () => Promise<void>;
    await act(async () => {
      await undo();
    });
    expect(moveAction).toHaveBeenLastCalledWith("alder-creek", {
      householdId: "h-1",
      expectedOrgUnitId: "u-north",
      targetOrgUnitId: "u-east",
      undo: true,
    });
    expect(toastSuccess).toHaveBeenLastCalledWith("Undone.");
  });

  it("a refused Undo shows the server's truthful message", async () => {
    assignAction.mockResolvedValueOnce({
      ok: true,
      data: { changed: true, fromOrgUnitId: null, toOrgUnitId: "u-north", fromName: null, toName: "North District" },
    });
    renderRow("assign");
    fireEvent.change(select(), { target: { value: "u-north" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Assign/ }));
    });
    assignAction.mockResolvedValueOnce({ ok: false, error: "Can't undo: this household has been moved since." });
    const undo = toastSuccess.mock.calls[0]![1].action.onClick as () => Promise<void>;
    await act(async () => {
      await undo();
    });
    expect(toastError).toHaveBeenCalledWith("Can't undo: this household has been moved since.");
  });

  it("a quiet no-op (changed false) shows no toast and no Undo", async () => {
    assignAction.mockResolvedValue({
      ok: true,
      data: { changed: false, fromOrgUnitId: null, toOrgUnitId: "u-north", fromName: null, toName: "North District" },
    });
    renderRow("assign");
    fireEvent.change(select(), { target: { value: "u-north" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Assign/ }));
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("a refusal stays on the row as an inline alert, and the list is refreshed", async () => {
    moveAction.mockResolvedValue({
      ok: false,
      error: "This household was just moved by someone else. We've refreshed the list.",
    });
    renderRow("move");
    fireEvent.change(select(), { target: { value: "u-north" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Move/ }));
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "This household was just moved by someone else. We've refreshed the list.",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("a thrown error is the `nothing was changed` line, not a stack", async () => {
    moveAction.mockRejectedValue(new Error("network down"));
    renderRow("move");
    fireEvent.change(select(), { target: { value: "u-north" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Move/ }));
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not move the household. Nothing was changed.",
    );
  });
});
