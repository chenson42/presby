// @vitest-environment jsdom
/**
 * The board's dialogs (Copy G5): person picker (warn, never block), guest, record an
 * answer, remove (AlertDialog), and Send (preview, then confirm). Mocked actions: what
 * is pinned is what the UI asks for, what it shows, and that nothing writes until the
 * confirming button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
  getPickerCandidatesAction: vi.fn(),
  placePersonAction: vi.fn(),
  placeGuestAction: vi.fn(),
  recordResponseAction: vi.fn(),
  removeAssignmentAction: vi.fn(),
  getSendPreviewAction: vi.fn(),
  sendRequestsAction: vi.fn(),
}));
vi.mock("@/app/(org)/o/[slug]/worship/actions", () => actions);

import { ACTION_COPY, BOARD_COPY } from "@/lib/worship/copy";
import { AssignmentRow } from "./assignment-row";
import { GuestForm } from "./guest-form";
import { PersonPickerDialog } from "./person-picker-dialog";
import { RecordResponseDialog } from "./record-response-dialog";
import { RemoveAssignmentDialog } from "./remove-assignment-dialog";
import { SendRequestsDialog } from "./send-requests-dialog";

const E = "55555555-5555-4555-8555-555555555555";
const G = "44444444-4444-4444-8444-444444444444";
const P = "66666666-6666-4666-8666-666666666666";
const A = "77777777-7777-4777-8777-777777777777";

beforeEach(() => {
  for (const m of [refresh, toast.success, toast.error, ...Object.values(actions)]) m.mockReset();
});
afterEach(cleanup);

const candidate = (over: Record<string, unknown> = {}) => ({
  personId: "p1", displayName: "Wren Thackeray", qualified: true, warnings: [], info: [], ...over,
});

describe("PersonPickerDialog", () => {
  const open = async () => {
    render(<PersonPickerDialog slug="alder" eventId={E} groupId={G} positionId={P} positionName="Vocals" />);
    fireEvent.click(screen.getByTestId(`add-someone-${P}`));
  };

  it("opens with the title, asks for the marked people only, and shows each with 'Can fill this position'", async () => {
    actions.getPickerCandidatesAction.mockResolvedValue({ ok: true, data: [candidate()] });
    await open();
    expect(screen.getByRole("dialog").textContent).toContain(BOARD_COPY.picker.title("Vocals"));
    await screen.findByTestId("picker-row");
    expect(actions.getPickerCandidatesAction).toHaveBeenCalledWith("alder", { eventId: E, groupId: G, positionId: P, showAll: false });
    expect(screen.getByText(BOARD_COPY.picker.canFill)).toBeTruthy();
    expect(screen.getByRole("button", { name: BOARD_COPY.picker.add })).toBeTruthy();
  });

  it("'Show everyone on the team' asks again with showAll", async () => {
    actions.getPickerCandidatesAction.mockResolvedValue({ ok: true, data: [] });
    await open();
    await screen.findByTestId("picker-empty");
    expect(screen.getByTestId("picker-empty").textContent).toBe(BOARD_COPY.picker.empty);
    fireEvent.click(screen.getByLabelText(BOARD_COPY.picker.showEveryone));
    await waitFor(() => expect(actions.getPickerCandidatesAction).toHaveBeenLastCalledWith("alder", { eventId: E, groupId: G, positionId: P, showAll: true }));
  });

  it("warnings are text, the button becomes 'Add anyway', and nothing is blocked", async () => {
    actions.getPickerCandidatesAction.mockResolvedValue({
      ok: true,
      data: [
        candidate({
          qualified: false,
          warnings: [
            { kind: "blocked_out", date: "2026-11-15" },
            { kind: "same_day", position: "Keys" },
            { kind: "overlap", title: "Evening service" },
            { kind: "declined_this_service" },
          ],
          info: [{ kind: "may_be_under_18" }],
        }),
      ],
    });
    await open();
    await screen.findByTestId("picker-row");
    const warnings = screen.getAllByTestId("picker-warning").map((w) => w.textContent);
    expect(warnings).toEqual([
      "Can't serve on Sunday, November 15, 2026",
      "Already scheduled as Keys that day",
      "Overlaps Evening service",
      "Said they can't serve this service",
    ]);
    expect(screen.getByText(BOARD_COPY.picker.notMarked)).toBeTruthy();
    expect(screen.getByText(BOARD_COPY.picker.mayBeUnder18)).toBeTruthy();
    expect(screen.getByRole("button", { name: BOARD_COPY.picker.addAnyway })).toBeTruthy();
  });

  it("Add places the person as a draft, toasts, and re-reads", async () => {
    actions.getPickerCandidatesAction.mockResolvedValue({ ok: true, data: [candidate()] });
    actions.placePersonAction.mockResolvedValue({ ok: true, data: { assignmentId: A } });
    await open();
    fireEvent.click(await screen.findByRole("button", { name: BOARD_COPY.picker.add }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(BOARD_COPY.picker.toast));
    expect(actions.placePersonAction).toHaveBeenCalledWith("alder", { eventId: E, groupId: G, positionId: P, personId: "p1" });
    expect(refresh).toHaveBeenCalled();
  });

  it("a failed list is an error with a retry, never an empty list", async () => {
    actions.getPickerCandidatesAction.mockResolvedValueOnce({ ok: false, error: ACTION_COPY.forbidden });
    await open();
    await screen.findByTestId("picker-error");
    expect(screen.queryByTestId("picker-empty")).toBeNull();
    actions.getPickerCandidatesAction.mockResolvedValueOnce({ ok: true, data: [candidate()] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("picker-row");
  });

  it("a refused placement is toasted in the server's words", async () => {
    actions.getPickerCandidatesAction.mockResolvedValue({ ok: true, data: [candidate()] });
    actions.placePersonAction.mockResolvedValue({ ok: false, error: ACTION_COPY.serviceStarted });
    await open();
    fireEvent.click(await screen.findByRole("button", { name: BOARD_COPY.picker.add }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ACTION_COPY.serviceStarted));
  });
});

describe("GuestForm", () => {
  it("takes just a name with the hint, shows the server's refusal inline, and places a guest on success", async () => {
    render(<GuestForm slug="alder" eventId={E} groupId={G} positionId={P} positionName="Preacher" />);
    fireEvent.click(screen.getByTestId(`add-guest-${P}`));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("fieldset[data-slot='hydration-gate']")).toBeTruthy();
    expect(within(dialog).getByText(BOARD_COPY.guestHint)).toBeTruthy();
    const field = within(dialog).getByLabelText(BOARD_COPY.guestNameLabel);
    actions.placeGuestAction.mockResolvedValueOnce({ ok: false, error: "Enter just a name. Contact details aren't kept here." });
    fireEvent.change(field, { target: { value: "pastor@example.invalid" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add guest" }));
    await waitFor(() => expect(within(dialog).getByText("Enter just a name. Contact details aren't kept here.")).toBeTruthy());
    expect(field.getAttribute("aria-invalid")).toBe("true");
    actions.placeGuestAction.mockResolvedValueOnce({ ok: true, data: { assignmentId: A } });
    fireEvent.change(field, { target: { value: "Visiting Preacher" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add guest" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(BOARD_COPY.picker.toast));
    expect(actions.placeGuestAction).toHaveBeenLastCalledWith("alder", { eventId: E, groupId: G, positionId: P, guestName: "Visiting Preacher" });
  });
});

describe("RecordResponseDialog", () => {
  it("records Declined with a reason, saved as entered by the leader", async () => {
    actions.recordResponseAction.mockResolvedValue({ ok: true, data: { changed: true } });
    render(<RecordResponseDialog slug="alder" assignmentId={A} personName="Hallie Vandermeer" />);
    fireEvent.click(screen.getByTestId(`record-${A}`));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(BOARD_COPY.record.title("Hallie Vandermeer"));
    expect(dialog.textContent).toContain(BOARD_COPY.record.helper);
    expect(within(dialog).queryByLabelText(BOARD_COPY.record.reasonLabel)).toBeNull();
    fireEvent.click(within(dialog).getByLabelText(BOARD_COPY.record.declined));
    fireEvent.change(within(dialog).getByLabelText(BOARD_COPY.record.reasonLabel), { target: { value: "family" } });
    fireEvent.click(within(dialog).getByRole("button", { name: BOARD_COPY.record.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(BOARD_COPY.record.toast));
    expect(actions.recordResponseAction).toHaveBeenCalledWith("alder", { assignmentId: A, answer: "declined", reason: "family" });
  });

  it("Accepted sends no reason", async () => {
    actions.recordResponseAction.mockResolvedValue({ ok: true, data: { changed: true } });
    render(<RecordResponseDialog slug="alder" assignmentId={A} personName="Hallie" />);
    fireEvent.click(screen.getByTestId(`record-${A}`));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: BOARD_COPY.record.submit }));
    await waitFor(() => expect(actions.recordResponseAction).toHaveBeenCalledWith("alder", { assignmentId: A, answer: "accepted", reason: null }));
  });
});

describe("RemoveAssignmentDialog", () => {
  it("a draft says they haven't been asked; a sent request says they are NOT told", () => {
    const { unmount } = render(<RemoveAssignmentDialog slug="alder" assignmentId={A} personName="Wren" positionName="Vocals" wasSent={false} />);
    fireEvent.click(screen.getByTestId(`remove-${A}`));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(BOARD_COPY.removeDialog.title("Wren", "Vocals"));
    expect(dialog.textContent).toContain(BOARD_COPY.removeDialog.bodyDraft);
    unmount();
    render(<RemoveAssignmentDialog slug="alder" assignmentId={A} personName="Wren" positionName="Vocals" wasSent />);
    fireEvent.click(screen.getByTestId(`remove-${A}`));
    expect(screen.getByRole("alertdialog").textContent).toContain(BOARD_COPY.removeDialog.bodySent);
  });

  it("Cancel removes nothing; Remove does", async () => {
    actions.removeAssignmentAction.mockResolvedValue({ ok: true, data: { changed: true } });
    render(<RemoveAssignmentDialog slug="alder" assignmentId={A} personName="Wren" positionName="Vocals" wasSent={false} />);
    fireEvent.click(screen.getByTestId(`remove-${A}`));
    fireEvent.click(screen.getByRole("button", { name: BOARD_COPY.removeDialog.cancel }));
    expect(actions.removeAssignmentAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`remove-${A}`));
    fireEvent.click(screen.getByTestId("remove-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(BOARD_COPY.removeDialog.toast));
    expect(actions.removeAssignmentAction).toHaveBeenCalledWith("alder", { assignmentId: A });
  });
});

describe("AssignmentRow - the guardian instruction lasts only while an answer is needed", () => {
  const row = (status: "requested" | "confirmed" | "declined") =>
    render(
      <ul>
        <AssignmentRow
          slug="alder"
          positionName="Keys"
          canAct
          assignment={{ assignmentId: A, personId: "p", name: "Posy", isGuest: false, status, declineReason: null, noticeOutcome: "guardian", recordedBy: status === "requested" ? null : "Barnaby", mayBeUnder18: true }}
        />
      </ul>,
    );

  it("shown while the request is waiting", () => {
    row("requested");
    expect(screen.getByTestId("reach-note").textContent).toBe(BOARD_COPY.reach.guardian);
  });
  it.each(["confirmed", "declined"] as const)("gone once the answer is recorded (%s); 'Recorded by' stays", (status) => {
    row(status);
    expect(screen.queryByTestId("reach-note")).toBeNull();
    expect(screen.getByTestId("recorded-by").textContent).toBe("Recorded by Barnaby");
  });
});

describe("destructive confirms use the destructive variant; Send stays primary", () => {
  it("Remove", () => {
    render(<RemoveAssignmentDialog slug="alder" assignmentId={A} personName="Wren" positionName="Vocals" wasSent={false} />);
    fireEvent.click(screen.getByTestId(`remove-${A}`));
    expect(screen.getByTestId("remove-confirm").className).toContain("bg-destructive");
  });
  it("Send", async () => {
    actions.getSendPreviewAction.mockResolvedValue({ ok: true, data: { assignments: 1, people: 1, services: 1, emailed: 1, guardian: 0, noAddress: 0, doNotContact: 0, notEmailed: 0, notOnTeam: 0, overCap: false, mailAvailable: true } });
    render(<SendRequestsDialog slug="alder" eventId={E} groupId={G} draftCount={1} />);
    fireEvent.click(screen.getByTestId("send-open"));
    expect(screen.getByTestId("send-confirm").className).toContain("bg-primary");
    expect(screen.getByTestId("send-confirm").className).not.toContain("bg-destructive");
    await waitFor(() => expect((screen.getByTestId("send-confirm") as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("SendRequestsDialog", () => {
  const preview = (over: Record<string, unknown> = {}) => ({
    assignments: 3, people: 3, services: 1, emailed: 2, guardian: 1, noAddress: 0, doNotContact: 0, notEmailed: 1,
    notOnTeam: 0, overCap: false, mailAvailable: true, ...over,
  });
  const open = () => {
    render(<SendRequestsDialog slug="alder" eventId={E} groupId={G} draftCount={3} />);
    fireEvent.click(screen.getByTestId("send-open"));
  };

  it("the button carries the count; opening it writes nothing and prints the counts from the preview", async () => {
    actions.getSendPreviewAction.mockResolvedValue({ ok: true, data: preview() });
    render(<SendRequestsDialog slug="alder" eventId={E} groupId={G} draftCount={3} />);
    expect(screen.getByTestId("send-open").textContent).toBe("Send requests (3)");
    fireEvent.click(screen.getByTestId("send-open"));
    const body = await screen.findByTestId("send-body");
    expect(body.textContent).toBe(BOARD_COPY.send.body(1, 1, 0, 0));
    expect(screen.getByRole("dialog").textContent).toContain("Send 3 requests?");
    expect(actions.sendRequestsAction).not.toHaveBeenCalled();
    expect(actions.getSendPreviewAction).toHaveBeenCalledWith("alder", { eventIds: [E], groupId: G });
  });

  it("everyone reachable: the short body", async () => {
    actions.getSendPreviewAction.mockResolvedValue({ ok: true, data: preview({ guardian: 0, notEmailed: 0, emailed: 3 }) });
    open();
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain(BOARD_COPY.send.bodyAllReachable));
    expect(screen.queryByTestId("send-body")).toBeNull();
  });

  it("confirming sends once and toasts what actually happened", async () => {
    actions.getSendPreviewAction.mockResolvedValue({ ok: true, data: preview() });
    actions.sendRequestsAction.mockResolvedValue({ ok: true, data: { sent: 3, emailed: 2, notEmailed: 1, notOnTeam: 0, services: 1 } });
    open();
    const confirm = await screen.findByTestId("send-confirm");
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(BOARD_COPY.send.toast(2, 1)));
    expect(actions.sendRequestsAction).toHaveBeenCalledTimes(1);
    expect(actions.sendRequestsAction).toHaveBeenCalledWith("alder", { eventIds: [E], groupId: G });
  });

  it.each([
    ["over the cap", { overCap: true }, ACTION_COPY.sendOverCap],
    ["mail unavailable", { mailAvailable: false }, ACTION_COPY.sendMailUnavailable],
    ["nothing to send", { assignments: 0 }, ACTION_COPY.sendNothing],
  ])("%s: says so in Copy's words and the confirming button stays disabled", async (_n, over, sentence) => {
    actions.getSendPreviewAction.mockResolvedValue({ ok: true, data: preview(over) });
    open();
    expect((await screen.findByTestId("send-blocked")).textContent).toBe(sentence);
    expect((screen.getByTestId("send-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed preview cannot be confirmed", async () => {
    actions.getSendPreviewAction.mockResolvedValue({ ok: false, error: ACTION_COPY.forbidden });
    open();
    await screen.findByRole("alert");
    expect((screen.getByTestId("send-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});
