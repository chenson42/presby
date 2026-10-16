// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RETURN_COPY } from "@/lib/giving/giving-copy";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { POLL_INTERVAL_MS, POLL_LIMIT, ReturnPoller } from "./return-poller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.useRealTimers();
});

describe("ReturnPoller", () => {
  it("asks the server to render again every 5 seconds, at most 6 times, then says it is still confirming", () => {
    expect(POLL_LIMIT).toBe(6);
    expect(POLL_INTERVAL_MS).toBe(5000);
    render(<ReturnPoller />);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByTestId("return-still-confirming")).toBeNull();

    act(() => vi.advanceTimersByTime(5000));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(25_000));
    expect(refresh).toHaveBeenCalledTimes(6);
    expect(screen.getByTestId("return-still-confirming").textContent).toBe(RETURN_COPY.stillConfirming);

    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(6);
  });

  it("stops the moment it is unmounted (the server replaced the confirming panel)", () => {
    const { unmount } = render(<ReturnPoller />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
