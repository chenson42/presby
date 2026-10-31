// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockMove = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ movePostingAction: (...a: unknown[]) => mockMove(...a) }));
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { MovePostingButtons } from "./move-buttons";

afterEach(() => {
  cleanup();
  mockMove.mockReset();
  mockRefresh.mockReset();
  toastError.mockReset();
});

const props = { slug: "alder-creek", postingId: "id-1", title: "Custodian", isFirst: false, isLast: false };

describe("MovePostingButtons - T21", () => {
  it("is disabled before hydration (server render)", () => {
    const html = renderToString(<MovePostingButtons {...props} />);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it("is named by the title and calls the action with the id and direction", async () => {
    mockMove.mockResolvedValue({ ok: true, data: { moved: true } });
    render(<MovePostingButtons {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Custodian down" }));
    });
    expect(mockMove).toHaveBeenCalledWith("alder-creek", { id: "id-1", direction: "down" });
    expect(mockRefresh).toHaveBeenCalled();
    // The result is announced in a live region, not a toast.
    expect(screen.getByRole("status").textContent).toBe("Moved Custodian down.");
  });

  it("announces 'up' too, and says nothing when nothing moved", async () => {
    mockMove.mockResolvedValue({ ok: true, data: { moved: false } });
    render(<MovePostingButtons {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Custodian up" }));
    });
    expect(screen.getByRole("status").textContent).toBe("");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("a refusal is a toast with the returned text", async () => {
    mockMove.mockResolvedValue({ ok: false, error: "You don't have permission to manage job openings." });
    render(<MovePostingButtons {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Custodian up" }));
    });
    expect(toastError).toHaveBeenCalledWith("You don't have permission to manage job openings.");
  });

  it("the buttons are 44px targets", () => {
    render(<MovePostingButtons {...props} />);
    expect(screen.getByRole("button", { name: "Move Custodian up" }).className).toContain("size-11");
  });
});
