// @vitest-environment jsdom
/**
 * `EditPersonForm` — prefill, submit (success + failure), Cancel. Mocked at
 * the `./actions` boundary, same posture as `member-wizard.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

const mockUpdatePersonAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  updatePersonAction: (...args: unknown[]) => mockUpdatePersonAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { EditPersonForm } from "./edit-person-form";
import type { PersonForEdit } from "@/lib/people";

const PERSON: PersonForEdit = {
  personId: "p-1",
  firstName: "Nora",
  lastName: "Ashgrove",
  middleName: null,
  preferredName: null,
  suffix: null,
  email: "nora@example.invalid",
  phone: null,
  address: { line1: "1 Main St", city: "Springfield", region: null, postalCode: null },
  householdId: null,
};

afterEach(() => {
  cleanup();
  mockPush.mockClear();
  mockUpdatePersonAction.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("EditPersonForm — prefill", () => {
  it("prefills every known field from the person prop", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);

    expect((screen.getByLabelText(/^first name$/i) as HTMLInputElement).value).toBe("Nora");
    expect((screen.getByLabelText(/^last name$/i) as HTMLInputElement).value).toBe("Ashgrove");
    expect((screen.getByLabelText(/^email/i) as HTMLInputElement).value).toBe(
      "nora@example.invalid",
    );
    expect((screen.getByLabelText(/^address/i) as HTMLInputElement).value).toBe("1 Main St");
    expect((screen.getByLabelText(/^city/i) as HTMLInputElement).value).toBe("Springfield");
  });

  it("pre-selects 'existing' household mode when the person already has one", () => {
    render(
      <EditPersonForm
        slug="alder-creek"
        person={{ ...PERSON, householdId: "hh-1" }}
        households={[{ householdId: "hh-1", name: "The Ashgroves" }]}
      />,
    );
    expect(
      (screen.getByRole("radio", { name: /existing household/i }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("EditPersonForm — save", () => {
  it("blank first/last name blocks submit", async () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByText(/first name is required/i)).toBeTruthy();
    });
    expect(mockUpdatePersonAction).not.toHaveBeenCalled();
  });

  it("submits the edited values and redirects to the members list on success", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce({ ok: true, data: { personId: "p-1" } });
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);

    fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "Nora-Jean" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdatePersonAction).toHaveBeenCalledWith(
        "alder-creek",
        expect.objectContaining({
          personId: "p-1",
          identity: expect.objectContaining({ firstName: "Nora-Jean" }),
        }),
      );
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/members");
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("a failed save does NOT discard the edited values (req 9, same discipline as MemberWizard)", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce({
      ok: false,
      error: "That household no longer exists.",
    });
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);

    fireEvent.change(screen.getByLabelText(/^first name$/i), { target: { value: "Nora-Jean" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("That household no longer exists.");
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText(/^first name$/i) as HTMLInputElement).value,
    ).toBe("Nora-Jean");
  });

  it("Cancel navigates back to the members list without submitting", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/members");
    expect(mockUpdatePersonAction).not.toHaveBeenCalled();
  });
});
