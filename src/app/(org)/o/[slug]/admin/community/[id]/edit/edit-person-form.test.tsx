// @vitest-environment jsdom
/**
 * `EditPersonForm` — prefill, submit (success + failure), Cancel. Mocked at
 * the `./actions` boundary, same posture as `member-wizard.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
const toastNote = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => toastNote(...args), {
    success: toastSuccess,
    error: toastError,
  }),
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
  emails: [
    {
      id: "c-1",
      value: "nora@example.invalid",
      subtype: null,
      isPrimary: true,
      doNotContact: false,
      createdAt: "2026-01-01T00:00:00.000000Z",
    },
  ],
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
  toastNote.mockClear();
});

describe("EditPersonForm — prefill", () => {
  it("prefills every known field from the person prop", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);

    expect((screen.getByLabelText(/^first name/i) as HTMLInputElement).value).toBe("Nora");
    expect((screen.getByLabelText(/^last name/i) as HTMLInputElement).value).toBe("Ashgrove");
    expect((screen.getByLabelText(/^email address$/i) as HTMLInputElement).value).toBe(
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

const NORA_PERSONAL = {
  id: "c-1",
  value: "nora@example.invalid",
  subtype: "personal" as const,
  isPrimary: true,
  doNotContact: false,
  createdAt: "2026-01-01T00:00:00.000000Z",
};
const NORA_WORK = {
  id: "c-2",
  value: "nora.work@example.invalid",
  subtype: "work" as const,
  isPrimary: false,
  doNotContact: true,
  createdAt: "2026-01-02T00:00:00.000000Z",
};
const TWO = { ...PERSON, emails: [NORA_PERSONAL, NORA_WORK] };

const submitted = () => mockUpdatePersonAction.mock.calls[0]![1].contact.emails;
const addressInputs = () => screen.getAllByLabelText(/^email address$/i) as HTMLInputElement[];
const save = () => fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
const okResult = (extra: object = {}) => ({ ok: true, data: { personId: "p-1", ...extra } });

describe("EditPersonForm — the address list editor", () => {
  it("lists every saved address with its label, flag and badges, main first", () => {
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    expect(addressInputs().map((i) => i.value)).toEqual([
      "nora@example.invalid",
      "nora.work@example.invalid",
    ]);
    const labels = screen.getAllByLabelText(/^label$/i) as HTMLSelectElement[];
    expect(labels.map((l) => l.value)).toEqual(["personal", "work"]);
    const radios = screen.getAllByRole("radio", { name: /^main address$/i }) as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    const boxes = screen.getAllByRole("checkbox", { name: /don.t send mail to this address/i }) as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    expect(screen.getAllByText("Main")).toHaveLength(1);
    expect(screen.getAllByText("Don't send")).toHaveLength(1);
    expect(screen.getByText("Address 2")).toBeTruthy();
  });

  it("saving with only a name change re-sends the list unchanged, with the ids the form loaded", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(okResult());
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    fireEvent.change(screen.getByLabelText(/^first name/i), { target: { value: "Nora-Jean" } });
    save();
    await waitFor(() => expect(mockUpdatePersonAction).toHaveBeenCalled());
    expect(submitted()).toEqual({
      rows: [
        { id: "c-1", value: "nora@example.invalid", subtype: "personal", isPrimary: true, doNotContact: false },
        { id: "c-2", value: "nora.work@example.invalid", subtype: "work", isPrimary: false, doNotContact: true },
      ],
      knownIds: ["c-1", "c-2"],
    });
  });

  it("a person with no address shows the empty state; adding one makes it the main address", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(okResult());
    render(<EditPersonForm slug="alder-creek" person={{ ...PERSON, emails: [] }} households={[]} />);
    expect(screen.getByText("No email address on file.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^add an email address$/i }));
    fireEvent.change(addressInputs()[0]!, { target: { value: "  Nora@Example.Invalid " } });
    expect(screen.getByRole("button", { name: /^add another email address$/i })).toBeTruthy();
    save();
    await waitFor(() => expect(mockUpdatePersonAction).toHaveBeenCalled());
    expect(submitted()).toEqual({
      rows: [{ value: "  Nora@Example.Invalid ", subtype: null, isPrimary: true, doNotContact: false }],
      knownIds: [],
    });
  });

  it("a blank new row is ignored on submit; a chosen label goes up, and 'No label' goes up as null", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(okResult());
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^add another email address$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add another email address$/i }));
    const inputs = addressInputs();
    fireEvent.change(inputs[2]!, { target: { value: "nora.other@example.invalid" } });
    fireEvent.change((screen.getAllByLabelText(/^label$/i) as HTMLSelectElement[])[2]!, {
      target: { value: "other" },
    });
    fireEvent.change((screen.getAllByLabelText(/^label$/i) as HTMLSelectElement[])[0]!, {
      target: { value: "" },
    });
    save();
    await waitFor(() => expect(mockUpdatePersonAction).toHaveBeenCalled());
    const rows = submitted().rows;
    expect(rows).toHaveLength(3);
    expect(rows[0].subtype).toBeNull();
    expect(rows[2]).toEqual({ value: "nora.other@example.invalid", subtype: "other", isPrimary: false, doNotContact: false });
  });

  it("the Main radio keeps exactly one main; choosing another moves the badge and the payload", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(okResult());
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    const radios = () => screen.getAllByRole("radio", { name: /^main address$/i }) as HTMLInputElement[];
    fireEvent.click(radios()[1]!);
    expect(radios().map((r) => r.checked)).toEqual([false, true]);
    expect(screen.getAllByText("Main")).toHaveLength(1);
    save();
    await waitFor(() => expect(mockUpdatePersonAction).toHaveBeenCalled());
    expect(submitted().rows.map((r: { isPrimary: boolean }) => r.isPrimary)).toEqual([false, true]);
  });

  it("'Don't send' sets the flag and shows its badge", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(okResult());
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    fireEvent.click(
      (screen.getAllByRole("checkbox", { name: /don.t send mail to this address/i }) as HTMLInputElement[])[0]!,
    );
    expect(screen.getAllByText("Don't send")).toHaveLength(2);
    save();
    await waitFor(() => expect(mockUpdatePersonAction).toHaveBeenCalled());
    expect(submitted().rows[0].doNotContact).toBe(true);
  });

  it("fixing a typo keeps the row id (the server ends and replaces it) and carries label and flag", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(okResult());
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    fireEvent.change(addressInputs()[1]!, { target: { value: "nora.office@example.invalid" } });
    save();
    await waitFor(() => expect(mockUpdatePersonAction).toHaveBeenCalled());
    expect(submitted().rows[1]).toEqual({
      id: "c-2", value: "nora.office@example.invalid", subtype: "work", isPrimary: false, doNotContact: true,
    });
  });

  it("caps the list at 10: Add is disabled with the caption", () => {
    const many = Array.from({ length: 10 }, (_, n) => ({
      id: `c-${n}`, value: `n${n}@example.invalid`, subtype: null, isPrimary: n === 0, doNotContact: false,
      createdAt: `2026-01-0${(n % 9) + 1}T00:00:00.000000Z`,
    }));
    render(<EditPersonForm slug="alder-creek" person={{ ...PERSON, emails: many }} households={[]} />);
    const add = screen.getByRole("button", { name: /^add another email address$/i }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText("A person can have up to 10 email addresses.")).toBeTruthy();
  });
});

describe("EditPersonForm — address field errors", () => {
  it("a saved row left blank, a bad shape, a repeat and a too-long address each block the save with their own text", async () => {
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    fireEvent.change(addressInputs()[0]!, { target: { value: "" } });
    fireEvent.change(addressInputs()[1]!, { target: { value: "not an address" } });
    save();
    await waitFor(() => expect(screen.getByText("Enter an email address, or remove this row.")).toBeTruthy());
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();

    fireEvent.change(addressInputs()[0]!, { target: { value: "same@example.invalid" } });
    fireEvent.change(addressInputs()[1]!, { target: { value: " SAME@example.invalid" } });
    save();
    await waitFor(() => expect(screen.getByText("This address is already in the list.")).toBeTruthy());

    fireEvent.change(addressInputs()[1]!, { target: { value: `${"a".repeat(250)}@example.invalid` } });
    save();
    await waitFor(() =>
      expect(screen.getByText("That email address is too long. Use 254 characters or fewer.")).toBeTruthy(),
    );
    expect(mockUpdatePersonAction).not.toHaveBeenCalled();
    // The input is wired to its message for assistive tech.
    expect(addressInputs()[1]!.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("EditPersonForm — Remove", () => {
  const removeButton = (n: number) => screen.getByRole("button", { name: `Remove email address ${n}` });

  it("an address typed in this session is dropped with no dialog", () => {
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^add another email address$/i }));
    expect(addressInputs()).toHaveLength(3);
    fireEvent.click(removeButton(3));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(addressInputs()).toHaveLength(2);
  });

  it("removing a non-main address asks first, with the soft-removal sentence; Keep leaves it", () => {
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(removeButton(2));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Remove this email address?")).toBeTruthy();
    expect(dialog.textContent).toContain(
      "nora.work@example.invalid will stop being used and will no longer show on Nora Ashgrove's record once you save. A record of the change is kept.",
    );
    expect(dialog.textContent).not.toContain("will become the main address");
    expect(dialog.textContent).not.toContain("only address");
    fireEvent.click(within(dialog).getByRole("button", { name: /^keep$/i }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(addressInputs()).toHaveLength(2);
  });

  it("removing the MAIN address names the address that becomes main, and sends no main so the server promotes it", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(
      okResult({ notes: { promoted: { address: "nora.work@example.invalid" } } }),
    );
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    fireEvent.click(removeButton(1));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "It is the main address, so nora.work@example.invalid will become the main address.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /^remove$/i }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(addressInputs().map((i) => i.value)).toEqual(["nora.work@example.invalid"]);
    // The editor already shows who will be main.
    expect(screen.getByText("Main")).toBeTruthy();

    save();
    await waitFor(() => expect(mockUpdatePersonAction).toHaveBeenCalled());
    expect(submitted().rows).toEqual([
      { id: "c-2", value: "nora.work@example.invalid", subtype: "work", isPrimary: false, doNotContact: true },
    ]);
    expect(submitted().knownIds).toEqual(["c-1", "c-2"]);
    // The promotion is reported in the success toast.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Person updated. Now the main address: nora.work@example.invalid.",
      ),
    );
  });

  it("removing the only address says the person will have none on file", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    fireEvent.click(removeButton(1));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "It is the only address, so Nora Ashgrove will have no email address on file.",
    );
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^remove$/i }));
    expect(screen.getByText("No email address on file.")).toBeTruthy();
  });

  it("the Remove buttons are named by position and never read as the participant controls", () => {
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    expect(screen.queryByRole("button", { name: /remove as participant/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /undo last entry/i })).toBeNull();
    for (const n of [1, 2]) {
      expect((removeButton(n) as HTMLButtonElement).className).toContain("min-h-11");
    }
  });
});

describe("EditPersonForm — what a save tells the administrator", () => {
  it("a plain save says 'Person updated.' and raises no other toast", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(okResult());
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    save();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Person updated."));
    expect(toastNote).not.toHaveBeenCalled();
  });

  it("each shared address gets its own 'Also on file for' toast, shown for 10 seconds", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce(
      okResult({
        notes: {
          shared: [
            { address: "nora@example.invalid", names: ["Tobias Renwick"], more: 0 },
            { address: "nora.work@example.invalid", names: ["Priya Balakrishnan", "Desmond Okonkwo"], more: 0 },
            { address: "x@example.invalid", names: ["A B", "C D", "E F"], more: 2 },
          ],
        },
      }),
    );
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    save();
    await waitFor(() => expect(toastNote).toHaveBeenCalledTimes(3));
    expect(toastNote.mock.calls[0]).toEqual([
      "Also on file for Tobias Renwick",
      {
        description:
          "nora@example.invalid is saved on both records. Invitations to a shared address won't go through, because they can't tell the two people apart.",
        duration: 10000,
      },
    ]);
    expect(toastNote.mock.calls[1]![0]).toBe("Also on file for Priya Balakrishnan and Desmond Okonkwo");
    expect(toastNote.mock.calls[2]![0]).toBe("Also on file for A B, C D and 3 others");
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/community");
  });

  it("a refused save (stale list) shows the server's text, keeps every edit and does not leave the page", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce({
      ok: false,
      error:
        "This person's email addresses changed while you were editing. Reload the page to see the current list. Nothing was saved.",
    });
    render(<EditPersonForm slug="alder-creek" person={TWO} households={[]} />);
    fireEvent.change(addressInputs()[1]!, { target: { value: "kept@example.invalid" } });
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(addressInputs()[1]!.value).toBe("kept@example.invalid");
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("EditPersonForm — save", () => {
  it("blank first/last name blocks submit", async () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    fireEvent.change(screen.getByLabelText(/^first name/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByText(/first name is required/i)).toBeTruthy();
    });
    expect(mockUpdatePersonAction).not.toHaveBeenCalled();
  });

  it("submits the edited values and redirects to the members list on success", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce({ ok: true, data: { personId: "p-1" } });
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);

    fireEvent.change(screen.getByLabelText(/^first name/i), { target: { value: "Nora-Jean" } });
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
      expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/community");
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("a failed save does NOT discard the edited values (req 9, same discipline as MemberWizard)", async () => {
    mockUpdatePersonAction.mockResolvedValueOnce({
      ok: false,
      error: "That household no longer exists.",
    });
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);

    fireEvent.change(screen.getByLabelText(/^first name/i), { target: { value: "Nora-Jean" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("That household no longer exists.");
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText(/^first name/i) as HTMLInputElement).value,
    ).toBe("Nora-Jean");
  });

  it("Cancel navigates back to the members list without submitting", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/community");
    expect(mockUpdatePersonAction).not.toHaveBeenCalled();
  });
});

describe("EditPersonForm — unsaved-changes guard (H3)", () => {
  it("Cancel opens the discard dialog instead of navigating once the form is dirty", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    fireEvent.change(screen.getByLabelText(/^first name/i), {
      target: { value: "Nora-Jean" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();
  });

  it("Stay keeps the user on the page with the edit intact", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    fireEvent.change(screen.getByLabelText(/^first name/i), {
      target: { value: "Nora-Jean" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^stay$/i }));

    expect(mockPush).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText(/^first name/i) as HTMLInputElement).value,
    ).toBe("Nora-Jean");
  });

  it("Discard completes the navigation the Cancel click intended", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    fireEvent.change(screen.getByLabelText(/^first name/i), {
      target: { value: "Nora-Jean" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));

    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/community");
  });
});

describe("EditPersonForm — required-field markers (L3)", () => {
  it("marks First name and Last name as required, visually and via aria-required", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);

    const firstName = screen.getByLabelText(/^first name/i);
    const lastName = screen.getByLabelText(/^last name/i);
    expect(firstName.getAttribute("aria-required")).toBe("true");
    expect(lastName.getAttribute("aria-required")).toBe("true");

    // The label text carries a visible marker too — asserted as an
    // aria-hidden character so the accessible name is untouched.
    const firstNameLabel = document.querySelector('label[for="edit-person-firstName"]');
    expect(firstNameLabel?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("does NOT mark an optional field (e.g. suffix) as required", () => {
    render(<EditPersonForm slug="alder-creek" person={PERSON} households={[]} />);
    const suffix = screen.getByLabelText(/suffix/i);
    expect(suffix.getAttribute("aria-required")).toBeNull();
  });
});
