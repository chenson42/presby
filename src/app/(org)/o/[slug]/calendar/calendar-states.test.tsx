// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CalendarDisabled, CalendarForbidden, CalendarLoadError } from "./calendar-states";

afterEach(cleanup);

describe("calendar states", () => {
  it("CalendarDisabled names the organization and carries an h1", () => {
    render(<CalendarDisabled name="Alder Creek Presbyterian Church" />);
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeTruthy();
    expect(
      screen.getByText("The calendar isn't turned on for Alder Creek Presbyterian Church yet."),
    ).toBeTruthy();
  });

  it("CalendarForbidden says the account lacks the calendar and points at the stated clerk", () => {
    render(<CalendarForbidden name="Alder Creek Presbyterian Church" />);
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeTruthy();
    expect(
      screen.getByText(
        /isn't available to your account at Alder Creek Presbyterian Church yet\. If you think it should be, ask your stated clerk or another administrator there\./,
      ),
    ).toBeTruthy();
  });

  it("CalendarLoadError offers a Try again link to the same month, types and view", () => {
    render(<CalendarLoadError retryHref="/o/alder-creek/calendar?month=2026-10&view=list" />);
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeTruthy();
    expect(screen.getByText(/couldn't load the calendar right now/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/o/alder-creek/calendar?month=2026-10&view=list",
    );
  });
});
