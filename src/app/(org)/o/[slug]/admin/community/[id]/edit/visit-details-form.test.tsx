// @vitest-environment jsdom
/**
 * Visit details (Increment 3a, Copy group F). Mocked at the `../../actions`
 * boundary; the writer's bounds are `community-engagement.db.test.ts`'s job.
 * These pin the client: what is sent (blank clears, text trimmed), each outcome's
 * sentence in the place it belongs, controls disabled until hydration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

const mockUpdate = vi.hoisted(() => vi.fn());
vi.mock("../../actions", () => ({
  updateVisitDetailsAction: (...a: unknown[]) => mockUpdate(...a),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { VisitDetailsForm } from "./visit-details-form";

afterEach(() => {
  cleanup();
  for (const m of [mockRefresh, mockUpdate, toastSuccess, toastError]) m.mockReset();
});

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const PROPS = { slug: "alder-creek", personId: PERSON_ID, firstVisitDate: "2026-03-01", howHeard: "A neighbour" };
const date = () => screen.getByLabelText("First visit (optional)") as HTMLInputElement;
const heard = () => screen.getByLabelText("How did they hear about us? (optional)") as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save visit details" }));

describe("VisitDetailsForm", () => {
  it("shows the heading, the two labelled fields with the stored values, and a date floor of 1900", () => {
    render(<VisitDetailsForm {...PROPS} />);
    expect(screen.getByRole("heading", { name: "Visit details" })).toBeTruthy();
    expect(date().value).toBe("2026-03-01");
    expect(date().type).toBe("date");
    expect(date().min).toBe("1900-01-01");
    expect(heard().value).toBe("A neighbour");
  });

  it("controls are disabled in the server render, before hydration (DECISION-159)", () => {
    const html = renderToString(<VisitDetailsForm {...PROPS} />);
    for (const tag of html.match(/<(input|button)[^>]*>/g) ?? []) expect(tag).toContain('disabled=""');
  });

  it("saves the date and the trimmed text, toasts and refreshes", async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { personId: PERSON_ID } });
    render(<VisitDetailsForm {...PROPS} />);
    fireEvent.change(date(), { target: { value: "2026-04-05" } });
    fireEvent.change(heard(), { target: { value: "  A friend  " } });
    save();
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("alder-creek", {
        personId: PERSON_ID,
        firstVisitDate: "2026-04-05",
        howHeard: "A friend",
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Visit details saved."));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("a blank field clears the stored value (null, not an empty string)", async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { personId: PERSON_ID } });
    render(<VisitDetailsForm {...PROPS} />);
    fireEvent.change(date(), { target: { value: "" } });
    fireEvent.change(heard(), { target: { value: "   " } });
    save();
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("alder-creek", { personId: PERSON_ID, firstVisitDate: null, howHeard: null }),
    );
  });

  it("the bad-date sentence appears under the date field, as an alert, and no toast", async () => {
    const message = "That date can't be used. Choose a date from 1900 up to today.";
    mockUpdate.mockResolvedValue({ ok: false, error: message });
    render(<VisitDetailsForm {...PROPS} />);
    save();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(date().getAttribute("aria-invalid")).toBe("true");
    expect(date().getAttribute("aria-describedby")).toBe(alert.id);
    expect(toastError).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("the too-long sentence appears under the text field; there is no maxLength to hide it", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: "Keep this under 200 characters." });
    render(<VisitDetailsForm {...PROPS} />);
    expect(heard().maxLength).toBe(-1);
    save();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Keep this under 200 characters.");
    expect(heard().getAttribute("aria-invalid")).toBe("true");
  });

  it("any other refusal is a toast (ended: connection has ended)", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: "This person's connection here has ended, so this can't be changed." });
    render(<VisitDetailsForm {...PROPS} />);
    save();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("This person's connection here has ended, so this can't be changed."),
    );
  });

  it("a thrown error says nothing was changed", async () => {
    mockUpdate.mockRejectedValue(new Error("network"));
    render(<VisitDetailsForm {...PROPS} />);
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't save that change. Nothing was changed."));
  });

  it("clears a shown error on the next save", async () => {
    mockUpdate.mockResolvedValueOnce({ ok: false, error: "Keep this under 200 characters." });
    mockUpdate.mockResolvedValueOnce({ ok: true, data: { personId: PERSON_ID } });
    render(<VisitDetailsForm {...PROPS} />);
    save();
    await screen.findByRole("alert");
    save();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
