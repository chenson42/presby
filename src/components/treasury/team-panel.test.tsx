// @vitest-environment jsdom
/**
 * The shared treasury team panel (Copy C9, F296, EC31; the Batch 6 chrome strings
 * are `COPY.team.panel`). Pinned: who holds a role by name, End only where the page
 * may end the grant (an AlertDialog, never a native confirm), the set-up buttons by
 * Copy's names with the clerk's description, the grant form's HydrationGate and its
 * refusals, and that nothing is sent without a deliberate choice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { COPY } from "@/lib/reimbursement/copy";
import { TeamPanel, type TeamData } from "./team-panel";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const GR = "44444444-4444-4444-8444-444444444444";

const grant = vi.fn();
const revoke = vi.fn();
const ensure = vi.fn();

function team(over: Partial<TeamData> = {}): TeamData {
  return {
    kind: "ok",
    grants: [
      { grantId: GR, roleId: R1, roleKey: "treasurer", roleName: "Treasurer", grantee: { kind: "person", personId: P1, displayName: "Rowan Pell" }, startsOn: "2026-01-02", ownKeys: ["reimbursement.manage"], endableHere: true },
      { grantId: R2, roleId: R2, roleKey: "custom", roleName: "Custom", grantee: { kind: "group", groupName: "Finance Team" }, startsOn: "2026-02-03", ownKeys: ["reimbursement.view"], endableHere: false },
    ],
    assignableRoles: [{ id: R1, key: "treasurer", name: "Treasurer", ownKeys: ["reimbursement.manage"] }],
    people: [{ personId: P1, displayName: "Pat Quill" }],
    missingTemplates: [],
    ...over,
  };
}
const panel = (t: TeamData) => (
  <TeamPanel
    team={t}
    setupLabels={{ treasurer: COPY.team.setUpTreasurer, reimbursement_clerk: COPY.team.setUpClerk }}
    setupDescriptions={{ reimbursement_clerk: COPY.team.clerkDescription }}
    grant={grant}
    revoke={revoke}
    ensure={ensure}
  />
);

let confirmSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const m of [refresh, push, toast.success, toast.error, grant, revoke, ensure]) m.mockReset();
  confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
});
afterEach(() => {
  cleanup();
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

describe("TeamPanel - who holds a role", () => {
  it("lists people by name and groups with '(group)', the role and 'since <date>'", () => {
    render(panel(team()));
    const rows = screen.getAllByTestId("team-row");
    expect(rows[0]!.textContent).toContain("Rowan Pell");
    expect(rows[0]!.textContent).toContain("Treasurer");
    expect(rows[0]!.textContent).toContain("since");
    expect(rows[1]!.textContent).toContain("Finance Team (group)");
    expect(screen.getByRole("heading", { name: COPY.team.sectionHolders })).toBeTruthy();
  });

  it("End this role only where the page may end it; elsewhere it says to use Roles", () => {
    render(panel(team()));
    const rows = screen.getAllByTestId("team-row");
    expect(within(rows[0]!).getByRole("button", { name: COPY.team.panel.endButton })).toBeTruthy();
    expect(within(rows[1]!).queryByRole("button")).toBeNull();
    expect(rows[1]!.textContent).toContain(COPY.team.panel.managedUnderRoles);
  });

  it("End asks in an AlertDialog, then posts the grant id", async () => {
    revoke.mockResolvedValue({ ok: true, data: undefined });
    render(panel(team()));
    fireEvent.click(screen.getByTestId("team-end-open"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(COPY.team.panel.endTitle("Rowan Pell", "Treasurer"))).toBeTruthy();
    expect(dialog.textContent).toContain(COPY.team.panel.endBody);
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("team-end-confirm"));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ grantId: GR }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Rowan Pell no longer has this role."));
    expect(refresh).toHaveBeenCalled();
  });

  it("the last-manager refusal is shown as the action words it", async () => {
    revoke.mockResolvedValue({ ok: false, error: COPY.team.lastManager });
    render(panel(team()));
    fireEvent.click(screen.getByTestId("team-end-open"));
    fireEvent.click(screen.getByTestId("team-end-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.team.lastManager));
  });
});

describe("TeamPanel - roles to set up", () => {
  it("appears only when a template is missing, with Copy's button names and the clerk's description", () => {
    render(panel(team()));
    expect(screen.queryByRole("heading", { name: COPY.team.sectionSetup })).toBeNull();
    cleanup();
    render(panel(team({ missingTemplates: ["reimbursement_clerk"] })));
    expect(screen.getByRole("heading", { name: COPY.team.sectionSetup })).toBeTruthy();
    expect(screen.getByText(COPY.team.panel.setupIntroOne)).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.team.setUpClerk })).toBeTruthy();
    expect(screen.getByText(COPY.team.clerkDescription)).toBeTruthy();
    expect(screen.queryByRole("button", { name: COPY.team.setUpTreasurer })).toBeNull();
  });

  it("posts the template key; a role set up without keys the viewer lacks says which", async () => {
    ensure.mockResolvedValue({ ok: true, data: { roleId: R1, skippedKeys: ["reimbursement.pay"] } });
    render(panel(team({ missingTemplates: ["treasurer"] })));
    fireEvent.click(screen.getByRole("button", { name: COPY.team.setUpTreasurer }));
    await waitFor(() => expect(ensure).toHaveBeenCalledWith({ templateKey: "treasurer" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Role set up, without reimbursement.pay (you don't hold it yourself)."),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the action's refusal (the role exists with keys outside the treasury modules)", async () => {
    ensure.mockResolvedValue({ ok: false, error: COPY.team.ensureNotTreasuryOnly });
    render(panel(team({ missingTemplates: ["treasurer"] })));
    fireEvent.click(screen.getByRole("button", { name: COPY.team.setUpTreasurer }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.team.ensureNotTreasuryOnly));
  });
});

describe("TeamPanel - give a role", () => {
  it("is rooted in a HydrationGate with a role and a person, neither chosen by default", () => {
    const { container } = render(panel(team()));
    expect(container.querySelector('[data-testid="team-grant-form"]')!.closest('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect((screen.getByLabelText(COPY.team.panel.roleLabel) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText(COPY.team.panel.personLabel) as HTMLSelectElement).value).toBe("");
  });

  it("will not send without both choices", () => {
    render(panel(team()));
    fireEvent.click(screen.getByTestId("team-grant-submit"));
    expect(screen.getByText(COPY.team.panel.chooseRole, { selector: "p" })).toBeTruthy();
    expect(screen.getByText(COPY.team.panel.choosePerson, { selector: "p" })).toBeTruthy();
    expect(grant).not.toHaveBeenCalled();
  });

  it("posts the role and the person, then thanks and re-reads", async () => {
    grant.mockResolvedValue({ ok: true, data: { grantId: GR } });
    render(panel(team()));
    fireEvent.change(screen.getByLabelText(COPY.team.panel.roleLabel), { target: { value: R1 } });
    fireEvent.change(screen.getByLabelText(COPY.team.panel.personLabel), { target: { value: P1 } });
    fireEvent.click(screen.getByTestId("team-grant-submit"));
    await waitFor(() => expect(grant).toHaveBeenCalledWith({ roleId: R1, personId: P1 }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(COPY.team.panel.roleGiven));
    expect(refresh).toHaveBeenCalled();
  });

  it("a refusal (you cannot grant keys you do not hold) is toasted and the choices stay", async () => {
    grant.mockResolvedValue({ ok: false, error: COPY.team.escalation("reimbursement.pay") });
    render(panel(team()));
    fireEvent.change(screen.getByLabelText(COPY.team.panel.roleLabel), { target: { value: R1 } });
    fireEvent.change(screen.getByLabelText(COPY.team.panel.personLabel), { target: { value: P1 } });
    fireEvent.click(screen.getByTestId("team-grant-submit"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can't grant permissions you don't hold yourself: reimbursement.pay."));
    expect((screen.getByLabelText(COPY.team.panel.roleLabel) as HTMLSelectElement).value).toBe(R1);
  });

  it("says so when there is no role to hand out or no member to hand it to", () => {
    render(panel(team({ assignableRoles: [] })));
    expect(screen.getByText(COPY.team.panel.noRoleToGive)).toBeTruthy();
    cleanup();
    render(panel(team({ people: [] })));
    expect(screen.getByText(COPY.team.panel.noMembers)).toBeTruthy();
  });
});
