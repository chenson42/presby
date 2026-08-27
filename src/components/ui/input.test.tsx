// @vitest-environment jsdom
/**
 * Pins the control-legibility pass
 * (docs/work-log/2026-08-27-control-legibility.md): `<Input>` reads at 16px
 * (`text-base`) on every breakpoint — the upstream `md:text-sm` downshift
 * (14px from `md:` up) is gone, per the operator's mockup review.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Input } from "./input";

afterEach(cleanup);

describe("Input — control legibility (16px everywhere)", () => {
  it("carries text-base and no md:text-sm downshift", () => {
    render(<Input aria-label="Search" />);
    const className = screen.getByLabelText("Search").className;
    expect(className).toContain("text-base");
    expect(className).not.toContain("md:text-sm");
  });
});
