// @vitest-environment jsdom
/**
 * The claim form: hydration gate root (DECISION-159), the www/apex choice only
 * for a bare domain, the mapped server input, server errors on the right field,
 * and what the form does after a successful claim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const claimDomainAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ claimDomainAction: (...a: unknown[]) => claimDomainAction(...a) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { ClaimForm } from "./claim-form";

afterEach(() => {
  cleanup();
  claimDomainAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const domain = () => screen.getByLabelText("Your domain") as HTMLInputElement;
const type = (v: string) => fireEvent.change(domain(), { target: { value: v } });
const submit = (name = "Start") => fireEvent.click(screen.getByRole("button", { name }));

describe("ClaimForm", () => {
  it("is rooted in a HydrationGate (DECISION-159) and has a labelled field with its hint", () => {
    const { container } = render(<ClaimForm slug="alder-creek" />);
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect(domain().getAttribute("aria-describedby")).toContain("claim-domain-hint");
    expect(screen.getByText(/Just the name, like yourchurch\.org\. No https:\/\/ needed\./)).toBeTruthy();
  });

  it("shows the www / no-www choice only for a bare domain, with www the default", () => {
    render(<ClaimForm slug="alder-creek" />);
    expect(screen.queryByRole("radio")).toBeNull();
    type("www.church-one.invalid");
    expect(screen.queryByRole("radio")).toBeNull();
    type("church-one.invalid");
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios[0]!.checked).toBe(true);
    expect(screen.getByText(/The other one will send visitors to your main address/)).toBeTruthy();
  });

  it("sends the typed domain and the chosen primary, then clears the field and thanks the person", async () => {
    claimDomainAction.mockResolvedValue({ ok: true, data: { claimName: "church-one.invalid" } });
    render(<ClaimForm slug="alder-creek" />);
    type("https://Church-One.invalid/");
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    submit();
    await waitFor(() => expect(claimDomainAction).toHaveBeenCalledTimes(1));
    expect(claimDomainAction).toHaveBeenCalledWith("alder-creek", { domain: "https://Church-One.invalid/", canonical: "apex" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Domain added. Now publish the record shown below."));
    await waitFor(() => expect(domain().value).toBe(""));
  });

  it("an empty submit never reaches the server and says what to enter, on the field", async () => {
    render(<ClaimForm slug="alder-creek" />);
    submit();
    await waitFor(() => expect(screen.getByText("Enter your domain, like yourchurch.org.")).toBeTruthy());
    expect(domain().getAttribute("aria-invalid")).toBe("true");
    expect(claimDomainAction).not.toHaveBeenCalled();
  });

  it("a server refusal for the domain lands on the field, not in a toast", async () => {
    claimDomainAction.mockResolvedValue({ ok: false, code: "invalid", field: "domain", error: "That name can't be connected here." });
    render(<ClaimForm slug="alder-creek" />);
    type("church-one.invalid");
    submit();
    const error = await screen.findByText("That name can't be connected here.");
    expect(error.getAttribute("role")).toBe("alert");
    expect(domain().getAttribute("aria-invalid")).toBe("true");
    expect(toastError).not.toHaveBeenCalled();
    expect(domain().value).toBe("church-one.invalid"); // kept, so it can be corrected
  });

  it("a non-field refusal (cap, rate limit) is a toast and keeps what was typed", async () => {
    claimDomainAction.mockResolvedValue({ ok: false, code: "rate_limited", error: "You've done that a lot just now. Try again in 5 minutes." });
    render(<ClaimForm slug="alder-creek" />);
    type("church-one.invalid");
    submit();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You've done that a lot just now. Try again in 5 minutes."));
    expect(domain().value).toBe("church-one.invalid");
  });

  it("a thrown action (network down) is a human toast, not a raw error", async () => {
    claimDomainAction.mockRejectedValue(new Error("fetch failed: ECONNRESET"));
    render(<ClaimForm slug="alder-creek" />);
    type("church-one.invalid");
    submit();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't add that right now. Try again in a few minutes."));
  });

  it("the submit label is configurable and the button is disabled while submitting", async () => {
    let finish!: (v: unknown) => void;
    claimDomainAction.mockReturnValue(new Promise((r) => (finish = r)));
    render(<ClaimForm slug="alder-creek" submitLabel="Add domain" idPrefix="claim-more" />);
    type("church-one.invalid");
    submit("Add domain");
    const busy = await screen.findByRole("button", { name: "Adding…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add domain" })).toBeTruthy());
  });
});
