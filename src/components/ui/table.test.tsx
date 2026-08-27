// @vitest-environment jsdom
/**
 * Tests for the `Table` primitive's scroll-cue divergence from the shadcn
 * registry (docs/work-log/2026-08-26-portal-ux-fixes.md, Wave 1B, M1) — the
 * right-edge fade that appears only when the table's content actually
 * overflows `table-container`. jsdom doesn't lay out or scroll, so this
 * suite pins the CSS-only mechanism itself (the two-layer
 * local-vs-scroll-attachment background) rather than trying to assert pixel
 * visibility — the mechanism IS the fix; a real-overflow visual check is a
 * live-browser verification step, not a unit test's job.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Table, TableBody, TableCell, TableRow } from "./table";

afterEach(cleanup);

describe("Table — scroll-cue wrapper", () => {
  it("renders the table-container wrapper with the two-layer scroll-fade background", () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>One</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const wrapper = container.querySelector('[data-slot="table-container"]') as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.style.backgroundAttachment).toBe("local, scroll");
    // The local layer resolves against the theme's background token, not a
    // hardcoded color — so it tracks a per-org `--background` override.
    expect(wrapper.style.backgroundImage).toContain("var(--background)");
    // jsdom's CSSOM normalizes the shorthand `right` keyword to `right center`
    expect(wrapper.style.backgroundPosition).toBe("right center, right center");
  });

  it("keeps the wrapper's overflow-x-auto scroll behavior alongside the fade", () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>One</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const wrapper = container.querySelector('[data-slot="table-container"]');
    expect(wrapper?.className).toContain("overflow-x-auto");
  });
});
