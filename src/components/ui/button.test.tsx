// @vitest-environment jsdom
/**
 * Pins the button-modernization depth treatment and honest disabled state
 * (docs/work-log/2026-08-27-button-modernization.md Phase 3(d), commit 2):
 * `default`/`outline` gain `shadow-xs`/`hover:shadow-sm`, and the shared
 * `base` cva string trades `disabled:opacity-50` (a standing D5 violation —
 * a washed-out brand color reads as "off" only to a sighted user who already
 * knows what the enabled state looked like) for `disabled:bg-muted
 * disabled:text-muted-foreground`, an existing platform-fixed LEGAL_PAIRS
 * pair (7:1). The `base`-level change reaches every variant uniformly, not
 * just `default` — asserted here for `outline` too, per Phase 3(d)'s own
 * scope note.
 *
 * Also pins the control-legibility pass
 * (docs/work-log/2026-08-27-control-legibility.md): the shared `base` cva
 * string carries `text-base` (16px) and `font-semibold` (600), not the
 * upstream `text-sm`/`font-medium` — an operator-driven legibility decision
 * that must reach every variant, since it lands at `base`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "./button";

afterEach(cleanup);

describe("Button — depth treatment", () => {
  it("gives the default variant a rest shadow that raises on hover", () => {
    render(<Button variant="default">Search</Button>);
    const className = screen.getByRole("button", { name: "Search" }).className;
    expect(className).toContain("shadow-xs");
    expect(className).toContain("hover:shadow-sm");
  });

  it("gives the outline variant a rest shadow that raises on hover", () => {
    render(<Button variant="outline">Cancel</Button>);
    const className = screen.getByRole("button", { name: "Cancel" }).className;
    expect(className).toContain("shadow-xs");
    expect(className).toContain("hover:shadow-sm");
  });
});

describe("Button — disabled state reads as disabled, not a washed-out brand color", () => {
  it("default variant: disabled classes present, disabled:opacity-50 absent", () => {
    render(
      <Button variant="default" disabled>
        Save
      </Button>,
    );
    const className = screen.getByRole("button", { name: "Save" }).className;
    expect(className).toContain("disabled:bg-muted");
    expect(className).toContain("disabled:text-muted-foreground");
    expect(className).not.toContain("disabled:opacity-50");
  });

  it("outline variant: disabled classes present, disabled:opacity-50 absent", () => {
    render(
      <Button variant="outline" disabled>
        Cancel
      </Button>,
    );
    const className = screen.getByRole("button", { name: "Cancel" }).className;
    expect(className).toContain("disabled:bg-muted");
    expect(className).toContain("disabled:text-muted-foreground");
    expect(className).not.toContain("disabled:opacity-50");
  });

  it("no variant's className string carries opacity-50 anywhere (base is the only source)", () => {
    const variants = [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
      "tile",
    ] as const;

    for (const variant of variants) {
      const { unmount } = render(
        <Button variant={variant} disabled>
          Label
        </Button>,
      );
      const className = screen.getByRole("button", { name: "Label" }).className;
      expect(className).not.toContain("opacity-50");
      unmount();
    }
  });
});

describe("Button — control legibility (16px, semibold)", () => {
  it("every variant carries text-base and font-semibold, never text-sm/font-medium", () => {
    const variants = [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
      "tile",
    ] as const;

    for (const variant of variants) {
      const { unmount } = render(<Button variant={variant}>Search</Button>);
      const className = screen.getByRole("button", { name: "Search" }).className;
      expect(className).toContain("text-base");
      expect(className).toContain("font-semibold");
      expect(className).not.toContain("text-sm");
      expect(className).not.toContain("font-medium");
      unmount();
    }
  });

  it("every size carries text-base/font-semibold too — no size variant overrides the base text size", () => {
    const sizes = ["default", "sm", "lg", "icon"] as const;

    for (const size of sizes) {
      const { unmount } = render(
        <Button size={size} aria-label="Search">
          {size === "icon" ? null : "Search"}
        </Button>,
      );
      const className = screen.getByRole("button", { name: "Search" }).className;
      expect(className).toContain("text-base");
      expect(className).toContain("font-semibold");
      unmount();
    }
  });
});
