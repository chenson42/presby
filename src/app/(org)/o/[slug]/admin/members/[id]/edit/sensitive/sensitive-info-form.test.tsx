// @vitest-environment jsdom
/**
 * `SensitiveInfoForm` — per-section rendering (absent when not granted),
 * prefill, and submit for each of the four independent sub-forms. Mocked at
 * the `./actions` boundary, same posture as `edit-person-form.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

const mockAddPersonNoteAction = vi.hoisted(() => vi.fn());
const mockSetPersonDemographicsAction = vi.hoisted(() => vi.fn());
const mockSetPersonMedicalAction = vi.hoisted(() => vi.fn());
const mockSetPersonDisabilitiesAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  addPersonNoteAction: (...args: unknown[]) => mockAddPersonNoteAction(...args),
  setPersonDemographicsAction: (...args: unknown[]) =>
    mockSetPersonDemographicsAction(...args),
  setPersonMedicalAction: (...args: unknown[]) => mockSetPersonMedicalAction(...args),
  setPersonDisabilitiesAction: (...args: unknown[]) =>
    mockSetPersonDisabilitiesAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { SensitiveInfoForm } from "./sensitive-info-form";
import type { SensitiveInfoForEdit } from "@/lib/person-sensitive";

const BASE_DATA: SensitiveInfoForEdit = {
  personId: "p-1",
  grants: {
    pastoralNotes: false,
    demographics: false,
    medical: false,
    disabilities: false,
  },
  disabilityTrackingEnabled: false,
};

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  mockAddPersonNoteAction.mockReset();
  mockSetPersonDemographicsAction.mockReset();
  mockSetPersonMedicalAction.mockReset();
  mockSetPersonDisabilitiesAction.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("SensitiveInfoForm — per-section rendering", () => {
  it("renders no section when every grant is false", () => {
    render(<SensitiveInfoForm slug="alder-creek" personId="p-1" data={BASE_DATA} />);

    expect(screen.queryByText(/pastoral care notes/i)).toBeNull();
    expect(screen.queryByText(/^demographics$/i)).toBeNull();
    expect(screen.queryByText(/children.s check-in/i)).toBeNull();
    expect(screen.queryByText(/^disabilities$/i)).toBeNull();
  });

  it("renders only the notes section when only pastoralNotes is granted", () => {
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{ ...BASE_DATA, grants: { ...BASE_DATA.grants, pastoralNotes: true }, notes: [] }}
      />,
    );

    expect(screen.getByText(/pastoral care notes/i)).toBeTruthy();
    expect(screen.queryByText(/^demographics$/i)).toBeNull();
  });

  it("does NOT render the disabilities section when granted but org tracking is off", () => {
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{
          ...BASE_DATA,
          grants: { ...BASE_DATA.grants, disabilities: true },
          disabilities: [],
          disabilityTrackingEnabled: false,
        }}
      />,
    );

    expect(screen.queryByText(/^disabilities$/i)).toBeNull();
  });

  it("renders the disabilities section when granted AND org tracking is on (both, not either)", () => {
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{
          ...BASE_DATA,
          grants: { ...BASE_DATA.grants, disabilities: true },
          disabilities: [],
          disabilityTrackingEnabled: true,
        }}
      />,
    );

    expect(screen.getByText(/^disabilities$/i)).toBeTruthy();
  });
});

describe("SensitiveInfoForm — pastoral notes section", () => {
  const DATA: SensitiveInfoForEdit = {
    ...BASE_DATA,
    grants: { ...BASE_DATA.grants, pastoralNotes: true },
    notes: [
      {
        id: "n-1",
        noteType: "general",
        visibility: "staff",
        body: "Existing note.",
        occurredOn: null,
        authorUserId: "u-1",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  };

  it("lists existing notes", () => {
    render(<SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />);
    expect(screen.getByText("Existing note.")).toBeTruthy();
  });

  it("adding a note calls addPersonNoteAction and clears the body on success", async () => {
    mockAddPersonNoteAction.mockResolvedValueOnce({ ok: true, data: { noteId: "n-2" } });
    render(<SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />);

    fireEvent.change(screen.getByLabelText(/^note$/i), {
      target: { value: "A new note." },
    });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => expect(mockAddPersonNoteAction).toHaveBeenCalled());
    expect(mockAddPersonNoteAction).toHaveBeenCalledWith(
      "alder-creek",
      "p-1",
      expect.objectContaining({ body: "A new note." }),
    );
    expect(toastSuccess).toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByLabelText(/^note$/i) as HTMLTextAreaElement).value).toBe(""),
    );
  });

  it("a denied save surfaces the server's error and does not clear the body", async () => {
    mockAddPersonNoteAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to do that here.",
    });
    render(<SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />);

    fireEvent.change(screen.getByLabelText(/^note$/i), {
      target: { value: "Kept on failure." },
    });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to do that here.",
    ));
    expect((screen.getByLabelText(/^note$/i) as HTMLTextAreaElement).value).toBe(
      "Kept on failure.",
    );
  });
});

describe("SensitiveInfoForm — demographics section", () => {
  it("prefills from existing data and saves on submit", async () => {
    mockSetPersonDemographicsAction.mockResolvedValueOnce({
      ok: true,
      data: { personId: "p-1" },
    });
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{
          ...BASE_DATA,
          grants: { ...BASE_DATA.grants, demographics: true },
          demographics: { gender: "woman", racialEthnic: ["asian"], source: "self" },
        }}
      />,
    );

    expect((screen.getByLabelText(/gender/i) as HTMLInputElement).value).toBe("woman");

    fireEvent.click(screen.getByRole("button", { name: /save demographics/i }));

    await waitFor(() => expect(mockSetPersonDemographicsAction).toHaveBeenCalled());
    expect(mockSetPersonDemographicsAction).toHaveBeenCalledWith(
      "alder-creek",
      "p-1",
      { gender: "woman", racialEthnic: ["asian"], source: "self" },
    );
  });
});

describe("SensitiveInfoForm — medical section", () => {
  it("saves the four fields on submit", async () => {
    mockSetPersonMedicalAction.mockResolvedValueOnce({ ok: true, data: { personId: "p-1" } });
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{
          ...BASE_DATA,
          grants: { ...BASE_DATA.grants, medical: true },
          medical: {
            allergies: "peanuts",
            medicalNotes: null,
            medications: null,
            authorizedPickup: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save medical information/i }));

    await waitFor(() => expect(mockSetPersonMedicalAction).toHaveBeenCalled());
    expect(mockSetPersonMedicalAction).toHaveBeenCalledWith("alder-creek", "p-1", {
      allergies: "peanuts",
      medicalNotes: null,
      medications: null,
      authorizedPickup: null,
    });
  });
});

describe("SensitiveInfoForm — disabilities section", () => {
  it("toggling a category and saving calls setPersonDisabilitiesAction with the full set", async () => {
    mockSetPersonDisabilitiesAction.mockResolvedValueOnce({
      ok: true,
      data: { personId: "p-1" },
    });
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{
          ...BASE_DATA,
          grants: { ...BASE_DATA.grants, disabilities: true },
          disabilities: ["hearing"],
          disabilityTrackingEnabled: true,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText(/^mobility$/i));
    fireEvent.click(screen.getByRole("button", { name: /save disability records/i }));

    await waitFor(() => expect(mockSetPersonDisabilitiesAction).toHaveBeenCalled());
    const [, , input] = mockSetPersonDisabilitiesAction.mock.calls[0];
    expect(input.categories.sort()).toEqual(["hearing", "mobility"]);
  });
});
