// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DomainDiagnosisPanel } from "./domain-diagnosis-panel";

afterEach(cleanup);

describe("DomainDiagnosisPanel", () => {
  it("is a button controlling a region: aria-expanded flips, the region is hidden until opened", () => {
    render(<DomainDiagnosisPanel />);
    const button = screen.getByRole("button", { name: /Why isn.t it working\?/ });
    const region = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(region.hidden).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(region.hidden).toBe(false);
    fireEvent.click(button);
    expect(region.hidden).toBe(true);
  });

  it("lists the four first-line causes plus propagation time", () => {
    render(<DomainDiagnosisPanel startOpen />);
    for (const key of ["proxied", "leftover_aaaa", "caa", "wrong_primary", "propagation"]) {
      expect(document.querySelector(`[data-cause="${key}"]`), key).toBeTruthy();
    }
    expect(screen.getByText(/DNS changes can take up to an hour to be seen/)).toBeTruthy();
    expect(screen.getByText(/The record is proxied \(Cloudflare's orange cloud\)/)).toBeTruthy();
  });

  it("flags only the causes the checks detected", () => {
    render(<DomainDiagnosisPanel startOpen detected={["leftover_aaaa"]} />);
    expect(document.querySelector('[data-cause="leftover_aaaa"]')!.textContent).toContain("We see this");
    expect(document.querySelector('[data-cause="proxied"]')!.textContent).not.toContain("We see this");
  });

  it("uses no <details>/<summary> (the iOS disclosure bug in CLAUDE.md)", () => {
    const { container } = render(<DomainDiagnosisPanel startOpen />);
    expect(container.querySelector("details, summary")).toBeNull();
  });

  it("offers a support link only when the tenant page gives one", () => {
    const { rerender } = render(<DomainDiagnosisPanel startOpen />);
    expect(screen.queryByRole("link", { name: "Contact support" })).toBeNull();
    rerender(<DomainDiagnosisPanel startOpen supportHref="/o/alder-creek/tickets/new" />);
    expect(screen.getByRole("link", { name: "Contact support" }).getAttribute("href")).toBe("/o/alder-creek/tickets/new");
  });

  it("its button is a 44px target", () => {
    render(<DomainDiagnosisPanel />);
    expect(screen.getByRole("button").className).toMatch(/min-h-11/);
  });
});
