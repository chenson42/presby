// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EVENT_TYPE_ICONS } from "@/lib/events/type-palette";
import { EventTypeIcon } from "./event-type-icon";
import { EventTypeChip } from "./event-type-chip";
import { EventTypeSwatch } from "./event-type-swatch";

afterEach(cleanup);

describe("EventTypeIcon", () => {
  it("renders an aria-hidden svg for every key in the closed vocabulary", () => {
    for (const key of EVENT_TYPE_ICONS) {
      const { container, unmount } = render(<EventTypeIcon iconKey={key} />);
      const svg = container.querySelector("svg")!;
      expect(svg, key).toBeTruthy();
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("degrades an unknown, null or undefined key to the calendar icon instead of throwing", () => {
    const calendar = render(<EventTypeIcon iconKey="CalendarDays" />).container.innerHTML;
    cleanup();
    for (const bad of ["NotAnIcon", null, undefined, ""]) {
      const { container, unmount } = render(<EventTypeIcon iconKey={bad} />);
      expect(container.innerHTML).toBe(calendar);
      unmount();
    }
  });

  it("merges a caller's className", () => {
    const { container } = render(<EventTypeIcon iconKey="Church" className="size-6" />);
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("size-6");
  });
});

describe("EventTypeChip", () => {
  it("shows the icon and the visible name on the type's tint with an ink border", () => {
    const { container } = render(<EventTypeChip name="Worship" colorToken="teal" iconKey="Church" />);
    expect(screen.getByText("Worship")).toBeTruthy();
    const chip = container.firstElementChild!;
    expect(chip.querySelector("svg")).toBeTruthy();
    expect(chip.className).toContain("bg-category-teal");
    expect(chip.className).toContain("border-category-teal-foreground");
    expect(chip.className).toContain("text-sm");
    expect(chip.className).not.toContain("text-xs");
  });

  it("falls back to neutral for an unknown colour", () => {
    const { container } = render(<EventTypeChip name="X" colorToken="chartreuse" iconKey="Church" />);
    expect(container.firstElementChild!.className).toContain("bg-category-neutral");
  });
});

describe("EventTypeSwatch", () => {
  it("is a decorative square filled with the colour's ink", () => {
    const { container } = render(<EventTypeSwatch colorToken="rose" />);
    const swatch = container.firstElementChild!;
    expect(swatch.getAttribute("aria-hidden")).toBe("true");
    expect(swatch.className).toContain("bg-category-rose-foreground");
    expect(swatch.className).toContain("size-4");
  });
});
