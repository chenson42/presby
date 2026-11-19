// @vitest-environment jsdom
/**
 * U9: the committee forms and dialogs (docs/work-log/2026-11-19-presbytery-
 * committees.md, "Test plan"): each `useForm` root inside HydrationGate; the C4 to
 * C6 messages on the right field; a refused save keeps the typed values and shows
 * the fixed `copy.ts` string (a duplicate name under its field, the rest in a toast);
 * dates are `type="date"`; an "(already serves)" option is disabled; the carries
 * warning shows only when the committee carries a role.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  createCommitteeAction: vi.fn(),
  updateCommitteeAction: vi.fn(),
  addCommitteeSeatAction: vi.fn(),
  changeCommitteeSeatRoleAction: vi.fn(),
  endCommitteeSeatAction: vi.fn(),
  dissolveCommitteeAction: vi.fn(),
  setCommitteeSeatPublicListedAction: vi.fn(),
}));
vi.mock("@/app/(org)/o/[slug]/admin/committees/new/actions", () => ({
  createCommitteeAction: actions.createCommitteeAction,
}));
vi.mock("@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions", () => ({
  updateCommitteeAction: actions.updateCommitteeAction,
  addCommitteeSeatAction: actions.addCommitteeSeatAction,
  changeCommitteeSeatRoleAction: actions.changeCommitteeSeatRoleAction,
  endCommitteeSeatAction: actions.endCommitteeSeatAction,
  dissolveCommitteeAction: actions.dissolveCommitteeAction,
  setCommitteeSeatPublicListedAction: actions.setCommitteeSeatPublicListedAction,
}));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { AddMemberForm } from "./add-member-form";
import { CarriesRoleNote } from "./carries-role-note";
import { ChangeRoleForm } from "./change-role-form";
import { CommitteeForm } from "./committee-form";
import { DissolveDialog } from "./dissolve-dialog";
import { EndTermDialog } from "./end-term-dialog";
import { PublicListingToggle } from "./public-listing-toggle";

const TODAY = "2026-11-19";
const SLUG = "northern-reach";
const CID = "00000000-0000-4000-8000-000000000001";
const MID = "00000000-0000-4000-8000-000000000002";
const PERSON = "00000000-0000-4000-8000-000000000003";

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
    ["committee", () => <CommitteeForm slug={SLUG} />],
    ["add member", () => <AddMemberForm slug={SLUG} committeeId={CID} people={[]} today={TODAY} />],
    [
      "change role",
      () => (
        <ChangeRoleForm
          slug={SLUG}
          committeeId={CID}
          today={TODAY}
          seat={{ membershipId: MID, displayName: "Ada Lovelace", role: "member", startsOn: "2026-01-01", endsOn: null, publicListed: false }}
        />
      ),
    ],
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

describe("CommitteeForm (C4)", () => {
  it("shows the C4 messages on the right field and calls no action while invalid", async () => {
    render(<CommitteeForm slug={SLUG} />);
    click("Create committee");
    expect(await screen.findByText("Name is required.")).toBeTruthy();
    expect(screen.getByText("Choose Required, Standing or Ad hoc.")).toBeTruthy();
    expect(actions.createCommitteeAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Committee name").getAttribute("aria-invalid")).toBe("true");
  });

  it("offers Choose one, Required, Standing and Ad hoc, with the kind helper", () => {
    render(<CommitteeForm slug={SLUG} />);
    const options = Array.from((screen.getByLabelText("Kind") as HTMLSelectElement).options).map((o) => o.text);
    expect(options).toEqual(["Choose one", "Required", "Standing", "Ad hoc"]);
    expect(screen.getByText(/Required: a committee your presbytery has to have\./)).toBeTruthy();
  });

  it("creates, toasts and goes to the new committee's page", async () => {
    actions.createCommitteeAction.mockResolvedValue({ ok: true, data: { id: CID } });
    render(<CommitteeForm slug={SLUG} />);
    type("Committee name", "Ministry");
    type("Kind", "required");
    click("Create committee");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/${SLUG}/admin/committees/${CID}`));
    expect(actions.createCommitteeAction).toHaveBeenCalledWith(SLUG, { name: "Ministry", kind: "required", purpose: "", meetsWhen: "" });
    expect(toastSuccess).toHaveBeenCalledWith("Committee created.");
  });

  it("a duplicate name goes under the name field and keeps every typed value", async () => {
    actions.createCommitteeAction.mockResolvedValue({
      ok: false,
      kind: "duplicate_name",
      error: 'A committee named "Ministry" already exists. Choose a different name.',
    });
    render(<CommitteeForm slug={SLUG} />);
    type("Committee name", "ministry");
    type("Kind", "standing");
    type("Purpose (optional)", "Keep the calls.");
    click("Create committee");
    expect(await screen.findByText('A committee named "Ministry" already exists. Choose a different name.')).toBeTruthy();
    expect((screen.getByLabelText("Committee name") as HTMLInputElement).value).toBe("ministry");
    expect((screen.getByLabelText("Purpose (optional)") as HTMLTextAreaElement).value).toBe("Keep the calls.");
    expect(toastError).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("any other refusal is a toast with the fixed string and the form stays", async () => {
    actions.createCommitteeAction.mockResolvedValue({ ok: false, kind: "save_failed", error: "We couldn't save that. Nothing was changed. Try again." });
    render(<CommitteeForm slug={SLUG} />);
    type("Committee name", "Ministry");
    type("Kind", "required");
    click("Create committee");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't save that. Nothing was changed. Try again."));
    expect((screen.getByLabelText("Committee name") as HTMLInputElement).value).toBe("Ministry");
  });

  it("an edit starts from the stored values, offers Save changes and returns to the committee", async () => {
    actions.updateCommitteeAction.mockResolvedValue({ ok: true, data: { id: CID } });
    render(<CommitteeForm slug={SLUG} committee={{ id: CID, name: "Finance", kind: null, purpose: "", meetsWhen: "Monthly" }} />);
    expect((screen.getByLabelText("Committee name") as HTMLInputElement).value).toBe("Finance");
    expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe("");
    type("Kind", "standing");
    click("Save changes");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/${SLUG}/admin/committees/${CID}`));
    expect(actions.updateCommitteeAction).toHaveBeenCalledWith(SLUG, { committeeId: CID, name: "Finance", kind: "standing", purpose: "", meetsWhen: "Monthly" });
    expect(toastSuccess).toHaveBeenCalledWith("Committee saved.");
  });
});

describe("AddMemberForm (C5)", () => {
  const people = [
    { personId: PERSON, displayName: "Ada Lovelace", alreadyServes: false },
    { personId: "00000000-0000-4000-8000-000000000004", displayName: "Grace Hopper", alreadyServes: true },
  ];

  it("disables an option that already serves and says so; dates are native date inputs", () => {
    render(<AddMemberForm slug={SLUG} committeeId={CID} people={people} today={TODAY} />);
    const option = screen.getByRole("option", { name: "Grace Hopper (already serves)" }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect((screen.getByRole("option", { name: "Ada Lovelace" }) as HTMLOptionElement).disabled).toBe(false);
    expect((screen.getByLabelText("Starts on") as HTMLInputElement).type).toBe("date");
    expect((screen.getByLabelText("Ends on (optional)") as HTMLInputElement).type).toBe("date");
    expect((screen.getByLabelText("Starts on") as HTMLInputElement).value).toBe(TODAY);
  });

  it("offers the six titles, with Member selected, and the ex officio helper", () => {
    render(<AddMemberForm slug={SLUG} committeeId={CID} people={people} today={TODAY} />);
    const role = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(Array.from(role.options).map((o) => o.text)).toEqual(["Chair", "Vice chair", "Clerk", "Secretary", "Ex officio", "Member"]);
    expect(role.value).toBe("member");
    expect(screen.getByText(/Ex officio means serving because of another office\./)).toBeTruthy();
  });

  it("asks for a person, and rejects an end date that is not after the start", async () => {
    render(<AddMemberForm slug={SLUG} committeeId={CID} people={people} today={TODAY} />);
    click("Add to committee");
    expect(await screen.findByText("Choose a person.")).toBeTruthy();
    type("Person", PERSON);
    type("Ends on (optional)", TODAY);
    click("Add to committee");
    expect(await screen.findByText("The end date has to be after the start date.")).toBeTruthy();
    expect(actions.addCommitteeSeatAction).not.toHaveBeenCalled();
  });

  it("adds, toasts and returns to the committee", async () => {
    actions.addCommitteeSeatAction.mockResolvedValue({ ok: true, data: { id: MID } });
    render(<AddMemberForm slug={SLUG} committeeId={CID} people={people} today={TODAY} />);
    type("Person", PERSON);
    type("Role", "chair");
    click("Add to committee");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/${SLUG}/admin/committees/${CID}`));
    expect(actions.addCommitteeSeatAction).toHaveBeenCalledWith(SLUG, { personId: PERSON, role: "chair", startsOn: TODAY, endsOn: "", committeeId: CID });
    expect(toastSuccess).toHaveBeenCalledWith("Added to the committee.");
  });

  it("an overlap goes under Person and the typed values stay", async () => {
    const message = 'Ada Lovelace already serves on Ministry during those dates. Use "Change role", or end that term first.';
    actions.addCommitteeSeatAction.mockResolvedValue({ ok: false, kind: "overlap", error: message });
    render(<AddMemberForm slug={SLUG} committeeId={CID} people={people} today={TODAY} />);
    type("Person", PERSON);
    type("Role", "clerk");
    click("Add to committee");
    expect(await screen.findByText(message)).toBeTruthy();
    expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("clerk");
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("CarriesRoleNote", () => {
  it("renders nothing when no role is carried, and the C5 warning or C3 note when one is", () => {
    const { container, rerender } = render(<CarriesRoleNote roleNames={[]} variant="warning" />);
    expect(container.innerHTML).toBe("");
    rerender(<CarriesRoleNote roleNames={["Treasurer"]} variant="warning" />);
    expect(screen.getByText("This committee carries the Treasurer role. Adding someone here also gives them that role's access.")).toBeTruthy();
    rerender(<CarriesRoleNote roleNames={["Treasurer", "Auditor"]} variant="note" />);
    expect(screen.getByText("Everyone serving on this committee also holds these roles: Treasurer, Auditor. Adding someone here gives them their access.")).toBeTruthy();
  });
});

describe("ChangeRoleForm (C6)", () => {
  const seat = { membershipId: MID, displayName: "Ada Lovelace", role: "chair" as const, startsOn: "2026-01-01", endsOn: "2027-06-30", publicListed: true };

  it("offers the six titles without the current one, and says no gap, the kept end date and the public listing", () => {
    render(<ChangeRoleForm slug={SLUG} committeeId={CID} seat={seat} today={TODAY} />);
    const options = Array.from((screen.getByLabelText("New role") as HTMLSelectElement).options).map((o) => o.text);
    expect(options).toEqual(["Choose a different role", "Vice chair", "Clerk", "Secretary", "Ex officio", "Member"]);
    expect((screen.getByLabelText("Effective on") as HTMLInputElement).type).toBe("date");
    const hint = screen.getByText(/The new role starts on this date and the old role ends the same day, so there is no gap\./);
    expect(hint.textContent).toContain("The new role keeps the same end date, Jun 30, 2027.");
    expect(hint.textContent).toContain("Ada Lovelace is listed on the public website, and the new role title will show there.");
  });

  it("a date before the seat began or on or after its end is refused on the field", async () => {
    render(<ChangeRoleForm slug={SLUG} committeeId={CID} seat={seat} today={TODAY} />);
    type("New role", "clerk");
    type("Effective on", "2025-12-31");
    click("Change role");
    expect(await screen.findByText("The effective date can't be before Jan 1, 2026, when this role began.")).toBeTruthy();
    type("Effective on", "2027-06-30");
    click("Change role");
    expect(await screen.findByText("The effective date has to be before this term ends on Jun 30, 2027.")).toBeTruthy();
    expect(actions.changeCommitteeSeatRoleAction).not.toHaveBeenCalled();
  });

  it("changes the role, sending the role the form was opened on, and returns to the committee", async () => {
    actions.changeCommitteeSeatRoleAction.mockResolvedValue({ ok: true, data: { id: MID } });
    render(<ChangeRoleForm slug={SLUG} committeeId={CID} seat={seat} today={TODAY} />);
    type("New role", "clerk");
    click("Change role");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/${SLUG}/admin/committees/${CID}`));
    expect(actions.changeCommitteeSeatRoleAction).toHaveBeenCalledWith(SLUG, {
      newRole: "clerk",
      effectiveOn: TODAY,
      committeeId: CID,
      membershipId: MID,
      expectedRole: "chair",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Role changed.");
  });

  it("a stale form is a toast and the form stays", async () => {
    actions.changeCommitteeSeatRoleAction.mockResolvedValue({
      ok: false,
      kind: "stale",
      error: "This seat was changed by someone else after you opened it. Reload the page, then try again.",
    });
    render(<ChangeRoleForm slug={SLUG} committeeId={CID} seat={seat} today={TODAY} />);
    type("New role", "clerk");
    click("Change role");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This seat was changed by someone else after you opened it. Reload the page, then try again."));
    expect((screen.getByLabelText("New role") as HTMLSelectElement).value).toBe("clerk");
  });

  it("starts the effective date on the seat's own start for a seat that has not begun", () => {
    render(<ChangeRoleForm slug={SLUG} committeeId={CID} seat={{ ...seat, startsOn: "2026-12-19", endsOn: null }} today={TODAY} />);
    expect((screen.getByLabelText("Effective on") as HTMLInputElement).value).toBe("2026-12-19");
  });
});

describe("EndTermDialog (C7)", () => {
  const base = { slug: SLUG, committeeId: CID, membershipId: MID, personName: "Ada Lovelace", startsOn: "2026-01-01", currentEndsOn: null, today: TODAY, carries: false, idPrefix: "t" };

  it("is an AlertDialog: End term, the body, a defaulted date field and the helper", () => {
    render(<EndTermDialog {...base} mode="end" />);
    fireEvent.click(screen.getByRole("button", { name: /End term/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("End Ada Lovelace's term?")).toBeTruthy();
    expect(within(dialog).getByText("Their name stays in the history of this committee, with its dates.")).toBeTruthy();
    expect((within(dialog).getByLabelText("Ends on") as HTMLInputElement).value).toBe(TODAY);
    expect(within(dialog).getByText(/To record their last day of service, enter the day after it\./)).toBeTruthy();
    expect(within(dialog).queryByText(/also ends the access/)).toBeNull();
  });

  it("says the access ends when the committee carries a role", () => {
    render(<EndTermDialog {...base} mode="end" carries />);
    fireEvent.click(screen.getByRole("button", { name: /End term/ }));
    expect(screen.getByText("Ending the term also ends the access that comes from belonging to this committee.")).toBeTruthy();
  });

  it("ends the term and toasts; a date before the start stays in the dialog under the field", async () => {
    actions.endCommitteeSeatAction.mockResolvedValue({ ok: true, data: { id: MID } });
    render(<EndTermDialog {...base} mode="end" />);
    fireEvent.click(screen.getByRole("button", { name: /End term/ }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Ends on"), { target: { value: "2025-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "End term" }));
    expect(await within(dialog).findByText("The end date can't be before the start date.")).toBeTruthy();
    expect(actions.endCommitteeSeatAction).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Ends on"), { target: { value: "2026-11-25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "End term" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Term ended."));
    expect(actions.endCommitteeSeatAction).toHaveBeenCalledWith(SLUG, { committeeId: CID, membershipId: MID, endsOn: "2026-11-25" });
    expect(refresh).toHaveBeenCalled();
  });

  it("a seat with a planned end offers Change end date, starting from that date", () => {
    render(<EndTermDialog {...base} mode="change" currentEndsOn="2027-01-31" />);
    fireEvent.click(screen.getByRole("button", { name: /Change end date/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Change when Ada Lovelace's term ends")).toBeTruthy();
    expect((within(dialog).getByLabelText("Ends on") as HTMLInputElement).value).toBe("2027-01-31");
    expect(within(dialog).getByRole("button", { name: "Save end date" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Go back" })).toBeTruthy();
  });

  it("a seat that has not started has no date field and sends an empty end date", async () => {
    actions.endCommitteeSeatAction.mockResolvedValue({ ok: true, data: { id: MID, cancelled: true } });
    render(<EndTermDialog {...base} mode="cancel" startsOn="2026-12-19" />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel planned term/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Cancel Ada Lovelace's planned term?")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Ends on")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel planned term" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Planned term cancelled."));
    expect(actions.endCommitteeSeatAction).toHaveBeenCalledWith(SLUG, { committeeId: CID, membershipId: MID, endsOn: "" });
  });
});

describe("DissolveDialog (C8)", () => {
  const base = { slug: SLUG, committeeId: CID, committeeName: "Ministry", carriedRoleNames: [] as string[], today: TODAY };

  it("says what dissolving does, that it can't be undone from this page, and caps the date at today", () => {
    render(<DissolveDialog {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Dissolve committee" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Dissolve Ministry?")).toBeTruthy();
    expect(within(dialog).getByText(/it can't be undone from this page\. The roster is kept as history\./)).toBeTruthy();
    const field = within(dialog).getByLabelText("Dissolved on") as HTMLInputElement;
    expect(field.value).toBe(TODAY);
    expect(field.max).toBe(TODAY);
    expect(within(dialog).queryByText(/carries the/)).toBeNull();
  });

  it("names the carried role", () => {
    render(<DissolveDialog {...base} carriedRoleNames={["Treasurer"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Dissolve committee" }));
    expect(screen.getByText("This committee carries the Treasurer role. Dissolving it ends the access that comes from belonging to it.")).toBeTruthy();
  });

  it("refuses a future date in the dialog without calling the action", async () => {
    render(<DissolveDialog {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Dissolve committee" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Dissolved on"), { target: { value: "2026-12-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dissolve committee" }));
    expect(await within(dialog).findByText("The dissolve date can't be in the future.")).toBeTruthy();
    expect(actions.dissolveCommitteeAction).not.toHaveBeenCalled();
  });

  it("shows the store's date-before-a-member-started refusal under the field, and dissolves on success", async () => {
    actions.dissolveCommitteeAction.mockResolvedValueOnce({
      ok: false,
      kind: "date_before_start",
      error: "A member started on Nov 1, 2026. The dissolve date can't be before that.",
    });
    render(<DissolveDialog {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Dissolve committee" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dissolve committee" }));
    expect(await within(dialog).findByText("A member started on Nov 1, 2026. The dissolve date can't be before that.")).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
    actions.dissolveCommitteeAction.mockResolvedValueOnce({ ok: true, data: { id: CID, seatsEnded: 3 } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dissolve committee" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Committee dissolved."));
    expect(actions.dissolveCommitteeAction).toHaveBeenLastCalledWith(SLUG, { committeeId: CID, dissolvedOn: TODAY });
  });
});

describe("PublicListingToggle (copied strings)", () => {
  it("asks before listing, with the groups admin's consent text, and toasts the C3 sentence", async () => {
    actions.setCommitteeSeatPublicListedAction.mockResolvedValue({ ok: true, data: { id: MID, publicListed: true } });
    render(
      <PublicListingToggle
        action={actions.setCommitteeSeatPublicListedAction}
        slug={SLUG}
        committeeId={CID}
        membershipId={MID}
        committeeName="Ministry"
        personName="Ada Lovelace"
        publicListed={false}
      />,
    );
    expect(screen.getByText("List Ada Lovelace publicly on Ministry's public roster, currently off")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("List Ada Lovelace publicly on Ministry's roster?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, list publicly" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Ada Lovelace is now listed publicly on Ministry's roster."));
    expect(actions.setCommitteeSeatPublicListedAction).toHaveBeenCalledWith(SLUG, { committeeId: CID, membershipId: MID, publicListed: true });
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("turning it off keeps the not-a-full-retraction caveat", () => {
    render(
      <PublicListingToggle action={actions.setCommitteeSeatPublicListedAction} slug={SLUG} committeeId={CID} membershipId={MID} committeeName="Ministry" personName="Ada Lovelace" publicListed />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText(/turning this off is not a full retraction/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, stop listing" })).toBeTruthy();
  });
});
