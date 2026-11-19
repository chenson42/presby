// @vitest-environment jsdom
/**
 * The commission forms and dialogs (docs/work-log/2026-11-19-presbytery-committees.md,
 * C15): each `useForm` root inside HydrationGate; the C15 messages on the right field;
 * a refused save keeps the typed values and shows the fixed `copy.ts` string; dates are
 * `type="date"`; an edit carries the reader's `rowVersion`; the end dialog refuses a
 * future date or one before the appointment in the dialog; the remove dialog asks first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  recordCommissionAction: vi.fn(),
  updateCommissionAction: vi.fn(),
  addCommissionMemberAction: vi.fn(),
  endCommissionMemberAction: vi.fn(),
  endCommissionAction: vi.fn(),
  removeCommissionRecordAction: vi.fn(),
}));
vi.mock("@/app/(org)/o/[slug]/admin/committees/commissions/actions", () => ({
  recordCommissionAction: actions.recordCommissionAction,
}));
vi.mock("@/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions", () => ({
  updateCommissionAction: actions.updateCommissionAction,
  addCommissionMemberAction: actions.addCommissionMemberAction,
  endCommissionMemberAction: actions.endCommissionMemberAction,
  endCommissionAction: actions.endCommissionAction,
  removeCommissionRecordAction: actions.removeCommissionRecordAction,
}));
vi.mock("@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions", () => ({ endCommitteeSeatAction: vi.fn() }));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { CommissionForm, type CommissionFormRecord } from "./commission-form";
import { CommissionMemberForm } from "./commission-member-form";
import { EndCommissionDialog } from "./end-commission-dialog";
import { EndTermDialog } from "./end-term-dialog";
import { RemoveRecordDialog } from "./remove-record-dialog";

const TODAY = "2026-11-19";
const SLUG = "northern-reach";
const KID = "00000000-0000-4000-8000-0000000000a1";
const MID = "00000000-0000-4000-8000-0000000000a2";
const PERSON = "00000000-0000-4000-8000-0000000000a3";
const CONGS = [
  { id: "00000000-0000-4000-8000-0000000000c1", name: "Alder Creek Church" },
  { id: "00000000-0000-4000-8000-0000000000c2", name: "Birch Hollow Church" },
];
const RECORD: CommissionFormRecord = {
  id: KID,
  title: "Commission on Alder Creek",
  charge: "Look into the building.",
  aboutOrgId: CONGS[0]!.id,
  congregationName: "Alder Creek Church",
  congregationIsMember: true,
  appointedOn: "2026-03-01",
  minuteReference: "Stated meeting, item 4",
  rowVersion: 7,
};

afterEach(() => {
  cleanup();
  Object.values(actions).forEach((m) => m.mockReset());
  toastError.mockReset();
  toastSuccess.mockReset();
  push.mockReset();
  refresh.mockReset();
});

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("every useForm root is inside HydrationGate", () => {
  const forms: Array<[string, () => React.ReactElement]> = [
    ["commission", () => <CommissionForm slug={SLUG} congregations={CONGS} today={TODAY} />],
    ["commission member", () => <CommissionMemberForm slug={SLUG} commissionId={KID} people={[]} today={TODAY} />],
  ];
  for (const [name, make] of forms) {
    it(name, () => {
      const { container } = render(make());
      const gate = container.querySelector('fieldset[data-slot="hydration-gate"]');
      expect(gate).toBeTruthy();
      expect(gate!.querySelector("form")).toBeTruthy();
    });
  }
});

describe("CommissionForm (C15)", () => {
  it("has the C15 fields, 'No congregation' first, the two helpers, and native date input capped at today", () => {
    render(<CommissionForm slug={SLUG} congregations={CONGS} today={TODAY} />);
    const select = screen.getByLabelText("Congregation (optional)") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["No congregation", "Alder Creek Church", "Birch Hollow Church"]);
    expect(screen.getByText(/Describe the charge in general terms\. Don't record confidential details\. Anyone who can manage committees at this presbytery can read it\./)).toBeTruthy();
    expect(screen.getByText("For example, the meeting date and item.")).toBeTruthy();
    const date = screen.getByLabelText("Appointed on") as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.max).toBe(TODAY);
    expect(date.value).toBe(TODAY);
    expect(screen.getByRole("button", { name: "Record commission" })).toBeTruthy();
  });

  it("shows the C15 messages on the right field and calls no action while invalid", async () => {
    render(<CommissionForm slug={SLUG} congregations={CONGS} today={TODAY} />);
    type("Appointed on", "");
    click("Record commission");
    expect(await screen.findByText("Title is required.")).toBeTruthy();
    expect(screen.getByText("Choose the date it was appointed.")).toBeTruthy();
    expect(actions.recordCommissionAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
  });

  it("refuses an appointment after today on the field (the B5 ruling's string)", async () => {
    render(<CommissionForm slug={SLUG} congregations={CONGS} today={TODAY} />);
    type("Title", "A commission");
    type("Appointed on", "2026-12-01");
    click("Record commission");
    expect(await screen.findByText("The appointed date can't be after today.")).toBeTruthy();
    expect(actions.recordCommissionAction).not.toHaveBeenCalled();
  });

  it("records with an empty congregation, toasts and goes to the new commission's page", async () => {
    actions.recordCommissionAction.mockResolvedValue({ ok: true, data: { id: KID } });
    render(<CommissionForm slug={SLUG} congregations={CONGS} today={TODAY} />);
    type("Title", "A commission");
    click("Record commission");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/${SLUG}/admin/committees/commissions/${KID}`));
    expect(actions.recordCommissionAction).toHaveBeenCalledWith(SLUG, {
      title: "A commission",
      charge: "",
      aboutOrgId: "",
      appointedOn: TODAY,
      minuteReference: "",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Commission recorded.");
  });

  it("the neutral congregation refusal goes under the congregation field and keeps every typed value", async () => {
    const error = "That congregation could not be found among Presbytery of the Northern Reach's member congregations.";
    actions.recordCommissionAction.mockResolvedValue({ ok: false, kind: "congregation_not_found", error });
    render(<CommissionForm slug={SLUG} congregations={CONGS} today={TODAY} />);
    type("Title", "Kept title");
    type("Charge (optional)", "Kept charge");
    type("Congregation (optional)", CONGS[1]!.id);
    click("Record commission");
    expect(await screen.findByText(error)).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Kept title");
    expect((screen.getByLabelText("Charge (optional)") as HTMLTextAreaElement).value).toBe("Kept charge");
    expect(toastError).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("an edit starts from the stored values, carries the reader's row version, and returns to the commission", async () => {
    actions.updateCommissionAction.mockResolvedValue({ ok: true, data: { id: KID } });
    render(<CommissionForm slug={SLUG} congregations={CONGS} today={TODAY} commission={RECORD} />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Commission on Alder Creek");
    expect((screen.getByLabelText("Congregation (optional)") as HTMLSelectElement).value).toBe(CONGS[0]!.id);
    type("Title", "Renamed");
    click("Save changes");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/${SLUG}/admin/committees/commissions/${KID}`));
    expect(actions.updateCommissionAction).toHaveBeenCalledWith(SLUG, {
      title: "Renamed",
      charge: "Look into the building.",
      aboutOrgId: CONGS[0]!.id,
      appointedOn: "2026-03-01",
      minuteReference: "Stated meeting, item 4",
      commissionId: KID,
      expectedVersion: 7,
    });
    expect(toastSuccess).toHaveBeenCalledWith("Commission saved.");
  });

  it("a record whose congregation has left keeps it selected under its stored name", () => {
    render(
      <CommissionForm
        slug={SLUG}
        congregations={[CONGS[1]!]}
        today={TODAY}
        commission={{ ...RECORD, aboutOrgId: "00000000-0000-4000-8000-0000000000c9", congregationName: "Gone Church", congregationIsMember: false }}
      />,
    );
    const select = screen.getByLabelText("Congregation (optional)") as HTMLSelectElement;
    expect(select.value).toBe("00000000-0000-4000-8000-0000000000c9");
    expect(Array.from(select.options).map((o) => o.text)).toContain("Gone Church (no longer a member of this presbytery)");
  });

  it("a stale edit is a toast with the commission wording and the form stays", async () => {
    const error = "This record was changed by someone else after you opened it. Reload the page, then make your change again.";
    actions.updateCommissionAction.mockResolvedValue({ ok: false, kind: "stale", error });
    render(<CommissionForm slug={SLUG} congregations={CONGS} today={TODAY} commission={RECORD} />);
    type("Title", "Edited");
    click("Save changes");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(error));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Edited");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("CommissionMemberForm (C15)", () => {
  const people = [
    { personId: PERSON, displayName: "Ada Lovelace", alreadyServes: false },
    { personId: "00000000-0000-4000-8000-0000000000a4", displayName: "Grace Hopper", alreadyServes: true },
  ];

  it("disables an option already serving, offers the six titles with Member selected, and words the helpers for a commission", () => {
    render(<CommissionMemberForm slug={SLUG} commissionId={KID} people={people} today={TODAY} />);
    const person = screen.getByLabelText("Person") as HTMLSelectElement;
    const hopper = Array.from(person.options).find((o) => o.text === "Grace Hopper (already serves)")!;
    expect(hopper.disabled).toBe(true);
    const role = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(Array.from(role.options).map((o) => o.text)).toEqual(["Chair", "Vice chair", "Clerk", "Secretary", "Ex officio", "Member"]);
    expect(role.value).toBe("member");
    expect(screen.getByText(/People serve on a commission from the presbytery's own records/)).toBeTruthy();
    expect(screen.getByText("The first day they are no longer on the commission. Leave it empty if the term has no set end.")).toBeTruthy();
    expect((screen.getByLabelText("Starts on") as HTMLInputElement).type).toBe("date");
    expect(screen.getByRole("button", { name: "Add to commission" })).toBeTruthy();
  });

  it("adds, toasts and returns to the commission", async () => {
    actions.addCommissionMemberAction.mockResolvedValue({ ok: true, data: { id: MID } });
    render(<CommissionMemberForm slug={SLUG} commissionId={KID} people={people} today={TODAY} />);
    type("Person", PERSON);
    click("Add to commission");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/${SLUG}/admin/committees/commissions/${KID}`));
    expect(actions.addCommissionMemberAction).toHaveBeenCalledWith(SLUG, {
      personId: PERSON,
      role: "member",
      startsOn: TODAY,
      endsOn: "",
      commissionId: KID,
    });
    expect(toastSuccess).toHaveBeenCalledWith("Added to the commission.");
  });

  it("an overlap goes under Person and the typed values stay", async () => {
    const error = "Ada Lovelace already serves on this commission during those dates. End that term first.";
    actions.addCommissionMemberAction.mockResolvedValue({ ok: false, kind: "overlap", error });
    render(<CommissionMemberForm slug={SLUG} commissionId={KID} people={people} today={TODAY} />);
    type("Person", PERSON);
    type("Role", "chair");
    click("Add to commission");
    expect(await screen.findByText(error)).toBeTruthy();
    expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("chair");
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("EndCommissionDialog (C15)", () => {
  const dialog = () => <EndCommissionDialog slug={SLUG} commissionId={KID} appointedOn="2026-03-01" today={TODAY} />;

  it("is an AlertDialog: the body, 'Ended on' defaulted to today and capped, the helper, the optional minute", () => {
    render(dialog());
    click("End commission");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("End this commission?")).toBeTruthy();
    expect(
      screen.getByText("This ends every member's term on the date you choose and records that the commission has ended. The record is kept, and it can't be reopened from this page."),
    ).toBeTruthy();
    const on = screen.getByLabelText("Ended on") as HTMLInputElement;
    expect(on.value).toBe(TODAY);
    expect(on.max).toBe(TODAY);
    expect(on.min).toBe("2026-03-01");
    expect(screen.getByText("The first day the commission no longer exists. Every member's term ends on this date. It can't be in the future.")).toBeTruthy();
    expect(screen.getByLabelText("Minute reference for its report (optional)")).toBeTruthy();
  });

  it("refuses a future date and one before the appointment in the dialog without calling the action", async () => {
    render(dialog());
    click("End commission");
    type("Ended on", "2026-12-25");
    fireEvent.click(screen.getAllByRole("button", { name: "End commission" }).at(-1)!);
    expect(await screen.findByText("The end date can't be in the future.")).toBeTruthy();
    type("Ended on", "2026-01-01");
    fireEvent.click(screen.getAllByRole("button", { name: "End commission" }).at(-1)!);
    expect(await screen.findByText(/The end date can't be before .*, when it was appointed\./)).toBeTruthy();
    expect(actions.endCommissionAction).not.toHaveBeenCalled();
  });

  it("ends the commission, toasts and refreshes; the store's date refusal stays under the field", async () => {
    actions.endCommissionAction.mockResolvedValueOnce({ ok: false, kind: "date_before_start", error: "A member started on 2026-11-01. The end date can't be before that." });
    render(dialog());
    click("End commission");
    type("Minute reference for its report (optional)", "Report received");
    fireEvent.click(screen.getAllByRole("button", { name: "End commission" }).at(-1)!);
    expect(await screen.findByText(/A member started on/)).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();

    actions.endCommissionAction.mockResolvedValueOnce({ ok: true, data: { id: KID, membersEnded: 2 } });
    fireEvent.click(screen.getAllByRole("button", { name: "End commission" }).at(-1)!);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Commission ended."));
    expect(actions.endCommissionAction).toHaveBeenLastCalledWith(SLUG, { commissionId: KID, endedOn: TODAY, endedMinuteReference: "Report received" });
    expect(refresh).toHaveBeenCalled();
  });
});

describe("RemoveRecordDialog (C15)", () => {
  it("asks first, with the mistake-only body, and does nothing until confirmed", () => {
    render(<RemoveRecordDialog slug={SLUG} commissionId={KID} />);
    click("Remove this record");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Remove this record?")).toBeTruthy();
    expect(
      screen.getByText(
        "Use this only for a record entered by mistake. It will no longer be listed here, and this page can't bring it back. To record that a commission finished, end it instead.",
      ),
    ).toBeTruthy();
    expect(actions.removeCommissionRecordAction).not.toHaveBeenCalled();
  });

  it("removes, toasts and returns to the list", async () => {
    actions.removeCommissionRecordAction.mockResolvedValue({ ok: true, data: { id: KID } });
    render(<RemoveRecordDialog slug={SLUG} commissionId={KID} />);
    click("Remove this record");
    click("Remove record");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/${SLUG}/admin/committees`));
    expect(actions.removeCommissionRecordAction).toHaveBeenCalledWith(SLUG, { commissionId: KID });
    expect(toastSuccess).toHaveBeenCalledWith("Record removed.");
  });

  it("a refusal is a toast with the fixed string and the dialog stays", async () => {
    actions.removeCommissionRecordAction.mockResolvedValue({ ok: false, kind: "not_found", error: "That commission could not be found." });
    render(<RemoveRecordDialog slug={SLUG} commissionId={KID} />);
    click("Remove this record");
    click("Remove record");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That commission could not be found."));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("EndTermDialog on a commission's member (C7 worded by C15)", () => {
  const dialog = (over: Partial<React.ComponentProps<typeof EndTermDialog>> = {}) => (
    <EndTermDialog
      slug={SLUG}
      committeeId=""
      commissionId={KID}
      membershipId={MID}
      personName="Ada Lovelace"
      mode="end"
      startsOn="2026-01-01"
      currentEndsOn={null}
      today={TODAY}
      carries={false}
      idPrefix="card"
      {...over}
    />
  );

  it("is titled 'on this commission', worded for a commission, and never mentions a committee", () => {
    render(dialog());
    click(/End term/);
    expect(screen.getByText("End Ada Lovelace's term on this commission?")).toBeTruthy();
    expect(screen.getByText("Their name stays in the history of this commission, with its dates.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/committee/i);
  });

  it("ends a member's term through the commission action, with the member id", async () => {
    actions.endCommissionMemberAction.mockResolvedValue({ ok: true, data: { id: MID } });
    render(dialog());
    click(/End term/);
    fireEvent.click(screen.getAllByRole("button", { name: "End term" }).at(-1)!);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Term ended."));
    expect(actions.endCommissionMemberAction).toHaveBeenCalledWith(SLUG, { commissionId: KID, memberId: MID, endsOn: TODAY });
  });
});
