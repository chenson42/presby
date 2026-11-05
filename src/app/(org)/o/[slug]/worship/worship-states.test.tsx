// @vitest-environment jsdom
/** The honest non-data states (Copy G2): each says the Copy sentence, at 200, never a 404. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GATE_COPY } from "@/lib/worship/copy";
import { RequestClosed, WorshipForbidden, WorshipLoadError, WorshipNotApplicable, WorshipOff } from "./worship-states";

afterEach(cleanup);

describe("worship states", () => {
  it("off, for someone who can use Features: the sentence and the link under Features", () => {
    render(<WorshipOff name="Alder Creek" slug="alder-creek" canManageFeatures />);
    expect(screen.getByRole("heading", { level: 1, name: "Worship" })).toBeTruthy();
    expect(screen.getByTestId("worship-off").textContent).toContain("Worship isn't turned on for Alder Creek yet.");
    const link = screen.getByRole("link", { name: GATE_COPY.offLink });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/admin/features");
  });

  it("off, for anyone else: who to ask, and no link", () => {
    render(<WorshipOff name="Alder Creek" slug="alder-creek" canManageFeatures={false} />);
    expect(screen.getByTestId("worship-off").textContent).toContain("Ask someone who manages Alder Creek's features to turn it on.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("not applicable to a presbytery or synod", () => {
    render(<WorshipNotApplicable />);
    expect(screen.getByTestId("worship-not-applicable").textContent).toContain(GATE_COPY.notApplicable);
  });

  it("forbidden names the organization and who to ask", () => {
    render(<WorshipForbidden name="Alder Creek" heading="Plan worship" />);
    expect(screen.getByRole("heading", { level: 1, name: "Plan worship" })).toBeTruthy();
    expect(screen.getByTestId("worship-forbidden").textContent).toContain(GATE_COPY.forbidden("Alder Creek"));
  });

  it("a load error is announced and offers a 44px retry, never an empty list", () => {
    render(<WorshipLoadError href="/o/alder-creek/worship" />);
    expect(screen.getByRole("alert").textContent).toBe(GATE_COPY.loadError);
    const retry = screen.getByRole("link", { name: "Try again" });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/worship");
    expect(retry.className).toContain("min-h-11");
  });

  it("a closed request names why and links back to the schedule", () => {
    render(<RequestClosed slug="alder-creek" />);
    expect(screen.getByRole("heading", { level: 1, name: GATE_COPY.closedRequest.heading })).toBeTruthy();
    expect(screen.getByText(GATE_COPY.closedRequest.body)).toBeTruthy();
    expect(screen.getByRole("link", { name: GATE_COPY.closedRequest.link }).getAttribute("href")).toBe("/o/alder-creek/worship");
  });
});
