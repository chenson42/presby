// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventNotFound from "./not-found";

/**
 * Phase 6 N1 regression (docs/work-log/2026-10-14-member-calendar.md): a
 * missing, foreign, non-UUID or cancelled event id must land on copy about
 * the EVENT, never on `[slug]/not-found.tsx`'s "We couldn't find that
 * organization". The four miss cases share one `notFound()` call in the
 * page, so one boundary covers them; the e2e spec asserts the four bodies
 * are byte-identical.
 */
describe("calendar/[eventId]/not-found", () => {
  afterEach(cleanup);

  it("talks about the event, not the organization, and offers a safe way back", () => {
    render(<EventNotFound />);
    expect(
      screen.getByRole("heading", { level: 1, name: "We couldn't find that event" }),
    ).toBeTruthy();
    expect(screen.getByText(/cancelled or removed/i)).toBeTruthy();
    expect(screen.queryByText(/find that organization/i)).toBeNull();
    const link = screen.getByRole("link", { name: "Back to your organizations" });
    expect(link.getAttribute("href")).toBe("/home");
    expect(link.className).toMatch(/min-h-11/);
  });

  it("uses no text-xs on a member-facing page", () => {
    const { container } = render(<EventNotFound />);
    expect(container.innerHTML).not.toMatch(/text-xs/);
  });
});
