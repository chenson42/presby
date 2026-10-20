// @vitest-environment jsdom
/**
 * The donor picker (docs/work-log/2026-10-15-online-giving.md, Flow 8 / G24):
 * a search-then-pick list. Pins: nothing is queried before two letters, results
 * are names with a has-email boolean (never an address), skeletons while
 * loading, a failure says so rather than reading as "no such donor", a newer
 * keystroke supersedes an older response, and a pick shows a chip with Change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const searchDonorsAction = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({ searchDonorsAction: (...a: unknown[]) => searchDonorsAction(...a) }));

import { DonorPicker } from "./donor-picker";

const ROW = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, displayName: name, kind: "identified", hasEmail: true, ...over });

function setup(value: { id: string; displayName: string } | null = null) {
  const onChange = vi.fn();
  render(<DonorPicker slug="alder-creek" inputId="picker" value={value} onChange={onChange} />);
  return onChange;
}
const type = (text: string) => fireEvent.change(screen.getByRole("searchbox"), { target: { value: text } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  searchDonorsAction.mockReset();
});

describe("DonorPicker", () => {
  it("asks for two letters and queries nothing before then", async () => {
    setup();
    expect(screen.getByText(/at least two letters/i)).toBeTruthy();
    type("j");
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(searchDonorsAction).not.toHaveBeenCalled();
  });

  it("debounces: one query for a burst of typing, with the slug and the trimmed text", async () => {
    searchDonorsAction.mockResolvedValue({ ok: true, data: { donors: [ROW("d1", "Josephine Marlowe")] } });
    setup();
    type("jo");
    type("jos");
    type(" jose ");
    await act(async () => void vi.advanceTimersByTime(350));
    expect(searchDonorsAction).toHaveBeenCalledTimes(1);
    expect(searchDonorsAction).toHaveBeenCalledWith("alder-creek", "jose");
  });

  it("lists matches as buttons with a has-email note, never an address", async () => {
    searchDonorsAction.mockResolvedValue({ ok: true, data: { donors: [ROW("d1", "Josephine Marlowe"), ROW("d2", "Joseph Quill", { hasEmail: false }), ROW("d3", "Unidentified (plate offering)", { kind: "unidentified", hasEmail: false })] } });
    setup();
    type("jo");
    await act(async () => void vi.advanceTimersByTime(350));
    await vi.waitFor(() => expect(screen.getByRole("list", { name: "Matching donors" })).toBeTruthy());
    expect(screen.getByRole("button", { name: /Josephine Marlowe/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Joseph Quill\s*no email on file/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /plate offering/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it("picking reports the donor to the parent", async () => {
    searchDonorsAction.mockResolvedValue({ ok: true, data: { donors: [ROW("d1", "Josephine Marlowe")] } });
    const onChange = setup();
    type("jo");
    await act(async () => void vi.advanceTimersByTime(350));
    await vi.waitFor(() => screen.getByRole("button", { name: /Josephine Marlowe/ }));
    fireEvent.click(screen.getByRole("button", { name: /Josephine Marlowe/ }));
    expect(onChange).toHaveBeenCalledWith({ id: "d1", displayName: "Josephine Marlowe" });
  });

  it("no match says so and where to go next", async () => {
    searchDonorsAction.mockResolvedValue({ ok: true, data: { donors: [] } });
    setup();
    type("zz");
    await act(async () => void vi.advanceTimersByTime(350));
    await vi.waitFor(() => expect(screen.getByText(/No one with that name is in your records yet/)).toBeTruthy());
    expect(screen.getByText(/Choose “A new donor” above/)).toBeTruthy();
  });

  it("a failed lookup is an alert with the server's message - never an empty 'no match'", async () => {
    searchDonorsAction.mockResolvedValue({ ok: false, error: "We couldn't check your access just now. Try again in a moment." });
    setup();
    type("jo");
    await act(async () => void vi.advanceTimersByTime(350));
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/couldn't check your access/));
    expect(screen.queryByText(/No one with that name/)).toBeNull();
  });

  it("shows skeleton rows while the lookup is in flight", async () => {
    let resolve!: (v: unknown) => void;
    searchDonorsAction.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = render(<DonorPicker slug="s" inputId="p" value={null} onChange={() => {}} />);
    fireEvent.change(container.querySelector("input")!, { target: { value: "jo" } });
    await act(async () => void vi.advanceTimersByTime(350));
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    await act(async () => resolve({ ok: true, data: { donors: [] } }));
  });

  it("a response to an OLDER keystroke never overwrites a newer one", async () => {
    let resolveFirst!: (v: unknown) => void;
    searchDonorsAction.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    searchDonorsAction.mockResolvedValueOnce({ ok: true, data: { donors: [ROW("d2", "Newer Result")] } });
    setup();
    type("ol");
    await act(async () => void vi.advanceTimersByTime(350));
    type("new");
    await act(async () => void vi.advanceTimersByTime(350));
    await vi.waitFor(() => screen.getByRole("button", { name: /Newer Result/ }));
    await act(async () => resolveFirst({ ok: true, data: { donors: [ROW("d1", "Stale Result")] } }));
    expect(screen.queryByRole("button", { name: /Stale Result/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Newer Result/ })).toBeTruthy();
  });

  it("with a donor chosen: a chip with the name and a 44px Change button that clears it", () => {
    const onChange = setup({ id: "d1", displayName: "Josephine Marlowe" });
    expect(screen.getByTestId("chosen-donor").textContent).toBe("Josephine Marlowe");
    const change = screen.getByRole("button", { name: /Change/ });
    expect(change.className).toContain("min-h-11");
    fireEvent.click(change);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
