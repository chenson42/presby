// @vitest-environment jsdom
/** "Dates I can't serve" form (Copy G6): inert before hydration, the payload, the three outcomes, the server's own refusals. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const addBlockout = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({ addBlockoutAction: (...a: unknown[]) => addBlockout(...a) }));

import { MEMBER_COPY } from "@/lib/worship/copy";
import { BlockoutForm } from "./blockout-form";

beforeEach(() => {
  for (const m of [refresh, addBlockout, toast.success, toast.error]) m.mockReset();
});
afterEach(cleanup);

function fill(from: string, to: string) {
  fireEvent.change(screen.getByLabelText(MEMBER_COPY.blockouts.fromLabel), { target: { value: from } });
  fireEvent.change(screen.getByLabelText(MEMBER_COPY.blockouts.toLabel), { target: { value: to } });
}

describe("BlockoutForm", () => {
  it("renders inside the HydrationGate fieldset, with real labels", () => {
    const { container } = render(<BlockoutForm slug="alder" />);
    expect(container.querySelector("fieldset[data-slot='hydration-gate']")).toBeTruthy();
    for (const label of [MEMBER_COPY.blockouts.fromLabel, MEMBER_COPY.blockouts.toLabel, MEMBER_COPY.blockouts.reasonLabel]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("saves the range and a closed-list reason, toasts 'Dates saved.'", async () => {
    addBlockout.mockResolvedValue({ ok: true, data: { blockoutId: "b", merged: false, conflicts: [] } });
    render(<BlockoutForm slug="alder" />);
    fill("2027-01-03", "2027-01-17");
    fireEvent.change(screen.getByLabelText(MEMBER_COPY.blockouts.reasonLabel), { target: { value: "away" } });
    fireEvent.click(screen.getByRole("button", { name: MEMBER_COPY.blockouts.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(MEMBER_COPY.blockouts.toastSaved));
    expect(addBlockout).toHaveBeenCalledWith("alder", { startsOn: "2027-01-03", endsOn: "2027-01-17", reason: "away" });
    expect(refresh).toHaveBeenCalled();
  });

  it("says when the range was joined with dates already saved", async () => {
    addBlockout.mockResolvedValue({ ok: true, data: { blockoutId: "b", merged: true, conflicts: [] } });
    render(<BlockoutForm slug="alder" />);
    fill("2027-01-03", "2027-01-17");
    fireEvent.click(screen.getByRole("button", { name: MEMBER_COPY.blockouts.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(MEMBER_COPY.blockouts.toastMerged));
  });

  it("a range over a confirmed date still saves and names the date", async () => {
    addBlockout.mockResolvedValue({
      ok: true,
      data: {
        blockoutId: "b",
        merged: false,
        conflicts: [{ assignmentId: "a", eventId: "e", startsAt: "2027-01-10T10:00", positionName: "Keys", teamName: "Band" }],
      },
    });
    render(<BlockoutForm slug="alder" />);
    fill("2027-01-03", "2027-01-17");
    fireEvent.click(screen.getByRole("button", { name: MEMBER_COPY.blockouts.submit }));
    const note = await screen.findByTestId("blockout-conflicts");
    expect(note.textContent).toBe(MEMBER_COPY.blockouts.conflict("Sunday, January 10"));
    expect(toast.success).toHaveBeenCalledWith(MEMBER_COPY.blockouts.toastSaved);
  });

  it("shows the server's refusal inline (announced) and as a toast", async () => {
    addBlockout.mockResolvedValue({ ok: false, error: MEMBER_COPY.blockouts.endBeforeStart });
    render(<BlockoutForm slug="alder" />);
    fill("2027-01-17", "2027-01-03");
    fireEvent.click(screen.getByRole("button", { name: MEMBER_COPY.blockouts.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(MEMBER_COPY.blockouts.endBeforeStart));
    expect(toast.error).toHaveBeenCalledWith(MEMBER_COPY.blockouts.endBeforeStart);
  });
});
