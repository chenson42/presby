// @vitest-environment jsdom
/**
 * Component tests for `GuardianLinkForm` — empty state, existing-links
 * rendering, the add form's two modes (link existing / name only), and the
 * remove/edit affordances. Server actions are mocked at the module boundary.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GuardianLink, LinkablePerson } from "@/lib/children";

const mockAdd = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());
const mockSearch = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  addGuardianLinkAction: (...args: unknown[]) => mockAdd(...args),
  updateGuardianLinkAction: (...args: unknown[]) => mockUpdate(...args),
  removeGuardianLinkAction: (...args: unknown[]) => mockRemove(...args),
  searchLinkablePeopleAction: (...args: unknown[]) => mockSearch(...args),
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { GuardianLinkForm } from "./guardian-link-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const EXISTING_LINK: GuardianLink = {
  id: "link-1",
  relatedPersonId: "adult-1",
  relatedName: null,
  relatedPersonName: "Tobias Renwick",
  relationship: "parent",
  isEmergencyContact: true,
  notes: "Primary contact",
};

const NAME_ONLY_LINK: GuardianLink = {
  id: "link-2",
  relatedPersonId: null,
  relatedName: "Aunt Wilhelmina",
  relatedPersonName: null,
  relationship: "caregiver",
  isEmergencyContact: false,
  notes: null,
};

describe("GuardianLinkForm — empty state", () => {
  it("renders 'No guardians on file' when links is empty", () => {
    render(<GuardianLinkForm slug="alder-creek" personId="p-1" links={[]} />);
    expect(screen.getByText(/no guardians on file/i)).toBeTruthy();
  });
});

describe("GuardianLinkForm — existing rows", () => {
  it("renders a linked-existing-person row with its resolved name", () => {
    render(
      <GuardianLinkForm slug="alder-creek" personId="p-1" links={[EXISTING_LINK]} />,
    );
    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
    expect(screen.getByText(/Parent · Emergency contact/i)).toBeTruthy();
  });

  it("renders a free-text row with its relatedName", () => {
    render(
      <GuardianLinkForm slug="alder-creek" personId="p-1" links={[NAME_ONLY_LINK]} />,
    );
    expect(screen.getByText("Aunt Wilhelmina")).toBeTruthy();
  });

  it("Remove calls removeGuardianLinkAction with the row's id", async () => {
    mockRemove.mockResolvedValueOnce({ ok: true });
    render(
      <GuardianLinkForm slug="alder-creek" personId="p-1" links={[EXISTING_LINK]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith("alder-creek", "p-1", "link-1");
    });
  });

  it("Edit toggles an inline form, and Save calls updateGuardianLinkAction", async () => {
    mockUpdate.mockResolvedValueOnce({ ok: true, data: { linkId: "link-1" } });
    render(
      <GuardianLinkForm slug="alder-creek" personId="p-1" links={[EXISTING_LINK]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        "alder-creek",
        "p-1",
        "link-1",
        expect.objectContaining({ relatedPersonId: "adult-1" }),
      );
    });
  });
});

describe("GuardianLinkForm — add form, 'link an existing person' mode (default)", () => {
  it("defaults to the 'link an existing person' radio", () => {
    render(<GuardianLinkForm slug="alder-creek" personId="p-1" links={[]} />);
    const radio = screen.getByRole("radio", {
      name: /link an existing person/i,
    }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it("rejects submit with no person selected", async () => {
    render(<GuardianLinkForm slug="alder-creek" personId="p-1" links={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^add guardian$/i }));
    await waitFor(() => {
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  it("search → select → submit calls addGuardianLinkAction with relatedPersonId, never relatedName", async () => {
    const MATCH: LinkablePerson = {
      personId: "adult-1",
      firstName: "Isolde",
      lastName: "Sparrowbrook",
      preferredName: null,
    };
    mockSearch.mockResolvedValueOnce({ ok: true, data: { people: [MATCH] } });
    mockAdd.mockResolvedValueOnce({ ok: true, data: { linkId: "link-3" } });

    render(<GuardianLinkForm slug="alder-creek" personId="p-1" links={[]} />);

    fireEvent.change(screen.getByLabelText(/search this organization/i), {
      target: { value: "Isolde" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Isolde Sparrowbrook/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Isolde Sparrowbrook/i));

    fireEvent.click(screen.getByRole("button", { name: /^add guardian$/i }));

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledWith(
        "alder-creek",
        "p-1",
        expect.objectContaining({
          relatedPersonId: "adult-1",
          relatedName: undefined,
        }),
      );
    });
  });
});

describe("GuardianLinkForm — add form, 'name only' fallback mode", () => {
  it("switching to name-only mode and submitting calls addGuardianLinkAction with relatedName, never relatedPersonId", async () => {
    mockAdd.mockResolvedValueOnce({ ok: true, data: { linkId: "link-4" } });
    render(<GuardianLinkForm slug="alder-creek" personId="p-1" links={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /enter a name only/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Uncle Ferdinand" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add guardian$/i }));

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledWith(
        "alder-creek",
        "p-1",
        expect.objectContaining({
          relatedName: "Uncle Ferdinand",
          relatedPersonId: undefined,
        }),
      );
    });
  });

  it("rejects submit with a blank name", async () => {
    render(<GuardianLinkForm slug="alder-creek" personId="p-1" links={[]} />);
    fireEvent.click(screen.getByRole("radio", { name: /enter a name only/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add guardian$/i }));
    await waitFor(() => {
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });
});
