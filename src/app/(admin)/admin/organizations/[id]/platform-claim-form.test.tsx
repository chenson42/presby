// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const claimDomainForOrgAction = vi.hoisted(() => vi.fn());
vi.mock("./domains-actions", () => ({ claimDomainForOrgAction: (...a: unknown[]) => claimDomainForOrgAction(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { PlatformClaimForm } from "./platform-claim-form";

afterEach(() => {
  cleanup();
  claimDomainForOrgAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

const renderForm = () => render(<PlatformClaimForm organizationId="org-1" organizationName="Alder Creek Church" />);

describe("PlatformClaimForm (operator ruling Q2)", () => {
  it("is rooted in a HydrationGate (DECISION-159)", () => {
    const { container } = renderForm();
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
  });

  it("records the claim for the organization with the chosen primary", async () => {
    claimDomainForOrgAction.mockResolvedValue({ ok: true, data: { claimName: "church-one.invalid" } });
    renderForm();
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "church-one.invalid" } });
    fireEvent.click(screen.getByRole("radio", { name: "Without www" }));
    fireEvent.click(screen.getByRole("button", { name: "Record claim" }));
    await waitFor(() => expect(claimDomainForOrgAction).toHaveBeenCalledWith("org-1", { domain: "church-one.invalid", canonical: "apex" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Claim recorded for Alder Creek Church. The proof record is shown above."));
  });

  it("a refusal for the domain lands on the field; an empty submit never reaches the server", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Record claim" }));
    await waitFor(() => expect(screen.getByText("Enter a domain.")).toBeTruthy());
    expect(claimDomainForOrgAction).not.toHaveBeenCalled();
    claimDomainForOrgAction.mockResolvedValue({ ok: false, code: "invalid", field: "domain", error: "That name can't be connected here." });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "x.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Record claim" }));
    expect(await screen.findByText("That name can't be connected here.")).toBeTruthy();
  });

  it("when the church's website toggle is off the server's refusal is a toast", async () => {
    claimDomainForOrgAction.mockResolvedValue({ ok: false, code: "feature_off", error: "Turn on Website domain for this organization first." });
    renderForm();
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "x.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Record claim" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Turn on Website domain for this organization first."));
  });
});
