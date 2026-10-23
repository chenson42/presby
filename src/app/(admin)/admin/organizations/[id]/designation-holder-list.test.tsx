// @vitest-environment jsdom
/**
 * Tests for <DesignationHolderList> (docs/work-log/2026-10-22-designation-
 * revoke.md, Phase 3 "Component / Page Plan"; DECISION-195). `./actions` is
 * mocked (the real module pulls the database into the graph).
 *
 * Pins: a person row shows a display name only (never an email); a group row
 * names the group and a count and never a member; a derived group has no
 * button and the officers sentence; Revoke is a 44px target; long text wraps;
 * Revoke opens the AlertDialog; no row contains "Self-designated" or "Accepted".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { derivedGroupHolderRow, groupHolderRow, holderRow } from "./holder-row.fixture";

vi.mock("./actions", () => ({ revokeDesignationHolderAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { DesignationHolderList } from "./designation-holder-list";

afterEach(cleanup);

function renderList(holders = [holderRow()]) {
  return render(
    <DesignationHolderList
      organizationId="org-1"
      organizationName="Alder Creek Presbyterian Church"
      slot="founding_administrator"
      holders={holders}
      onRevoked={vi.fn()}
    />,
  );
}

describe("DesignationHolderList", () => {
  it("renders nothing for no holders", () => {
    const { container } = renderList([]);
    expect(container.firstChild).toBeNull();
  });

  it("a person row: name, since, provenance and roles; no email", () => {
    const { container } = renderList();
    expect(screen.getByText("Perpetua Ashgrove")).toBeTruthy();
    expect(screen.getByText(/Since 1 Oct 2026 · Designated through an invitation/)).toBeTruthy();
    expect(screen.getByText("Roles: Founding Administrator")).toBeTruthy();
    expect(container.textContent).not.toMatch(/@/);
  });

  it("says 'Granted another way' for a grant that did not come from the designation", () => {
    renderList([holderRow({ provenance: "other" })]);
    expect(screen.getByText(/Granted another way/)).toBeTruthy();
  });

  it("shows the other groups a person also holds this through", () => {
    renderList([holderRow({ alsoThroughGroupNames: ["Office Volunteers"] })]);
    expect(screen.getByText("Also holds this through Office Volunteers.")).toBeTruthy();
  });

  it("a managed group row names the group and a count, never a member, and has Revoke", () => {
    const { container } = renderList([groupHolderRow()]);
    expect(screen.getByText("Office Volunteers (group)")).toBeTruthy();
    expect(screen.getByText("3 people hold this through the group.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke access for the Office Volunteers group" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/@/);
  });

  it("a derived group row has NO button and says the congregation's officers change it", () => {
    renderList([derivedGroupHolderRow()]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("derived-holder-note").textContent).toBe(
      "7 people hold this through Session; the congregation's own officers change this.",
    );
  });

  it("Revoke is a 44px target, full width on a phone", () => {
    renderList();
    const button = screen.getByRole("button", { name: "Revoke access for Perpetua Ashgrove" });
    expect(button.className).toMatch(/\bmin-h-11\b/);
    expect(button.className).toMatch(/\bw-full\b/);
    expect(button.className).toMatch(/\bsm:w-auto\b/);
  });

  it("every text node wraps, so a very long group name never scrolls the page sideways", () => {
    const longName = "The Committee For The Ongoing Care Of The Fellowship Hall And All Of Its Many Rooms ".repeat(3).trim();
    renderList([groupHolderRow({ displayName: longName })]);
    const title = screen.getByText(`${longName} (group)`);
    expect(title.className).toMatch(/\bbreak-words\b/);
    expect(title.parentElement!.className).toMatch(/\bmin-w-0\b/);
    const row = screen.getByTestId("designation-holder-row");
    expect(row.className).toMatch(/\bflex-col\b/);
    expect(row.className).toMatch(/\bsm:flex-row\b/);
  });

  it("Revoke opens the confirm AlertDialog naming the person", () => {
    renderList();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revoke access for Perpetua Ashgrove" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toMatch(/End Perpetua Ashgrove's access\?/);
  });

  it("no row contains 'Self-designated' or 'Accepted' (the invitation row's facts, asserted by an existing e2e)", () => {
    const { container } = renderList([holderRow(), groupHolderRow(), derivedGroupHolderRow()]);
    expect(container.textContent).not.toMatch(/self-designated/i);
    expect(container.textContent).not.toMatch(/accepted/i);
  });
});
