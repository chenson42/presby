// @vitest-environment jsdom
/**
 * Tests for <RevokeHolderDialog> (docs/work-log/2026-10-22-designation-revoke.md,
 * Phase 3 "Component / Page Plan" and "Copy"). `./actions` is mocked (the real
 * module pulls the database into the graph).
 *
 * Pins: the confirm is an AlertDialog (Workflow Rule 2, no native dialog); a
 * required reason (the field error shows inline and the dialog STAYS open); the
 * action receives exactly the displayed grant ids; the dialog's sentences (the
 * last-holder warning, the companion line, the "still holds through" line, the
 * group wording, the treasurer wording); refresh outcomes close it and toast;
 * the pending state disables both buttons.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { groupHolderRow, holderRow } from "./holder-row.fixture";
import type { HolderRow } from "@/lib/onboarding/designation-holder-types";

const mockRevoke = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  revokeDesignationHolderAction: (fd: FormData) => mockRevoke(fd),
}));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    info: (...a: unknown[]) => toastInfo(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
const routerRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

import { RevokeHolderDialog } from "./revoke-holder-dialog";

const alertSpy = vi.spyOn(window, "alert");
const confirmSpy = vi.spyOn(window, "confirm");
const promptSpy = vi.spyOn(window, "prompt");

afterEach(() => {
  cleanup();
  mockRevoke.mockReset();
  toastSuccess.mockReset();
  toastInfo.mockReset();
  toastError.mockReset();
  routerRefresh.mockReset();
  alertSpy.mockClear();
  confirmSpy.mockClear();
  promptSpy.mockClear();
});

const GOOD_REASON = "Fixture grant left over from the first test setup.";

function renderDialog(
  row: HolderRow = holderRow(),
  slot: "founding_administrator" | "treasurer" = "founding_administrator",
) {
  const onOpenChange = vi.fn();
  const onRevoked = vi.fn();
  const view = render(
    <RevokeHolderDialog
      open
      onOpenChange={onOpenChange}
      organizationId="org-1"
      organizationName="Alder Creek Presbyterian Church"
      slot={slot}
      row={row}
      onRevoked={onRevoked}
    />,
  );
  return { ...view, onOpenChange, onRevoked };
}

const reasonField = () => screen.getByLabelText(/reason \(kept in the audit log\)/i) as HTMLTextAreaElement;
const confirmButton = () => screen.getByRole("button", { name: /yes, end access|ending/i }) as HTMLButtonElement;

describe("RevokeHolderDialog - content", () => {
  it("is an AlertDialog naming the organization, the person and the roles that end", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("End Perpetua Ashgrove's access?")).toBeTruthy();
    expect(dialog.textContent).toMatch(/manage roles at Alder Creek Presbyterian Church/);
    expect(dialog.textContent).toMatch(/This role ends today: Founding Administrator\./);
    expect(dialog.textContent).toMatch(/Create and edit roles/);
    expect(dialog.textContent).toMatch(/recorded in the audit log with your reason/);
  });

  it("lists the companion office grant separately", () => {
    renderDialog(holderRow({ companionRoleNames: ["Congregation Stated Clerk"] }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(
      /Congregation Stated Clerk was assigned together with the designation and ends with it\./,
    );
  });

  it("warns that nobody can manage until a replacement is invited when this is the last holder", () => {
    renderDialog(holderRow({ leavesNoHolders: true }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(
      /only person who has this access\. Nobody will be able to manage roles until you invite a replacement\./,
    );
  });

  it("points at the organization's own Roles page when others can still manage", () => {
    renderDialog(holderRow({ leavesNoHolders: false }));
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toMatch(/Others can still manage roles here/);
    expect(text).toMatch(/own Roles page/);
    expect(text).not.toMatch(/only person who has this access/);
  });

  it("says the person will still hold the access through a group", () => {
    renderDialog(holderRow({ alsoThroughGroupNames: ["Office Volunteers"] }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(
      /Perpetua Ashgrove will still hold this access through Office Volunteers\./,
    );
  });

  it("group wording: every counted member loses it, the group and its members unchanged", () => {
    renderDialog(groupHolderRow());
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toMatch(/End access for the Office Volunteers group\?/);
    expect(text).toMatch(/3 people hold this access through the Office Volunteers group\. All of them lose it/);
    expect(text).toMatch(/The group and its members are not changed\./);
  });

  it("treasurer wording says donor and gift data stays and the platform operator gains no access", () => {
    renderDialog(holderRow({ roleNames: ["Treasurer"], companionRoleNames: [] }), "treasurer");
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toMatch(/manage giving at Alder Creek Presbyterian Church/);
    expect(text).toMatch(/Gift and donor records are not changed, and ending this gives the platform operator no access to them\./);
    expect(text).toMatch(/Nobody will be able to manage giving/);
  });

  it("the founding-administrator dialog does not carry the treasurer sentence", () => {
    renderDialog();
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/Gift and donor/);
  });

  it("shows no email address", () => {
    renderDialog(holderRow({ alsoThroughGroupNames: ["Office Volunteers"] }));
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/@/);
  });

  it("labels the reason field with its helper text", () => {
    renderDialog();
    expect(reasonField()).toBeTruthy();
    expect(screen.getByText(/10 to 500 characters\. Don't include passwords or personal details\./)).toBeTruthy();
  });
});

describe("RevokeHolderDialog - the action", () => {
  it("sends the org, slot, subject and EXACTLY the displayed grant ids, with the typed reason", async () => {
    mockRevoke.mockResolvedValue({ ok: true, reachedZero: false });
    const row = holderRow();
    renderDialog(row);
    fireEvent.change(reasonField(), { target: { value: GOOD_REASON } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    const fd = mockRevoke.mock.calls[0]![0] as FormData;
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("slot")).toBe("founding_administrator");
    expect(fd.get("subjectKind")).toBe("person");
    expect(fd.get("subjectId")).toBe(row.subjectId);
    expect(fd.getAll("expectedGrantId")).toEqual(row.grantIds);
    expect(fd.get("reason")).toBe(GOOD_REASON);
    // Nothing identity-shaped travels from the client.
    expect([...new Set([...fd.keys()])].sort()).toEqual(
      ["expectedGrantId", "organizationId", "reason", "slot", "subjectId", "subjectKind"],
    );
  });

  it("on success: toasts, reports the sentence to the section and closes", async () => {
    mockRevoke.mockResolvedValue({ ok: true, reachedZero: true });
    const { onOpenChange, onRevoked } = renderDialog();
    fireEvent.change(reasonField(), { target: { value: GOOD_REASON } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    const expected = "Access ended for Perpetua Ashgrove. Nobody holds this now. Invite a replacement below.";
    expect(toastSuccess).toHaveBeenCalledWith(expected);
    expect(onRevoked).toHaveBeenCalledWith(expected);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a reason field error shows inline and the dialog stays open", async () => {
    mockRevoke.mockResolvedValue({ ok: false, error: "Add a reason of at least 10 characters.", field: "reason" });
    const { onOpenChange, onRevoked } = renderDialog();
    fireEvent.change(reasonField(), { target: { value: "short" } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(screen.getByRole("alert").textContent).toBe("Add a reason of at least 10 characters.");
    expect(reasonField().getAttribute("aria-invalid")).toBe("true");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onRevoked).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ["already removed", "That access has already been removed. The list has been refreshed."],
    ["changed", "This access changed while you were looking. The list has been refreshed. Review it and try again."],
    ["not found", "We couldn't find that access to remove at this organization. The list has been refreshed."],
  ])("a refresh outcome (%s) toasts the copy, re-reads the list and closes", async (_label, error) => {
    mockRevoke.mockResolvedValue({ ok: false, error, refresh: true });
    const { onOpenChange, onRevoked } = renderDialog();
    fireEvent.change(reasonField(), { target: { value: GOOD_REASON } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(toastInfo).toHaveBeenCalledWith(error);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it("an inline failure (no refresh) is an alert and the dialog stays open", async () => {
    mockRevoke.mockResolvedValue({ ok: false, error: "We couldn't complete that just now — try again in a moment." });
    const { onOpenChange } = renderDialog();
    fireEvent.change(reasonField(), { target: { value: GOOD_REASON } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(screen.getByRole("alert").textContent).toMatch(/try again in a moment/);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("while pending, both buttons are disabled and the confirm reads 'Ending…'", async () => {
    let release: (v: unknown) => void = () => {};
    mockRevoke.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderDialog();
    fireEvent.change(reasonField(), { target: { value: GOOD_REASON } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() => expect(confirmButton().disabled).toBe(true));
    expect(confirmButton().textContent).toBe("Ending…");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect(reasonField().disabled).toBe(true);
    await act(async () => {
      release({ ok: true, reachedZero: false });
    });
  });

  it("never invokes a native dialog (Workflow Rule 2)", async () => {
    mockRevoke.mockResolvedValue({ ok: true, reachedZero: false });
    renderDialog();
    fireEvent.change(reasonField(), { target: { value: GOOD_REASON } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });
});
