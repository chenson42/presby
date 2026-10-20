// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const setOrgDomainFeatureAction = vi.hoisted(() => vi.fn());
vi.mock("./domains-actions", () => ({ setOrgDomainFeatureAction: (...a: unknown[]) => setOrgDomainFeatureAction(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { DomainTogglesCard } from "./domain-toggles-card";

afterEach(() => {
  cleanup();
  setOrgDomainFeatureAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

const initial = { "org_portal.domains": false, "org_portal.mail_domain": false };
const renderCard = (state = initial) => render(<DomainTogglesCard organizationId="org-1" organizationName="Alder Creek Church" initial={state} />);

describe("DomainTogglesCard", () => {
  it("shows both operator toggles with their state in words", () => {
    renderCard({ "org_portal.domains": true, "org_portal.mail_domain": false });
    expect(screen.getByTestId("toggle-state-org_portal.domains").textContent).toBe("On");
    expect(screen.getByTestId("toggle-state-org_portal.mail_domain").textContent).toBe("Off");
    expect(screen.getByRole("button", { name: "Turn off Website domain" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on Email from the church's domain" })).toBeTruthy();
  });

  it("turning the website toggle on calls the platform action for THIS organization and updates in place", async () => {
    setOrgDomainFeatureAction.mockResolvedValue({ ok: true, data: { changed: true } });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Turn on Website domain" }));
    await waitFor(() => expect(setOrgDomainFeatureAction).toHaveBeenCalledWith("org-1", "org_portal.domains", true));
    await waitFor(() => expect(screen.getByTestId("toggle-state-org_portal.domains").textContent).toBe("On"));
    expect(toast.success).toHaveBeenCalledWith("Website domain is now on for Alder Creek Church.");
    expect(screen.getByRole("button", { name: "Turn off Website domain" })).toBeTruthy();
  });

  it("a refusal leaves the state as it was", async () => {
    setOrgDomainFeatureAction.mockResolvedValue({ ok: false, code: "not_found", error: "That organization doesn't exist." });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Turn on Website domain" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That organization doesn't exist."));
    expect(screen.getByTestId("toggle-state-org_portal.domains").textContent).toBe("Off");
  });

  it("a thrown action is a human toast", async () => {
    setOrgDomainFeatureAction.mockRejectedValue(new Error("boom"));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Turn on Website domain" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That didn't go through. Try again."));
  });

  it("says the email toggle has no effect yet", () => {
    renderCard();
    expect(screen.getByText(/Turning it on has no effect yet/)).toBeTruthy();
  });
});
