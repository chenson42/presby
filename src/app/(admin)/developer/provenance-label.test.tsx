// @vitest-environment jsdom
/** Each label is text plus an icon, never colour alone (C10). */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PROVENANCE, type ProvenanceKey } from "@/lib/developer-portal/provenance";
import { ProvenanceLabel } from "./provenance-label";

afterEach(cleanup);

describe("ProvenanceLabel", () => {
  it.each(Object.keys(PROVENANCE) as ProvenanceKey[])(
    "%s renders its label text and a hidden icon",
    (kind) => {
      const { container } = render(<ProvenanceLabel kind={kind} />);
      expect(container.textContent).toBe(PROVENANCE[kind].label);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
    },
  );

  it("uses the four approved labels and meanings", () => {
    expect(
      Object.fromEntries(
        Object.entries(PROVENANCE).map(([k, v]) => [k, [v.label, v.meaning]]),
      ),
    ).toEqual({
      generated: ["Generated", "Computed from the code and the database when you open the page."],
      tested: ["Tested list", "Written by hand, and a test fails when it falls out of step with the code."],
      hand: ["Written by hand", "Written by a person; nothing checks the wording automatically."],
      planned: ["Planned", "Not built yet."],
    });
  });
});
