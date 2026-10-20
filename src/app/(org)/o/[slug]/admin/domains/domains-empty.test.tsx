// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({ claimDomainAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DomainsEmpty } from "./domains-empty";

afterEach(cleanup);

describe("DomainsEmpty (G29)", () => {
  it("explains the two paths, says where the site lives meanwhile, and offers a Start button - not 'No domains'", () => {
    render(<DomainsEmpty slug="alder-creek" siteAddress="presbyportal.invalid/site/alder-creek" />);
    expect(screen.getByText(/Bring a domain you already own\./)).toBeTruthy();
    expect(screen.getByText(/Get one later\./)).toBeTruthy();
    expect(screen.getByText(/presbyportal\.invalid\/site\/alder-creek/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/No domains/i);
  });

  it("the form is right there: a labelled field", () => {
    render(<DomainsEmpty slug="alder-creek" siteAddress="x" />);
    expect(screen.getByLabelText("Your domain")).toBeTruthy();
  });
});
