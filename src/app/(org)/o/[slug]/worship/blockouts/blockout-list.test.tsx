// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const endBlockout = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({ endBlockoutAction: (...a: unknown[]) => endBlockout(...a) }));

import { MEMBER_COPY } from "@/lib/worship/copy";
import { BlockoutList } from "./blockout-list";

beforeEach(() => {
  for (const m of [refresh, endBlockout, toast.success, toast.error]) m.mockReset();
});
afterEach(cleanup);

describe("BlockoutList", () => {
  it("an empty list is an empty state, not a blank", () => {
    render(<BlockoutList slug="alder" items={[]} />);
    expect(screen.getByText(MEMBER_COPY.blockouts.empty)).toBeTruthy();
  });

  it("each range reads 'from to to, Reason' and Remove ends exactly that one", async () => {
    endBlockout.mockResolvedValue({ ok: true, data: { changed: true } });
    render(<BlockoutList slug="alder" items={[{ id: "b1", startsOn: "2027-01-03", endsOn: "2027-01-17", reason: "away" }]} />);
    expect(screen.getByTestId("blockout-list").textContent).toContain("Sunday, January 3, 2027 to Sunday, January 17, 2027, Away");
    fireEvent.click(screen.getByRole("button", { name: MEMBER_COPY.blockouts.remove }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(MEMBER_COPY.blockouts.toastRemoved));
    expect(endBlockout).toHaveBeenCalledWith("alder", { blockoutId: "b1" });
  });
});
