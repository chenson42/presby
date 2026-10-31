// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const search = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ searchBeneficiariesAction: (...a: unknown[]) => search(...a) }));

import { COPY } from "@/lib/reimbursement/copy";
import { BeneficiaryPicker, type PickedBeneficiary } from "./beneficiary-picker";

const MARISOL = { personId: "p-1", displayName: "Marisol Quillfeather" };

beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(value: PickedBeneficiary | null = null) {
  const onChange = vi.fn();
  render(<BeneficiaryPicker slug="alder" id="b" value={value} onChange={onChange} />);
  return { onChange, box: () => screen.getByRole("searchbox") as HTMLInputElement };
}
const type = async (el: HTMLElement, text: string) => {
  fireEvent.change(el, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
};

describe("BeneficiaryPicker (amendment T3)", () => {
  it("under two characters: nothing shown, no request, never 'No match.'", async () => {
    const { box } = mount();
    await type(box(), "Q");
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByText(COPY.form.beneficiaryNoMatch)).toBeNull();
  });

  it("a search that ran with no one back says 'No match.' in a status", async () => {
    search.mockResolvedValue({ ok: true, data: { candidates: [] } });
    const { box } = mount();
    await type(box(), "Zzz");
    expect(search).toHaveBeenCalledWith("alder", { query: "Zzz" });
    expect(screen.getByRole("status").textContent).toBe("No match.");
  });

  it("people back: the list, a hidden polite count, and a pick reports the id and name", async () => {
    search.mockResolvedValue({ ok: true, data: { candidates: [MARISOL] } });
    const { box, onChange } = mount();
    await type(box(), "Quill");
    expect(screen.getByText("1 person found.").className).toContain("sr-only");
    fireEvent.click(screen.getByRole("button", { name: MARISOL.displayName }));
    expect(onChange).toHaveBeenCalledWith({ personId: "p-1", name: MARISOL.displayName });
  });

  it("says '{n} people found.' for several", async () => {
    search.mockResolvedValue({ ok: true, data: { candidates: [MARISOL, { personId: "p-2", displayName: "Marlon Quill" }] } });
    const { box } = mount();
    await type(box(), "Quill");
    expect(screen.getByText("2 people found.")).toBeTruthy();
  });

  it("a gate refusal shows the action's own text; a thrown call shows the search-failed sentence", async () => {
    search.mockResolvedValueOnce({ ok: false, error: COPY.gate.notPermitted });
    const { box } = mount();
    await type(box(), "Quill");
    expect(screen.getByRole("alert").textContent).toBe(COPY.gate.notPermitted);
    search.mockRejectedValueOnce(new Error("offline"));
    await type(box(), "Quills");
    expect(screen.getByRole("alert").textContent).toBe(COPY.form.searchFailed);
  });

  it("an older reply that lands after a newer one is dropped", async () => {
    let first!: (v: unknown) => void;
    search.mockReturnValueOnce(new Promise((r) => (first = r)));
    search.mockResolvedValueOnce({ ok: true, data: { candidates: [{ personId: "p-9", displayName: "Newer Person" }] } });
    const { box } = mount();
    await type(box(), "Old");
    await type(box(), "Newer");
    await act(async () => first({ ok: true, data: { candidates: [{ personId: "p-0", displayName: "Older Person" }] } }));
    expect(screen.queryByText("Older Person")).toBeNull();
    expect(screen.getByText("Newer Person")).toBeTruthy();
  });

  it("Enter in the box is swallowed so it can never reach the form", () => {
    const { box } = mount();
    const proceeded = fireEvent.keyDown(box(), { key: "Enter" });
    expect(proceeded).toBe(false);
  });

  it("once chosen the name replaces the box, with a Change button named for what it changes", () => {
    const { onChange } = mount({ personId: "p-1", name: MARISOL.displayName });
    expect((screen.getByTestId("beneficiary-chosen") as HTMLInputElement).value).toBe(MARISOL.displayName);
    const change = screen.getByRole("button", { name: COPY.form.changeBeneficiaryLabel });
    expect(change.textContent).toBe(COPY.form.changeBeneficiary);
    fireEvent.click(change);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
