// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatWhen } from "./service-when";
import { StatusChip } from "./status-chip";

afterEach(cleanup);

describe("StatusChip - text plus an icon, never colour alone", () => {
  it.each([
    ["draft", null, false, "Not sent yet"],
    ["requested", null, false, "Waiting for an answer"],
    ["confirmed", null, false, "Confirmed"],
    ["declined", null, false, "Declined"],
    ["declined", "away", false, "Declined: Away"],
    ["declined", "other", false, "Declined: Other"],
    ["confirmed", null, true, "Guest"],
  ] as const)("%s / %s / guest=%s reads %s", (status, reason, guest, label) => {
    const { container } = render(<StatusChip status={status} declineReason={reason} isGuest={guest} />);
    expect(screen.getByTestId("status-chip").textContent).toBe(label);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("formatWhen", () => {
  it("prints wall-clock text as a label, with no time zone applied", () => {
    expect(formatWhen("2026-11-15T10:00")).toBe("Sunday, November 15 at 10:00 AM");
    expect(formatWhen("2026-11-15T00:05")).toBe("Sunday, November 15 at 12:05 AM");
  });
});
