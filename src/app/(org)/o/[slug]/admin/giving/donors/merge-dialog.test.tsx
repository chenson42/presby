// @vitest-environment jsdom
/**
 * The donor merge dialog (docs/work-log/2026-10-15-online-giving.md, "Donor
 * merge with links"): an AlertDialog naming both donors and what survives, with
 * the keep-which choice made by search when no target is preset.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mergeDonorsAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ mergeDonorsAction: (...a: unknown[]) => mergeDonorsAction(...a) }));
const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("../gifts/new/donor-picker", () => ({
  DonorPicker: ({ value, onChange }: { value: { displayName: string } | null; onChange: (d: { id: string; displayName: string } | null) => void }) =>
    value ? <span data-testid="kept">{value.displayName}</span> : <button type="button" onClick={() => onChange({ id: "t1", displayName: "Josephine Marlowe" })}>pick keeper</button>,
}));

import { MergeDonorDialog } from "./merge-dialog";

const SOURCE = { id: "s1", displayName: "J. Marlowe" };

afterEach(() => {
  cleanup();
  for (const fn of [mergeDonorsAction, push, refresh, toastSuccess]) fn.mockReset();
});

describe("MergeDonorDialog", () => {
  it("with a preset target: one confirmation naming both donors; Merge sends source and target, then goes to the survivor", async () => {
    mergeDonorsAction.mockResolvedValue({ ok: true, data: { targetId: "t1" } });
    render(<MergeDonorDialog slug="alder-creek" source={SOURCE} target={{ id: "t1", displayName: "Josephine Marlowe" }} label="Merge into Josephine Marlowe" />);
    fireEvent.click(screen.getByRole("button", { name: "Merge into Josephine Marlowe" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Merge J. Marlowe into Josephine Marlowe?")).toBeTruthy();
    expect(dialog.textContent).toMatch(/Nothing is deleted, but a merge can.t be undone/);
    expect(screen.queryByTestId("kept")).toBeNull(); // no picker needed
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge donors" }));
    await waitFor(() => expect(mergeDonorsAction).toHaveBeenCalledWith("alder-creek", { sourceId: "s1", targetId: "t1" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/o/alder-creek/admin/giving/donors/t1"));
    expect(toastSuccess).toHaveBeenCalledWith("J. Marlowe merged into Josephine Marlowe.");
  });

  it("without a target: the merge button is disabled until a keeper is chosen", async () => {
    render(<MergeDonorDialog slug="s" source={SOURCE} label="Merge into another donor" />);
    fireEvent.click(screen.getByRole("button", { name: "Merge into another donor" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Merge J. Marlowe into another donor?")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Merge donors" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByText("pick keeper"));
    expect((within(dialog).getByRole("button", { name: "Merge donors" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(dialog).getByText("Merge J. Marlowe into Josephine Marlowe?")).toBeTruthy();
  });

  it("will not merge a donor into itself", async () => {
    render(<MergeDonorDialog slug="s" source={SOURCE} target={{ id: "s1", displayName: "J. Marlowe" }} label="Merge" />);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("alertdialog");
    expect((within(dialog).getByRole("button", { name: "Merge donors" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a refusal (e.g. link conflict) is shown inside the dialog, and nothing navigates", async () => {
    mergeDonorsAction.mockResolvedValue({ ok: false, error: "Both donors are linked to different members. Remove one link first, then merge." });
    render(<MergeDonorDialog slug="s" source={SOURCE} target={{ id: "t1", displayName: "Josephine Marlowe" }} label="Merge" />);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge donors" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/linked to different members/));
    expect(push).not.toHaveBeenCalled();
  });

  it("'Don't merge' calls nothing", async () => {
    render(<MergeDonorDialog slug="s" source={SOURCE} target={{ id: "t1", displayName: "T" }} label="Merge" />);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Don't merge" }));
    expect(mergeDonorsAction).not.toHaveBeenCalled();
  });
});
