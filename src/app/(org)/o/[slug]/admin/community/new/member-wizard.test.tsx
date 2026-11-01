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
import { renderToString } from "react-dom/server";

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
const toastWarning = vi.hoisted(() => vi.fn());
const toastNote = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => toastNote(...args), {
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
  }),
}));

import { MemberWizard } from "./member-wizard";

// The Community engagement Server Actions reach the database; the screens under
// test only call them through the dialogs, which these files do not drive.
const mockRestorePersonAction = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({
  changeEngagementAction: vi.fn(),
  archivePersonAction: vi.fn(),
  restorePersonAction: (...args: unknown[]) => mockRestorePersonAction(...args),
  updateVisitDetailsAction: vi.fn(),
}));


afterEach(() => {
  cleanup();
  mockPush.mockClear();
  mockMatchPersonAction.mockReset();
  mockCreatePersonAction.mockReset();
  mockRestorePersonAction.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastWarning.mockClear();
  toastNote.mockClear();
});

function fillSearch(firstName = "Nora", lastName = "Ashgrove") {
  fireEvent.change(screen.getByLabelText(/^first name/i), {
    target: { value: firstName },
  });
  fireEvent.change(screen.getByLabelText(/^last name/i), {
    target: { value: lastName },
  });
}

describe("MemberWizard — initial render", () => {
  it("starts on the search step, with an adaptive step count (no match/confirm yet)", () => {
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);
    expect(screen.getByText(/step 1 of 6/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^search$/i })).toBeTruthy();
    // No Back button on the very first step.
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
  });
});

describe("MemberWizard — search with no match", () => {
  it("skips straight to the Identity step and prefills the searched name", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText(/name & birth date/i)).toBeTruthy();
    });
    expect(
      (screen.getByLabelText(/^first name/i) as HTMLInputElement).value,
    ).toBe("Nora");
    expect(
      (screen.getByLabelText(/^last name/i) as HTMLInputElement).value,
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
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);

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
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);

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
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);

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
      (screen.getByLabelText(/^first name/i) as HTMLInputElement).value,
    ).toBe("Nora");
  });
});

