// @vitest-environment jsdom
/**
 * The authoring forms and dialogs (Copy G3, G4): each is inside the HydrationGate, posts
 * exactly the shape the action expects (no organization or person from the client beyond
 * the ids the page rendered), shows the server's sentence inline, and confirms every
 * destructive step in an AlertDialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push, replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
  createTeamAction: vi.fn(),
  adoptTeamAction: vi.fn(),
  retireTeamAction: vi.fn(),
  addPositionAction: vi.fn(),
  updatePositionAction: vi.fn(),
  retirePositionAction: vi.fn(),
  setQualificationsAction: vi.fn(),
  addTeamMemberAction: vi.fn(),
  endTeamMemberAction: vi.fn(),
  searchRosterCandidatesAction: vi.fn(),
  createServiceTypeAction: vi.fn(),
  updateServiceTypeAction: vi.fn(),
  retireServiceTypeAction: vi.fn(),
  createServiceAction: vi.fn(),
  generateServicesAction: vi.fn(),
  updateServiceAction: vi.fn(),
  cancelServiceAction: vi.fn(),
  setServiceTeamsAction: vi.fn(),
}));
vi.mock("./actions", () => actions);

import { ACTION_COPY, SERVICES_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { TeamForm } from "./teams/new/team-form";
import { ExistingGroupForm } from "./teams/new/existing-group-form";
import { PositionForm } from "./teams/[groupId]/position-form";
import { PositionRow } from "./teams/[groupId]/position-row";
import { PeopleEditor } from "./teams/[groupId]/people-editor";
import { RetireTeamDialog } from "./teams/[groupId]/retire-team-dialog";
import { ServiceTypeForm } from "./service-types/service-type-form";
import { ServiceForm } from "./services/service-form";
import { GenerateForm } from "./services/generate-form";
import { CancelServiceDialog } from "./services/[eventId]/cancel-service-dialog";
import { ServiceTeamsEditor } from "./services/[eventId]/service-teams-editor";

const G = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  for (const m of [refresh, push, toast.success, toast.error, ...Object.values(actions)]) m.mockReset();
});
afterEach(cleanup);

const gated = (container: HTMLElement) => expect(container.querySelector("fieldset[data-slot='hydration-gate']")).toBeTruthy();

describe("TeamForm", () => {
  it("is gated; posts name, kind and starter; goes to the new team", async () => {
    actions.createTeamAction.mockResolvedValue({ ok: true, data: { groupId: G } });
    const { container } = render(<TeamForm slug="alder" />);
    gated(container);
    expect(Array.from((screen.getByLabelText(TEAMS_COPY.form.startWithLabel) as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "Praise band", "Choir", "Liturgical team", "Ushers", "Greeters", "Sound and projection", "None, I'll add my own",
    ]);
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.form.nameLabel), { target: { value: "Sunday Band" } });
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.form.kindLabel), { target: { value: "choir" } });
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.form.startWithLabel), { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: TEAMS_COPY.form.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TEAMS_COPY.form.toast));
    expect(actions.createTeamAction).toHaveBeenCalledWith("alder", { name: "Sunday Band", kind: "choir", starter: "none" });
    expect(push).toHaveBeenCalledWith(`/o/alder/admin/worship/teams/${G}`);
  });

  it("shows the server's sentence inline against the field", async () => {
    actions.createTeamAction.mockResolvedValue({ ok: false, error: TEAMS_COPY.validation.nameTooLong });
    render(<TeamForm slug="alder" />);
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.form.nameLabel), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: TEAMS_COPY.form.submit }));
    await waitFor(() => expect(screen.getByText(TEAMS_COPY.validation.nameTooLong)).toBeTruthy());
    expect(screen.getByLabelText(TEAMS_COPY.form.nameLabel).getAttribute("aria-invalid")).toBe("true");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("ExistingGroupForm", () => {
  it("adopts the chosen group", async () => {
    actions.adoptTeamAction.mockResolvedValue({ ok: true, data: { groupId: "g9" } });
    const { container } = render(<ExistingGroupForm slug="alder" groups={[{ groupId: "g9", name: "Handbell Choir", kind: "choir" }]} />);
    gated(container);
    fireEvent.click(screen.getByRole("button", { name: TEAMS_COPY.form.existingSubmit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TEAMS_COPY.form.existingToast));
    expect(actions.adoptTeamAction).toHaveBeenCalledWith("alder", { groupId: "g9" });
  });
});

describe("PositionForm and PositionRow", () => {
  it("adds a position: the slots go as a number", async () => {
    actions.addPositionAction.mockResolvedValue({ ok: true, data: { positionId: "p" } });
    const { container } = render(<PositionForm slug="alder" groupId={G} />);
    gated(container);
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.page.positionNameLabel), { target: { value: "Drums" } });
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.page.slotsLabel), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: TEAMS_COPY.page.addPosition }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TEAMS_COPY.page.positionAdded));
    expect(actions.addPositionAction).toHaveBeenCalledWith("alder", { groupId: G, name: "Drums", slots: 2 });
  });

  it("a duplicate name is the Copy sentence, inline", async () => {
    actions.addPositionAction.mockResolvedValue({ ok: false, error: TEAMS_COPY.validation.positionDuplicate("Drums") });
    render(<PositionForm slug="alder" groupId={G} />);
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.page.positionNameLabel), { target: { value: "drums" } });
    fireEvent.click(screen.getByRole("button", { name: TEAMS_COPY.page.addPosition }));
    await waitFor(() => expect(screen.getByText("You already have a position called Drums on this team.")).toBeTruthy());
  });

  const position = { id: "pos1", name: "Vocals", slots: 2, sortOrder: 1 };

  it("Rename and Change number each change only their own field", async () => {
    actions.updatePositionAction.mockResolvedValue({ ok: true, data: { positionId: "pos1" } });
    render(<ul><PositionRow slug="alder" groupId={G} position={position} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: TEAMS_COPY.page.rename }));
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.page.positionNameLabel), { target: { value: "Lead vocals" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.updatePositionAction).toHaveBeenCalledWith("alder", { positionId: "pos1", name: "Lead vocals", slots: 2 }));
    await waitFor(() => expect(screen.getByRole("button", { name: TEAMS_COPY.page.changeNumber })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: TEAMS_COPY.page.changeNumber }));
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.page.slotsLabel), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.updatePositionAction).toHaveBeenLastCalledWith("alder", { positionId: "pos1", name: "Vocals", slots: 3 }));
  });

  it("Retire asks first; Cancel retires nothing; the refusal for a position still scheduled is toasted", async () => {
    render(<ul><PositionRow slug="alder" groupId={G} position={position} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${TEAMS_COPY.page.retire}`) }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(TEAMS_COPY.retirePositionDialog.title("Vocals"));
    fireEvent.click(within(dialog).getByRole("button", { name: TEAMS_COPY.retirePositionDialog.cancel }));
    expect(actions.retirePositionAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${TEAMS_COPY.page.retire}`) }));
    actions.retirePositionAction.mockResolvedValue({ ok: false, error: ACTION_COPY.inUse("Vocals", 2) });
    fireEvent.click(screen.getByTestId("retire-position-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Vocals is still scheduled for 2 upcoming services. Remove those people first."));
  });
});

describe("PeopleEditor", () => {
  const positions = [{ id: "pos1", name: "Vocals", slots: 2, sortOrder: 1 }, { id: "pos2", name: "Keys", slots: 1, sortOrder: 2 }];
  const people = [
    { groupMembershipId: "m1", personId: "p1", displayName: "Tobias Renwick", role: "leader" as const, positionIds: [] },
    { groupMembershipId: "m2", personId: "p2", displayName: "Wren Thackeray", role: "member" as const, positionIds: ["pos1"] },
  ];
  const view = (retired = false) => render(<PeopleEditor slug="alder" groupId={G} teamName="Sunday Band" positions={positions} people={people} retired={retired} />);

  it("saves 'Can fill:' as the ticked positions", async () => {
    actions.setQualificationsAction.mockResolvedValue({ ok: true, data: { added: 1, ended: 0 } });
    view();
    const card = screen.getAllByTestId("roster-person")[1]!;
    fireEvent.click(within(card).getByRole("button", { name: /^Can fill/ }));
    expect((within(card).getByLabelText("Vocals") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(card).getByLabelText("Keys"));
    fireEvent.click(within(card).getByRole("button", { name: TEAMS_COPY.page.saveQualifications }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TEAMS_COPY.page.qualificationsSaved));
    expect(actions.setQualificationsAction).toHaveBeenCalledWith("alder", { groupId: G, personId: "p2", positionIds: ["pos1", "pos2"] });
  });

  it("Remove from team confirms with the Copy title and body, and ends exactly that membership", async () => {
    actions.endTeamMemberAction.mockResolvedValue({ ok: true, data: { changed: true } });
    view();
    const card = screen.getAllByTestId("roster-person")[1]!;
    fireEvent.click(within(card).getByRole("button", { name: new RegExp(TEAMS_COPY.page.removeFromTeam) }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Remove Wren Thackeray from Sunday Band?");
    expect(dialog.textContent).toContain(TEAMS_COPY.removeDialog.body);
    fireEvent.click(screen.getByTestId("remove-member-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TEAMS_COPY.removeDialog.toast));
    expect(actions.endTeamMemberAction).toHaveBeenCalledWith("alder", { groupId: G, groupMembershipId: "m2" });
  });

  it("a leader cannot be removed here (they are changed under Groups)", () => {
    view();
    expect(within(screen.getAllByTestId("roster-person")[0]!).queryByRole("button", { name: new RegExp(TEAMS_COPY.page.removeFromTeam) })).toBeNull();
  });

  it("search needs two letters, lists names only, and Add puts that person on the team", async () => {
    actions.searchRosterCandidatesAction.mockResolvedValue({ ok: true, data: [{ personId: "p9", displayName: "Priya Balakrishnan" }] });
    actions.addTeamMemberAction.mockResolvedValue({ ok: true, data: { changed: true } });
    view();
    const box = screen.getByLabelText(TEAMS_COPY.page.addPersonLabel);
    expect(box.getAttribute("placeholder")).toBe(TEAMS_COPY.page.searchPlaceholder);
    fireEvent.change(box, { target: { value: "p" } });
    expect(actions.searchRosterCandidatesAction).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "pr" } });
    const results = await screen.findByTestId("roster-results");
    expect(actions.searchRosterCandidatesAction).toHaveBeenCalledWith("alder", { groupId: G, q: "pr" });
    fireEvent.click(within(results).getByRole("button", { name: /Add/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(TEAMS_COPY.page.personAdded));
    expect(actions.addTeamMemberAction).toHaveBeenCalledWith("alder", { groupId: G, personId: "p9" });
  });

  it("a role-bound refusal is toasted in the store's words", async () => {
    actions.searchRosterCandidatesAction.mockResolvedValue({ ok: true, data: [{ personId: "p9", displayName: "Priya" }] });
    actions.addTeamMemberAction.mockResolvedValue({ ok: false, error: ACTION_COPY.roleBound });
    view();
    fireEvent.change(screen.getByLabelText(TEAMS_COPY.page.addPersonLabel), { target: { value: "pr" } });
    fireEvent.click(within(await screen.findByTestId("roster-results")).getByRole("button", { name: /Add/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ACTION_COPY.roleBound));
  });

  it("a retired team shows people and nothing to change", () => {
    view(true);
    expect(screen.queryByTestId("add-person")).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(TEAMS_COPY.page.removeFromTeam) })).toBeNull();
  });
});

describe("RetireTeamDialog", () => {
  it("asks with the Copy sentence; a team still scheduled is refused in the store's words", async () => {
    render(<RetireTeamDialog slug="alder" groupId={G} teamName="Sunday Band" />);
    fireEvent.click(screen.getByTestId("retire-team-open"));
    expect(screen.getByRole("alertdialog").textContent).toContain("Retire Sunday Band?");
    actions.retireTeamAction.mockResolvedValue({ ok: false, error: ACTION_COPY.inUse("Sunday Band", 1) });
    fireEvent.click(screen.getByTestId("retire-team-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sunday Band is still scheduled for 1 upcoming service. Remove those people first."));
    expect(actions.retireTeamAction).toHaveBeenCalledWith("alder", { groupId: G });
  });
});

describe("ServiceTypeForm", () => {
  const teams = [{ groupId: G, name: "Sunday Band" }];

  it("creates a type with the usual time, length, place and teams", async () => {
    actions.createServiceTypeAction.mockResolvedValue({ ok: true, data: { serviceTypeId: "t" } });
    const { container } = render(<ServiceTypeForm slug="alder" teams={teams} />);
    gated(container);
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.types.nameLabel), { target: { value: "Sunday worship" } });
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.types.lastsLabel), { target: { value: "75" } });
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.types.whereLabel), { target: { value: "Sanctuary" } });
    fireEvent.click(screen.getByLabelText("Sunday Band"));
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.types.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(SERVICES_COPY.types.toast));
    expect(actions.createServiceTypeAction).toHaveBeenCalledWith("alder", {
      name: "Sunday worship", startTime: "10:00", durationMinutes: 75, location: "Sanctuary", groupIds: [G],
    });
  });

  it("editing posts the id and a blank length and place as null", async () => {
    actions.updateServiceTypeAction.mockResolvedValue({ ok: true, data: { serviceTypeId: "t1" } });
    render(
      <ServiceTypeForm
        slug="alder"
        teams={teams}
        existing={{ id: "t1", name: "Evening", startTime: "18:00", durationMinutes: null, location: null, retired: false, teamIds: [] }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.types.submit }));
    await waitFor(() =>
      expect(actions.updateServiceTypeAction).toHaveBeenCalledWith("alder", {
        serviceTypeId: "t1", name: "Evening", startTime: "18:00", durationMinutes: null, location: null, groupIds: [],
      }),
    );
  });

  it("a duplicate name is the Copy sentence, inline", async () => {
    actions.createServiceTypeAction.mockResolvedValue({ ok: false, error: SERVICES_COPY.types.duplicate("Evening") });
    render(<ServiceTypeForm slug="alder" teams={teams} />);
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.types.nameLabel), { target: { value: "Evening" } });
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.types.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("You already have a service type called Evening."));
  });
});

describe("ServiceForm", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.form.titleLabel), { target: { value: "Sunday worship" } });
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.form.dateLabel), { target: { value: "2027-01-10" } });
  };

  it("adds a service with wall-clock start, optional end and the ticked teams", async () => {
    actions.createServiceAction.mockResolvedValue({ ok: true, data: { created: true, eventId: E } });
    const { container } = render(<ServiceForm slug="alder" mode="create" teams={[{ groupId: G, name: "Sunday Band" }]} />);
    gated(container);
    fill();
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.form.endsAtLabel), { target: { value: "11:15" } });
    fireEvent.click(screen.getByLabelText("Sunday Band"));
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.form.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(SERVICES_COPY.form.toast));
    expect(actions.createServiceAction).toHaveBeenCalledWith("alder", {
      title: "Sunday worship", startsAt: "2027-01-10T10:00", endsAt: "2027-01-10T11:15", groupIds: [G], allowDuplicate: false,
    });
    expect(push).toHaveBeenCalledWith(`/o/alder/admin/worship/services/${E}`);
  });

  it("a service at the same minute: the hint, nothing created, 'Add it anyway' resends with allowDuplicate", async () => {
    actions.createServiceAction.mockResolvedValueOnce({ ok: true, data: { created: false, duplicate: { eventId: "e0", title: "Early service" } } });
    render(<ServiceForm slug="alder" mode="create" teams={[]} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.form.submit }));
    const hint = await screen.findByTestId("service-duplicate");
    expect(hint.textContent).toContain("There's already a service at that time: Early service.");
    expect(push).not.toHaveBeenCalled();
    actions.createServiceAction.mockResolvedValueOnce({ ok: true, data: { created: true, eventId: E } });
    fireEvent.click(within(hint).getByRole("button", { name: SERVICES_COPY.form.duplicateConfirm }));
    await waitFor(() => expect(actions.createServiceAction).toHaveBeenLastCalledWith("alder", expect.objectContaining({ allowDuplicate: true })));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("'Cancel' on the hint adds nothing", async () => {
    actions.createServiceAction.mockResolvedValueOnce({ ok: true, data: { created: false, duplicate: { eventId: "e0", title: "Early service" } } });
    render(<ServiceForm slug="alder" mode="create" teams={[]} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.form.submit }));
    const hint = await screen.findByTestId("service-duplicate");
    fireEvent.click(within(hint).getByRole("button", { name: SERVICES_COPY.form.duplicateCancel }));
    expect(screen.queryByTestId("service-duplicate")).toBeNull();
    expect(actions.createServiceAction).toHaveBeenCalledTimes(1);
  });

  it("edit prefills the time and place and sends null for an emptied place", async () => {
    actions.updateServiceAction.mockResolvedValue({ ok: true, data: { eventId: E } });
    const onDone = vi.fn();
    render(
      <ServiceForm
        slug="alder"
        mode="edit"
        onDone={onDone}
        existing={{ eventId: E, title: "Sunday worship", startsAt: "2027-01-10T10:00", endsAt: null, location: "Sanctuary" }}
      />,
    );
    expect((screen.getByLabelText(SERVICES_COPY.form.startsAtLabel) as HTMLInputElement).value).toBe("10:00");
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.form.whereLabel), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(SERVICES_COPY.page.editToast));
    expect(actions.updateServiceAction).toHaveBeenCalledWith("alder", { eventId: E, title: "Sunday worship", startsAt: "2027-01-10T10:00", location: null });
    expect(onDone).toHaveBeenCalled();
  });
});

describe("GenerateForm", () => {
  it("adds several: type, first date, repeat, count", async () => {
    actions.generateServicesAction.mockResolvedValue({ ok: true, data: { eventIds: ["a", "b", "c"] } });
    const { container } = render(<GenerateForm slug="alder" types={[{ id: "t1", name: "Sunday worship" }]} />);
    gated(container);
    expect(Array.from((screen.getByLabelText(SERVICES_COPY.several.repeatLabel) as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "Weekly", "Every 2 weeks", "Monthly (same date)",
    ]);
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.several.firstDateLabel), { target: { value: "2027-01-03" } });
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.several.repeatLabel), { target: { value: "biweekly" } });
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.several.countLabel), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.several.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("3 services added."));
    expect(actions.generateServicesAction).toHaveBeenCalledWith("alder", { serviceTypeId: "t1", firstDate: "2027-01-03", pattern: "biweekly", count: 3 });
  });

  it("too many is the server's sentence, inline", async () => {
    actions.generateServicesAction.mockResolvedValue({ ok: false, error: SERVICES_COPY.several.tooMany });
    render(<GenerateForm slug="alder" types={[{ id: "t1", name: "Sunday worship" }]} />);
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.several.firstDateLabel), { target: { value: "2027-01-03" } });
    fireEvent.change(screen.getByLabelText(SERVICES_COPY.several.countLabel), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.several.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("You can add up to 26 at a time."));
  });
});

describe("CancelServiceDialog", () => {
  it("states what a cancel does; 'Keep it' cancels nothing; 'Cancel service' does", async () => {
    actions.cancelServiceAction.mockResolvedValue({ ok: true, data: { changed: true } });
    render(<CancelServiceDialog slug="alder" eventId={E} />);
    fireEvent.click(screen.getByTestId("cancel-service-open"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(SERVICES_COPY.cancelDialog.title);
    expect(dialog.textContent).toContain(SERVICES_COPY.cancelDialog.body);
    fireEvent.click(within(dialog).getByRole("button", { name: SERVICES_COPY.cancelDialog.keep }));
    expect(actions.cancelServiceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("cancel-service-open"));
    fireEvent.click(screen.getByTestId("cancel-service-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(SERVICES_COPY.cancelDialog.toast));
    expect(actions.cancelServiceAction).toHaveBeenCalledWith("alder", { eventId: E });
  });
});

describe("ServiceTeamsEditor", () => {
  const all = [{ groupId: G, name: "Sunday Band" }, { groupId: "g2", name: "Chancel Choir" }];

  it("Add a team sends the whole new list; Remove sends it without that team", async () => {
    actions.setServiceTeamsAction.mockResolvedValue({ ok: true, data: { eventId: E } });
    render(<ServiceTeamsEditor slug="alder" eventId={E} serving={[all[0]!]} allTeams={all} />);
    fireEvent.click(screen.getByRole("button", { name: SERVICES_COPY.page.addTeam }));
    await waitFor(() => expect(actions.setServiceTeamsAction).toHaveBeenCalledWith("alder", { eventId: E, groupIds: [G, "g2"] }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SERVICES_COPY.page.removeTeam) }));
    await waitFor(() => expect(actions.setServiceTeamsAction).toHaveBeenLastCalledWith("alder", { eventId: E, groupIds: [] }));
  });

  it("a team with a live assignment cannot be removed: the store's sentence is toasted", async () => {
    actions.setServiceTeamsAction.mockResolvedValue({ ok: false, error: ACTION_COPY.inUse("Sunday Band", 1) });
    render(<ServiceTeamsEditor slug="alder" eventId={E} serving={[all[0]!]} allTeams={[all[0]!]} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SERVICES_COPY.page.removeTeam) }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sunday Band is still scheduled for 1 upcoming service. Remove those people first."));
  });
});

describe("destructive confirms use the destructive variant", () => {
  it.each([
    ["cancel service", () => { render(<CancelServiceDialog slug="alder" eventId={E} />); fireEvent.click(screen.getByTestId("cancel-service-open")); return "cancel-service-confirm"; }],
    ["retire team", () => { render(<RetireTeamDialog slug="alder" groupId={G} teamName="Band" />); fireEvent.click(screen.getByTestId("retire-team-open")); return "retire-team-confirm"; }],
  ])("%s", (_n, open) => {
    expect(screen.getByTestId(open()).className).toContain("bg-destructive");
  });
});
