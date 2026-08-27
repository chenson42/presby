// @vitest-environment jsdom
/**
 * `MemberWizard` — the whole add-a-person flow. Mocked at the `./actions`
 * boundary (`matchPerson`/`createPerson`'s own SQL correctness is proven by
 * `people.test.ts`). This file pins the CLIENT-side contract Phase 1's
 * elderly/mobile UX requirements demand:
 *
 *   - the duplicate-match confirm/reject branches (req 7), never showing a
 *     confidence score;
 *   - Back preserves already-entered data (req 6) — proven EXPLICITLY, not
 *     just asserted by absence of a reset call;
 *   - form validation blocks Next on required fields (identity name,
 *     household selection, roll-action effective date);
 *   - the adaptive step indicator text.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

const mockMatchPersonAction = vi.hoisted(() => vi.fn());
const mockCreatePersonAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  matchPersonAction: (...args: unknown[]) => mockMatchPersonAction(...args),
  createPersonAction: (...args: unknown[]) => mockCreatePersonAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { MemberWizard } from "./member-wizard";
import { WIZARD_ROLL_ACTION_KINDS } from "@/lib/roll-action-kinds";

afterEach(() => {
  cleanup();
  mockPush.mockClear();
  mockMatchPersonAction.mockReset();
  mockCreatePersonAction.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

function fillSearch(firstName = "Nora", lastName = "Ashgrove") {
  fireEvent.change(screen.getByLabelText(/^first name$/i), {
    target: { value: firstName },
  });
  fireEvent.change(screen.getByLabelText(/^last name$/i), {
    target: { value: lastName },
  });
}

describe("MemberWizard — initial render", () => {
  it("starts on the search step, with an adaptive step count (no match/confirm yet)", () => {
    render(<MemberWizard slug="alder-creek" households={[]} />);
    expect(screen.getByText(/step 1 of 6/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^search$/i })).toBeTruthy();
    // No Back button on the very first step.
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
  });
});

describe("MemberWizard — search with no match", () => {
  it("skips straight to the Identity step and prefills the searched name", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText(/name & birth date/i)).toBeTruthy();
    });
    expect(
      (screen.getByLabelText(/^first name$/i) as HTMLInputElement).value,
    ).toBe("Nora");
    expect(
      (screen.getByLabelText(/^last name$/i) as HTMLInputElement).value,
    ).toBe("Ashgrove");
  });
});

describe("MemberWizard — duplicate-match confirm/reject (req 7)", () => {
  it("shows the plain-language confirm screen with the candidate's name, NEVER a confidence score", async () => {
    mockMatchPersonAction.mockResolvedValue({
      ok: true,
      data: {
        candidates: [
          { personId: "p-1", displayName: "N. Ashgrove", confidence: "high" },
        ],
      },
    });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /yes, this is n\. ashgrove/i }),
      ).toBeTruthy();
    });
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/confidence/i);
    expect(body).not.toMatch(/\bhigh\b/);
  });

  it("'Yes' sets identityMode to existing and skips the Identity step entirely", async () => {
    mockMatchPersonAction.mockResolvedValue({
      ok: true,
      data: {
        candidates: [
          { personId: "p-1", displayName: "N. Ashgrove", confidence: "high" },
        ],
      },
    });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() =>
      screen.getByRole("button", { name: /yes, this is n\. ashgrove/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /yes, this is n\. ashgrove/i }),
    );

    expect(screen.getByText(/contact & address/i)).toBeTruthy();
    expect(screen.queryByText(/name & birth date/i)).toBeNull();
  });

  it("'No' routes to the Identity step, prefilled from the search query", async () => {
    mockMatchPersonAction.mockResolvedValue({
      ok: true,
      data: {
        candidates: [
          { personId: "p-1", displayName: "N. Ashgrove", confidence: "high" },
        ],
      },
    });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() =>
      screen.getByRole("button", { name: /no, this is someone new/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /no, this is someone new/i }),
    );

    expect(screen.getByText(/name & birth date/i)).toBeTruthy();
    expect(
      (screen.getByLabelText(/^first name$/i) as HTMLInputElement).value,
    ).toBe("Nora");
  });
});

describe("MemberWizard — validation blocks Next", () => {
  it("Identity step: blank first/last name blocks advancing to Contact & Address", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    // Search with valid values so we reach Identity, then clear them.
    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));

    fireEvent.change(screen.getByLabelText(/^first name$/i), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText(/^last name$/i), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => {
      expect(screen.getByText(/first name is required/i)).toBeTruthy();
    });
    // Still on Identity — never advanced.
    expect(screen.getByText(/name & birth date/i)).toBeTruthy();
  });

  it("Search step: blank first/last name blocks calling matchPersonAction at all", async () => {
    render(<MemberWizard slug="alder-creek" households={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => {
      expect(screen.getByText(/first name is required/i)).toBeTruthy();
    });
    expect(mockMatchPersonAction).not.toHaveBeenCalled();
  });
});

describe("MemberWizard — Back is lossless (req 6)", () => {
  it("Back from Contact & Address to Identity preserves the identity fields already typed", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));

    // Overwrite the prefilled values with something distinguishable.
    fireEvent.change(screen.getByLabelText(/^first name$/i), {
      target: { value: "Nora-Jean" },
    });
    fireEvent.change(screen.getByLabelText(/middle name/i), {
      target: { value: "Ashgrove-Middle" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/contact & address/i));
    fireEvent.change(screen.getByLabelText(/^email/i), {
      target: { value: "nora@example.invalid" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    await waitFor(() => screen.getByText(/name & birth date/i));
    expect(
      (screen.getByLabelText(/^first name$/i) as HTMLInputElement).value,
    ).toBe("Nora-Jean");
    expect(
      (screen.getByLabelText(/middle name/i) as HTMLInputElement).value,
    ).toBe("Ashgrove-Middle");

    // Forward again — the Contact & Address field entered earlier survived too.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => screen.getByText(/contact & address/i));
    expect(
      (screen.getByLabelText(/^email/i) as HTMLInputElement).value,
    ).toBe("nora@example.invalid");
  });

  it("REGRESSION (docs/TODO.md): dateOfBirth survives Next→Back when the native input's change event lands one frame after the visible value, not synchronously with it — reproducing real device timing, not jsdom's synchronous fireEvent", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));

    const dobInput = screen.getByLabelText(
      /date of birth/i,
    ) as HTMLInputElement;

    // Tap Next FIRST — before the picker's own native `change` event (the
    // event react-hook-form's `register` listens on) has been dispatched at
    // all, reproducing a real device where the tap lands right as the
    // picker is still closing.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    // The native commit "arrives" a few milliseconds later — a real
    // macrotask gap, comfortably inside the fix's own animation-frame wait
    // but late enough that an unwaited `form.trigger()` would already have
    // read the empty value and moved the step away, unmounting this field.
    await new Promise((resolve) => setTimeout(resolve, 5));
    fireEvent.change(dobInput, { target: { value: "1950-01-01" } });

    await waitFor(() => screen.getByText(/contact & address/i));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    await waitFor(() => screen.getByText(/name & birth date/i));
    expect(
      (screen.getByLabelText(/date of birth/i) as HTMLInputElement).value,
    ).toBe("1950-01-01");
  });
});

describe("MemberWizard — roll action kind options — regression for wizard-select-full-kind-map (docs/work-log/2026-08-26-member-roll-on-edit.md)", () => {
  it("the Roll action <select> renders exactly WIZARD_ROLL_ACTION_KINDS, never death/void/any other kind from the shared 17-kind label map", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/contact & address/i));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/^household$/i));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/step \d+ of \d+: roll action/i));

    const select = screen.getByLabelText(/^roll action$/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((option) => option.value);

    // Exact match, not just "doesn't contain death" — proves the <select>
    // consumes WIZARD_ROLL_ACTION_KINDS itself, not some other subset that
    // happens to exclude death too.
    expect(optionValues).toEqual([...WIZARD_ROLL_ACTION_KINDS]);
    expect(optionValues).not.toContain("death");
    expect(optionValues).not.toContain("void");
    expect(optionValues).not.toContain("certificate_dismissed");
  });
});

describe("MemberWizard — full happy path submit", () => {
  it("walks Search → Identity → Contact → Household → Roll action → Review → submit, calling createPersonAction with the assembled input", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    mockCreatePersonAction.mockResolvedValue({
      ok: true,
      data: { personId: "p-1", rollActionId: "ra-1" },
    });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/contact & address/i));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/^household$/i));
    // Default household.mode is "none" — no extra fields required.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/step \d+ of \d+: roll action/i));
    fireEvent.change(screen.getByLabelText(/effective date/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/review & submit/i));
    fireEvent.click(screen.getByRole("button", { name: /add person/i }));

    await waitFor(() => {
      expect(mockCreatePersonAction).toHaveBeenCalledWith(
        "alder-creek",
        expect.objectContaining({
          identity: expect.objectContaining({
            mode: "new",
            firstName: "Nora",
            lastName: "Ashgrove",
          }),
          household: { mode: "none" },
          rollAction: expect.objectContaining({
            kind: "profession_of_faith",
            effectiveDate: "2026-06-01",
          }),
        }),
      );
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/members");
  });

  it("a denied submit does NOT reset the form or navigate away (no data loss)", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    mockCreatePersonAction.mockResolvedValue({
      ok: false,
      error: "That household no longer exists. Choose another or create a new one.",
    });
    render(<MemberWizard slug="alder-creek" households={[]} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => screen.getByText(/contact & address/i));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => screen.getByText(/^household$/i));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => screen.getByText(/step \d+ of \d+: roll action/i));
    fireEvent.change(screen.getByLabelText(/effective date/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => screen.getByText(/review & submit/i));
    fireEvent.click(screen.getByRole("button", { name: /add person/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
    // Still on Review — the entered data is still visible/intact.
    expect(screen.getByText(/review & submit/i)).toBeTruthy();
    expect(screen.getByText(/Nora Ashgrove/)).toBeTruthy();
  });
});