describe("MemberWizard — an archived match (Increment 3a, Copy groups D and E)", () => {
  it("says when they were archived, offers Restore beside Open their record, and Restore takes the administrator to the restored record", async () => {
    mockMatchPersonAction.mockResolvedValue({
      ok: true,
      data: {
        candidates: [
          {
            personId: "p-1",
            displayName: "N. Ashgrove",
            confidence: "high",
            alreadyHere: { connection: "former_visitor", endedOn: "2026-05-04" },
          },
        ],
      },
    });
    mockRestorePersonAction.mockResolvedValue({ ok: true, data: { personId: "p-1", list: "visitors" } });
    render(
      <MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />,
    );
    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByRole("button", { name: "Restore N. Ashgrove" }));
    expect(screen.getByText(/they were archived on/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open their record" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /yes, this is/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restore N. Ashgrove" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(mockRestorePersonAction).toHaveBeenCalledWith("alder-creek", { personId: "p-1" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/community/p-1/edit"));
  });
});

describe("MemberWizard — validation blocks Next", () => {
  it("Identity step: blank first/last name blocks advancing to Contact & Address", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);

    // Search with valid values so we reach Identity, then clear them.
    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));

    fireEvent.change(screen.getByLabelText(/^first name/i), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText(/^last name/i), {
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
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);
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
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);

    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));

    // Overwrite the prefilled values with something distinguishable.
    fireEvent.change(screen.getByLabelText(/^first name/i), {
      target: { value: "Nora-Jean" },
    });
    fireEvent.change(screen.getByLabelText(/middle name/i), {
      target: { value: "Ashgrove-Middle" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    await waitFor(() => screen.getByText(/contact & address/i));
    fireEvent.change(screen.getByLabelText(/^email address$/i), {
      target: { value: "nora@example.invalid" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    await waitFor(() => screen.getByText(/name & birth date/i));
    expect(
      (screen.getByLabelText(/^first name/i) as HTMLInputElement).value,
    ).toBe("Nora-Jean");
    expect(
      (screen.getByLabelText(/middle name/i) as HTMLInputElement).value,
    ).toBe("Ashgrove-Middle");

    // Forward again — the Contact & Address field entered earlier survived too.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => screen.getByText(/contact & address/i));
    expect(
      (screen.getByLabelText(/^email address$/i) as HTMLInputElement).value,
    ).toBe("nora@example.invalid");
  });

  it("REGRESSION (docs/TODO.md): dateOfBirth survives Next→Back when the native input's change event lands one frame after the visible value, not synchronously with it — reproducing real device timing, not jsdom's synchronous fireEvent", async () => {
    mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);

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

async function walkToConnection(canProposeRoll = true) {
  mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
  render(
    <MemberWizard
      organization="Alder Creek Presbyterian Church"
      slug="alder-creek"
      households={[]}
      canProposeRoll={canProposeRoll}
    />,
  );
  fillSearch("Nora", "Ashgrove");
  fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
  await waitFor(() => screen.getByText(/name & birth date/i));
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
  await waitFor(() => screen.getByText(/contact & address/i));
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
  await waitFor(() => screen.getByText(/^household$/i));
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
  await waitFor(() => screen.getByText(/step \d+ of \d+: connection/i));
}

describe("MemberWizard — Connection step options — regression for wizard-select-full-kind-map (docs/work-log/2026-08-26-member-roll-on-edit.md)", () => {
  it("offers Visitor, Participant and Member to a roll.propose holder, never a roll kind such as death or void", async () => {
    await walkToConnection(true);
    const select = screen.getByLabelText(/how is this person connected/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "visitor",
      "participant",
      "member",
    ]);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Visitor",
      "Participant (takes effect now)",
      "Member: profession of faith (needs Session approval)",
    ]);
  });

  it("offers only Visitor, with the Clerk-of-Session line, without roll.propose", async () => {
    await walkToConnection(false);
    const select = screen.getByLabelText(/how is this person connected/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["visitor"]);
    expect(
      screen.getByText(
        /participants and members are recorded by someone who can propose roll actions, such as the clerk of session/i,
      ),
    ).toBeTruthy();
  });

  it("shows the fields and the one-sentence description each choice needs", async () => {
    await walkToConnection(true);
    // Visitor (default)
    expect(screen.getByLabelText(/first visit \(optional\)/i)).toBeTruthy();
    expect(screen.getByLabelText(/how did they hear about us\? \(optional\)/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^effective date/i)).toBeNull();
    expect(
      screen.getByText(/someone who has visited\. not on any roll, and not listed in the directory/i),
    ).toBeTruthy();

    const select = screen.getByLabelText(/how is this person connected/i);
    fireEvent.change(select, { target: { value: "participant" } });
    expect(screen.getByLabelText(/^effective date/i)).toBeTruthy();
    expect(screen.queryByLabelText(/first visit/i)).toBeNull();
    expect(screen.getByText(/no approval is needed/i)).toBeTruthy();

    fireEvent.change(select, { target: { value: "member" } });
    expect(
      screen.getByText(/the session must approve before they count as a member/i),
    ).toBeTruthy();
  });

  it("blocks Next on a participant with no effective date", async () => {
    await walkToConnection(true);
    fireEvent.change(screen.getByLabelText(/how is this person connected/i), {
      target: { value: "participant" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() =>
      expect(screen.getByText(/effective date is required/i)).toBeTruthy(),
    );
    expect(screen.getByText(/step \d+ of \d+: connection/i)).toBeTruthy();
  });
});

describe("MemberWizard — required-field markers (L3)", () => {
  it("marks First name and Last name as required on the Search step", () => {
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);

    const firstName = screen.getByLabelText(/^first name/i);
    const lastName = screen.getByLabelText(/^last name/i);
    expect(firstName.getAttribute("aria-required")).toBe("true");
    expect(lastName.getAttribute("aria-required")).toBe("true");

    // An optional field on the same step carries no such marker.
    const email = screen.getByLabelText(/^email/i);
    expect(email.getAttribute("aria-required")).toBeNull();
  });

  it("marks the Connection select, and Effective date once a roll choice is made, as required", async () => {
    await walkToConnection(true);
    expect(
      screen.getByLabelText(/how is this person connected/i).getAttribute("aria-required"),
    ).toBe("true");
    fireEvent.change(screen.getByLabelText(/how is this person connected/i), {
      target: { value: "participant" },
    });
    expect(
      screen.getByLabelText(/effective date/i).getAttribute("aria-required"),
    ).toBe("true");
  });
});

async function submitFrom(relationship: "visitor" | "participant" | "member") {
  await walkToConnection(true);
  fireEvent.change(screen.getByLabelText(/how is this person connected/i), {
    target: { value: relationship },
  });
  if (relationship === "visitor") {
    fireEvent.change(screen.getByLabelText(/first visit/i), {
      target: { value: "2026-05-03" },
    });
    fireEvent.change(screen.getByLabelText(/how did they hear/i), {
      target: { value: "A neighbor" },
    });
  } else {
    fireEvent.change(screen.getByLabelText(/effective date/i), {
      target: { value: "2026-06-01" },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
  await waitFor(() => screen.getByText(/review & submit/i));
}

describe("MemberWizard — full happy path submit", () => {
  it("Member: assembles a profession_of_faith proposal and says it waits for the Session", async () => {
    mockCreatePersonAction.mockResolvedValue({
      ok: true,
      data: { personId: "p-1", rollActionId: "ra-1", effect: "pending", affectsFiledPeriod: false },
    });
    await submitFrom("member");
    expect(
      screen.getByText(/will wait for the session to approve before they appear as a member/i),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add person/i }));

    await waitFor(() => {
      expect(mockCreatePersonAction).toHaveBeenCalledWith(
        "alder-creek",
        expect.objectContaining({
          identity: expect.objectContaining({ mode: "new", firstName: "Nora", lastName: "Ashgrove" }),
          household: { mode: "none" },
          rollAction: expect.objectContaining({
            kind: "profession_of_faith",
            effectiveDate: "2026-06-01",
          }),
        }),
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Person added. They'll appear as a member once the Session approves.",
    );
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/community");
  });

  it("Participant: assembles an other_participant_enrolled entry that takes effect now", async () => {
    mockCreatePersonAction.mockResolvedValue({
      ok: true,
      data: { personId: "p-1", rollActionId: "ra-1", effect: "recorded", affectsFiledPeriod: true },
    });
    await submitFrom("participant");
    expect(screen.getByText(/takes effect immediately and is counted in the statistical report/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add person/i }));

    await waitFor(() => {
      expect(mockCreatePersonAction).toHaveBeenCalledWith(
        "alder-creek",
        expect.objectContaining({
          rollAction: expect.objectContaining({
            kind: "other_participant_enrolled",
            effectiveDate: "2026-06-01",
          }),
        }),
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Participant added. They're counted from the date you chose.",
    );
    // A second, warning toast when the entry lands in a filed year.
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringMatching(/year that has already been filed/i),
    );
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/community?view=participants");
  });

  it("Visitor: sends the visitor arm with first visit and how-heard, no roll fields", async () => {
    mockCreatePersonAction.mockResolvedValue({
      ok: true,
      data: { personId: "p-1", rollActionId: null, effect: "none", affectsFiledPeriod: false },
    });
    await submitFrom("visitor");
    expect(screen.getByText(/visitors aren't listed in the directory/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add person/i }));

    await waitFor(() => {
      expect(mockCreatePersonAction).toHaveBeenCalledWith(
        "alder-creek",
        expect.objectContaining({
          rollAction: {
            kind: "visitor",
            firstVisitDate: "2026-05-03",
            howHeard: "A neighbor",
          },
        }),
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith("Visitor added.");
    expect(toastWarning).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/community?view=visitors");
  });

  it("a denied submit does NOT reset the form or navigate away (no data loss)", async () => {
    mockCreatePersonAction.mockResolvedValue({
      ok: false,
      error: "That household no longer exists. Choose another or create a new one.",
    });
    await submitFrom("member");
    fireEvent.click(screen.getByRole("button", { name: /add person/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
    // Still on Review — the entered data is still visible/intact.
    expect(screen.getByText(/review & submit/i)).toBeTruthy();
    expect(screen.getByText(/Nora Ashgrove/)).toBeTruthy();
  });
});

describe("MemberWizard — already here (F178, DECISION-200)", () => {
  it("links to the person's record and does not offer the failing confirm", async () => {
    mockMatchPersonAction.mockResolvedValue({
      ok: true,
      data: {
        candidates: [
          {
            personId: "p-7",
            displayName: "N. Ashgrove",
            confidence: "exact",
            alreadyHere: { connection: "visitor", endedOn: null },
          },
        ],
      },
    });
    render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);
    fillSearch("Nora", "Ashgrove");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() =>
      screen.getByText(/n\. ashgrove is already in this community/i),
    );
    expect(screen.getByText("They're a visitor.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open their record/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/community/p-7/edit");
    expect(screen.queryByRole("button", { name: /^yes, this is/i })).toBeNull();
    // "No" still routes to a new person.
    fireEvent.click(screen.getByRole("button", { name: /no, this is someone new/i }));
    expect(screen.getByText(/name & birth date/i)).toBeTruthy();
  });
});

describe("MemberWizard — HydrationGate wiring (DECISION-159, F116)", () => {
  it("the server render of the root (which has no <form> tag) is a disabled, busy fieldset", () => {
    const html = renderToString(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('aria-busy="true"');
  });
});

// ---------------------------------------------------------------------------
// The address list editor on the contact step (DECISION-216, Batch 3).
// ---------------------------------------------------------------------------

async function walkToContact(searchEmail = "") {
  mockMatchPersonAction.mockResolvedValue({ ok: true, data: { candidates: [] } });
  render(<MemberWizard slug="alder-creek" organization="Alder Creek Presbyterian Church" households={[]} canProposeRoll={true} />);
  fillSearch("Nora", "Ashgrove");
  if (searchEmail) {
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: searchEmail } });
  }
  fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
  await waitFor(() => screen.getByText(/name & birth date/i));
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
  await waitFor(() => screen.getByText(/contact & address/i));
}

const next = () => fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

describe("MemberWizard — the contact step's address list", () => {
  it("shows one blank, valid row that is the main address, and Next works untouched", async () => {
    await walkToContact();
    const inputs = screen.getAllByLabelText(/^email address$/i) as HTMLInputElement[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.value).toBe("");
    expect((screen.getByRole("radio", { name: /^main address$/i }) as HTMLInputElement).checked).toBe(true);
    next();
    await waitFor(() => screen.getByText(/^household$/i));
  });

  it("pre-fills the first row from the address typed on the search step", async () => {
    await walkToContact("nora@example.invalid");
    expect((screen.getByLabelText(/^email address$/i) as HTMLInputElement).value).toBe("nora@example.invalid");
  });

  it("never overwrites an address typed on the contact step when the search is re-run", async () => {
    await walkToContact("nora@example.invalid");
    fireEvent.change(screen.getByLabelText(/^email address$/i), { target: { value: "typed@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await waitFor(() => screen.getByRole("button", { name: /^search$/i }));
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "other@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByText(/name & birth date/i));
    next();
    await waitFor(() => screen.getByText(/contact & address/i));
    expect((screen.getByLabelText(/^email address$/i) as HTMLInputElement).value).toBe("typed@example.invalid");
  });

  it("blocks Next on a malformed address with the field error, and keeps the step", async () => {
    await walkToContact();
    fireEvent.change(screen.getByLabelText(/^email address$/i), { target: { value: "nora@" } });
    next();
    await waitFor(() => expect(screen.getByText("Enter a valid email address.")).toBeTruthy());
    expect(screen.getByText(/contact & address/i)).toBeTruthy();
  });

  it("a row typed in this session is removed with no confirmation; a list can be emptied", async () => {
    await walkToContact();
    fireEvent.click(screen.getByRole("button", { name: /^add another email address$/i }));
    expect(screen.getAllByLabelText(/^email address$/i)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove email address 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove email address 1" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("No email address on file.")).toBeTruthy();
  });

  it("the review step lists every address with its tags, and the submit sends them with no ids and no blank rows", async () => {
    mockCreatePersonAction.mockResolvedValue({
      ok: true,
      data: { personId: "p-1", rollActionId: "ra-1", effect: "none", affectsFiledPeriod: false },
    });
    await walkToContact();
    fireEvent.change(screen.getByLabelText(/^email address$/i), { target: { value: "Nora@Example.Invalid" } });
    fireEvent.click(screen.getByRole("button", { name: /^add another email address$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add another email address$/i })); // stays blank
    const inputs = screen.getAllByLabelText(/^email address$/i);
    fireEvent.change(inputs[1]!, { target: { value: "nora.work@example.invalid" } });
    fireEvent.change((screen.getAllByLabelText(/^label$/i) as HTMLSelectElement[])[1]!, { target: { value: "work" } });
    fireEvent.click(
      (screen.getAllByRole("checkbox", { name: /don.t send mail to this address/i }) as HTMLInputElement[])[1]!,
    );
    next();
    await waitFor(() => screen.getByText(/^household$/i));
    next();
    await waitFor(() => screen.getByText(/step \d+ of \d+: connection/i));
    next();
    await waitFor(() => screen.getByText(/review & submit/i));

    expect(screen.getByText("Email addresses")).toBeTruthy();
    expect(screen.getByText("nora@example.invalid (Main)")).toBeTruthy();
    expect(screen.getByText("nora.work@example.invalid (Work, Don't send)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /add person/i }));
    await waitFor(() => expect(mockCreatePersonAction).toHaveBeenCalled());
    expect(mockCreatePersonAction.mock.calls[0]![1].contact.emails).toEqual([
      { value: "Nora@Example.Invalid", subtype: null, isPrimary: true, doNotContact: false },
      { value: "nora.work@example.invalid", subtype: "work", isPrimary: false, doNotContact: true },
    ]);
  });

  it("a person with no address sends no emails at all", async () => {
    mockCreatePersonAction.mockResolvedValue({
      ok: true,
      data: { personId: "p-1", rollActionId: "ra-1", effect: "none", affectsFiledPeriod: false },
    });
    await submitFrom("visitor");
    fireEvent.click(screen.getByRole("button", { name: /add person/i }));
    await waitFor(() => expect(mockCreatePersonAction).toHaveBeenCalled());
    expect(mockCreatePersonAction.mock.calls[0]![1].contact.emails).toBeUndefined();
  });

  it("raises an 'Also on file for' toast for a shared address after the person is added", async () => {
    mockCreatePersonAction.mockResolvedValue({
      ok: true,
      data: {
        personId: "p-1",
        rollActionId: "ra-1",
        effect: "none",
        affectsFiledPeriod: false,
        notes: { shared: [{ address: "nora@example.invalid", names: ["Tobias Renwick"], more: 0 }] },
      },
    });
    await submitFrom("visitor");
    fireEvent.click(screen.getByRole("button", { name: /add person/i }));
    await waitFor(() => expect(toastNote).toHaveBeenCalled());
    expect(toastNote.mock.calls[0]![0]).toBe("Also on file for Tobias Renwick");
    expect(toastSuccess).toHaveBeenCalled();
  });
});
