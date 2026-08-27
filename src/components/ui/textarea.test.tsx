// @vitest-environment jsdom
/**
 * Pins the control-legibility pass
 * (docs/work-log/2026-08-27-control-legibility.md): `<Textarea>` reads at
 * 16px (`text-base`) on every breakpoint — the upstream `md:text-sm`
 * downshift (14px from `md:` up) is gone, per the operator's mockup review.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Textarea } from "./textarea";

afterEach(cleanup);

describe("Textarea — control legibility (16px everywhere)", () => {
  it("carries text-base and no md:text-sm downshift", () => {
    render(<Textarea aria-label="Notes" />);
    const className = screen.getByLabelText("Notes").className;
    expect(className).toContain("text-base");
    expect(className).not.toContain("md:text-sm");
  });
});
