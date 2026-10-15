// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EventTypesForbidden, EventTypesLoadError } from "./event-types-states";

afterEach(cleanup);

describe("event types states", () => {
  it("EventTypesForbidden names the organization and points at the stated clerk", () => {
    render(<EventTypesForbidden name="Alder Creek Presbyterian Church" />);
    expect(screen.getByRole("heading", { level: 1, name: "Event types" })).toBeTruthy();
    expect(
      screen.getByText(
        /You don't have permission to manage event types at Alder Creek Presbyterian Church\. If you think this is a mistake, ask your stated clerk or another administrator there\./,
      ),
    ).toBeTruthy();
  });

  it("EventTypesLoadError offers Try again back to the manager", () => {
    render(<EventTypesLoadError slug="alder-creek" />);
    expect(screen.getByText(/couldn't load event types right now/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/events/types",
    );
  });
});
