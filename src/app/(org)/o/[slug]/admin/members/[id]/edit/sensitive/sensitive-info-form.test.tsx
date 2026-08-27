// @vitest-environment jsdom
/**
 * `SensitiveInfoForm` — per-section rendering (absent when not granted),
 * prefill, and submit for each of the four independent sub-forms. Mocked at
 * the `./actions` boundary, same posture as `edit-person-form.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockRefresh = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
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
  mockPush.mockClear();
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

describe("SensitiveInfoForm — restricted indicator (M3)", () => {
  it("renders a lock-badge restricted indicator at the top of the form", () => {
    render(<SensitiveInfoForm slug="alder-creek" personId="p-1" data={BASE_DATA} />);
    expect(screen.getByText(/restricted/i)).toBeTruthy();
  });
});

describe("SensitiveInfoForm — select chevrons (H1)", () => {
  const DATA: SensitiveInfoForEdit = {
    ...BASE_DATA,
    grants: { ...BASE_DATA.grants, pastoralNotes: true, demographics: true },
    notes: [],
    demographics: null,
  };

  function expectChevronWrapped(select: HTMLElement) {
    const wrapper = select.parentElement as HTMLElement;
    expect(wrapper.className).toMatch(/relative/);
    const chevron = wrapper.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(select.className).toMatch(/appearance-none/);
  }

  it("wraps the note-type select with a relative wrapper + chevron", () => {
    render(<SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />);
    expectChevronWrapped(screen.getByLabelText(/note type/i));
  });

  it("wraps the visibility select with a relative wrapper + chevron", () => {
    render(<SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />);
    expectChevronWrapped(screen.getByLabelText(/^visibility$/i));
  });

  it("wraps the demographics source select with a relative wrapper + chevron", () => {
    render(<SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />);
    expectChevronWrapped(screen.getByLabelText(/^source$/i));
  });
});

describe("SensitiveInfoForm — pastoral notes empty state (M5)", () => {
  it("shows the dashed-card empty state, not a bare muted-text line, when there are no notes", () => {
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{
          ...BASE_DATA,
          grants: { ...BASE_DATA.grants, pastoralNotes: true },
          notes: [],
        }}
      />,
    );
    expect(screen.getByText(/no notes recorded yet/i)).toBeTruthy();
    expect(screen.getByText(/add the first pastoral care note below/i)).toBeTruthy();
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

describe("SensitiveInfoForm — racial/ethnic filter (M4)", () => {
  it("narrows the 9-option checklist to matches, case-insensitively, and restores on clear", () => {
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{
          ...BASE_DATA,
          grants: { ...BASE_DATA.grants, demographics: true },
          demographics: null,
        }}
      />,
    );

    // All 9 options visible unfiltered.
    expect(screen.getByLabelText(/^asian$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^white$/i)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/filter options/i), {
      target: { value: "AFR" },
    });

    expect(screen.getByLabelText(/^african$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^african american$/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^asian$/i)).toBeNull();
    expect(screen.queryByLabelText(/^white$/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/filter options/i), {
      target: { value: "" },
    });
    expect(screen.getByLabelText(/^asian$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^white$/i)).toBeTruthy();
  });

  it("shows a no-matches message when the filter matches nothing", () => {
    render(
      <SensitiveInfoForm
        slug="alder-creek"
        personId="p-1"
        data={{
          ...BASE_DATA,
          grants: { ...BASE_DATA.grants, demographics: true },
          demographics: null,
        }}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/filter options/i), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/no options match/i)).toBeTruthy();
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

describe("SensitiveInfoForm — unsaved-changes guard (H3)", () => {
  const DATA: SensitiveInfoForEdit = {
    ...BASE_DATA,
    grants: { ...BASE_DATA.grants, pastoralNotes: true, demographics: true },
    notes: [],
    demographics: null,
  };

  it("intercepts a same-origin link click (standing in for the shared 'Back to portal' link) once ANY section is dirtied", () => {
    render(
      <div>
        <a href="/o/alder-creek">Back to portal</a>
        <SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/^note$/i), {
      target: { value: "A draft note." },
    });
    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));

    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek");
  });

  it("does not intercept the link when nothing has been touched", () => {
    render(
      <div>
        <a href="/o/alder-creek">Back to portal</a>
        <SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />
      </div>,
    );

    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("a dirty demographics field alone (no note typed) still triggers the guard", () => {
    render(
      <div>
        <a href="/o/alder-creek">Back to portal</a>
        <SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/gender/i), {
      target: { value: "woman" },
    });
    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));

    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();
  });

  it("saving the dirty section successfully clears the guard again", async () => {
    mockSetPersonDemographicsAction.mockResolvedValueOnce({
      ok: true,
      data: { personId: "p-1" },
    });
    render(
      <div>
        <a href="/o/alder-creek">Back to portal</a>
        <SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/gender/i), {
      target: { value: "woman" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save demographics/i }));

    await waitFor(() => expect(mockSetPersonDemographicsAction).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // The section clearing its own dirty flag, the parent recomputing the
    // combined guard, and the guard's own ref-sync effect are cascaded
    // render passes — flush them before clicking, rather than assuming
    // `toastSuccess` having fired means every downstream effect already has.
    await act(async () => {});

    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("Stay keeps the draft note intact", () => {
    render(
      <div>
        <a href="/o/alder-creek">Back to portal</a>
        <SensitiveInfoForm slug="alder-creek" personId="p-1" data={DATA} />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/^note$/i), {
      target: { value: "Don't lose me." },
    });
    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));
    fireEvent.click(screen.getByRole("button", { name: /^stay$/i }));

    expect(mockPush).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^note$/i) as HTMLTextAreaElement).value).toBe(
      "Don't lose me.",
    );
  });
});
