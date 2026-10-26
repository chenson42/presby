// @vitest-environment jsdom
/**
 * The "Sign in to PresbyPortal" card and its three dialogs (Community Increment
 * 2b Batch C; Phase 3 Copy and amendment 2 groups D and the dialogs). Mocked at
 * the `./actions` boundary: the actions' own behaviour is `actions.test.ts`'s.
 * These pin the CLIENT contract: every state's words come from the copy module,
 * the right buttons per state, the acknowledgement flow (F177), no native
 * dialog (Rule 2), triggers disabled before hydration (DECISION-159) and 44px
 * targets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }) }));

const mockSend = vi.hoisted(() => vi.fn());
const mockResend = vi.hoisted(() => vi.fn());
const mockRevoke = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  sendSignInInvitationAction: (...a: unknown[]) => mockSend(...a),
  resendSignInInvitationAction: (...a: unknown[]) => mockResend(...a),
  revokeSignInInvitationAction: (...a: unknown[]) => mockRevoke(...a),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { SignInCard } from "./sign-in-card";
import {
  CONNECT_OUTLOOK_COPY,
  SIGN_IN_CARD_COPY,
  SIGN_IN_CARD_HEADING,
  SIGN_IN_DIALOG_COPY,
  blockedCardLine,
} from "@/lib/onboarding/sign-in-copy";
import type { SignInCardState } from "@/lib/onboarding/sign-in-types";

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  mockSend.mockReset();
  mockResend.mockReset();
  mockRevoke.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

const NAME = "Nora Ashgrove";
const CONGREGATION = "Alder Creek Presbyterian Church";
const ADDRESS = "nora@example.invalid";
const SENT = new Date("2026-10-20T12:00:00Z");
const EXPIRES = new Date("2026-10-27T12:00:00Z");

function card(over: Partial<SignInCardState> = {}): SignInCardState {
  return {
    personId: "p-1",
    state: "none",
    linked: false,
    connectedVia: null,
    connectedOn: null,
    address: ADDRESS,
    invitedAddress: null,
    addressCurrent: null,
    sentAt: null,
    expiresAt: null,
    resendCount: 0,
    nextResendAt: null,
    cooldownMinutes: 0,
    chainCapReached: false,
    delivery: "unknown",
    blockedOutcome: null,
    isVisitor: false,
    addressDoNotContact: false,
    authorityBearing: false,
    addressShared: false,
    selfConnectEnabled: true,
    outlook: "by_sign_in",
    ...over,
  };
}

const pendingCard = (over: Partial<SignInCardState> = {}) =>
  card({
    state: "pending",
    invitedAddress: ADDRESS,
    addressCurrent: true,
    sentAt: SENT,
    expiresAt: EXPIRES,
    delivery: "sent",
    outlook: "none",
    ...over,
  });

function renderCard(c: SignInCardState | null) {
  return render(<SignInCard slug="alder-creek" personId="p-1" personName={NAME} congregation={CONGREGATION} card={c} />);
}

const text = () => screen.getByTestId("sign-in-card").textContent ?? "";
const button = (name: RegExp | string) => screen.getByRole("button", { name });

describe("SignInCard - the states", () => {
  it("is the section #sign-in with the heading", () => {
    renderCard(card());
    const section = screen.getByTestId("sign-in-card");
    expect(section.id).toBe("sign-in");
    expect(screen.getByRole("heading", { name: SIGN_IN_CARD_HEADING })).toBeTruthy();
  });

  it("a failed read says so in the card and offers nothing (the page does not fail)", () => {
    renderCard(null);
    expect(text()).toContain(SIGN_IN_CARD_COPY.loadFailed);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("none, with an address: the invite line, the hedged connect line and Send invitation", () => {
    renderCard(card());
    expect(text()).toContain(SIGN_IN_CARD_COPY.none(NAME, ADDRESS));
    // Literals, not the constant: connecting activates whatever the record carries (QA run 1 (b)).
    expect(text()).toContain("any role or seat they hold here then takes effect");
    expect(text()).not.toContain("doesn't change what they can do");
    expect(text()).toContain(CONNECT_OUTLOOK_COPY.by_sign_in(NAME, ADDRESS));
    expect(button("Send invitation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cancel invitation/i })).toBeNull();
  });

  it("revoked reads like none", () => {
    renderCard(card({ state: "revoked" }));
    expect(text()).toContain(SIGN_IN_CARD_COPY.none(NAME, ADDRESS));
    expect(text()).toContain("any role or seat they hold here then takes effect");
    expect(text()).not.toContain("doesn't change what they can do");
    expect(button("Send invitation")).toBeTruthy();
  });

  it("none, no address: the line, no button", () => {
    renderCard(card({ address: null, outlook: "none" }));
    expect(text()).toContain(SIGN_IN_CARD_COPY.noAddress(NAME));
    expect(text()).toContain("Add one under Contact & address");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["by_sign_in_second_factor", CONNECT_OUTLOOK_COPY.by_sign_in_second_factor(NAME, ADDRESS)],
    ["visitor", CONNECT_OUTLOOK_COPY.visitor(NAME)],
    ["shared_address", CONNECT_OUTLOOK_COPY.shared_address(NAME)],
    ["turned_off", CONNECT_OUTLOOK_COPY.turned_off(CONGREGATION)],
  ] as const)("the %s connect line", (outlook, line) => {
    renderCard(card({ outlook }));
    expect(text()).toContain(line);
  });

  it("signs_in through sign-in: 'Connected through sign-in on {date}' and the support line, no button", () => {
    renderCard(card({ state: "signs_in", linked: true, connectedVia: "sign_in", connectedOn: "2026-10-20", outlook: "connected" }));
    expect(text()).toMatch(/^Sign in to PresbyPortalConnected through sign-in on .+\.To change who signs in as this person, send us a support ticket\.$/);
    // A calendar date renders as a calendar date, never shifted.
    expect(screen.getByTestId("sign-in-card").querySelector("time")?.getAttribute("datetime")).toBe("2026-10-20");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("signs_in through an invitation, and with no known route", () => {
    const { unmount } = renderCard(card({ state: "signs_in", linked: true, connectedVia: "invitation", connectedOn: "2026-10-20", outlook: "connected" }));
    expect(text()).toContain("Connected through an invitation on");
    unmount();
    renderCard(card({ state: "signs_in", linked: true, connectedVia: null, outlook: "connected" }));
    expect(text()).toContain(SIGN_IN_CARD_COPY.connectedUnknown(NAME));
  });

  it("pending: the sent line with its delivery word, the earlier-link hint, the open-invitation line, Send again and Cancel invitation", () => {
    renderCard(pendingCard());
    expect(text()).toMatch(new RegExp(`Invitation sent to ${ADDRESS} on .+\\. It expires .+\\.Sent`));
    expect(text()).toContain(SIGN_IN_CARD_COPY.sendAgainHint);
    expect(text()).toContain(CONNECT_OUTLOOK_COPY.pendingInvitation(NAME));
    expect(button("Send again")).toBeTruthy();
    expect(button("Cancel invitation")).toBeTruthy();
  });

  it.each([
    ["queued", "Queued"],
    ["delivered", "Delivered"],
  ] as const)("pending, delivery %s shows '%s'", (delivery, word) => {
    renderCard(pendingCard({ delivery }));
    expect(text()).toContain(word);
  });

  it("pending, bounced: the bounced line and Send again", () => {
    renderCard(pendingCard({ delivery: "bounced" }));
    expect(text()).toContain(SIGN_IN_CARD_COPY.bounced(ADDRESS));
    expect(button("Send again")).toBeTruthy();
  });

  it("pending, cooldown: the cooldown line and a disabled Send again", () => {
    renderCard(pendingCard({ cooldownMinutes: 3 }));
    expect(text()).toContain(SIGN_IN_CARD_COPY.cooldown(3));
    expect((button("Send again") as HTMLButtonElement).disabled).toBe(true);
  });

  it("pending, address changed: the changed line naming the new address, and Send again", () => {
    renderCard(pendingCard({ addressCurrent: false, invitedAddress: null, address: "new@example.invalid" }));
    expect(text()).toContain(SIGN_IN_CARD_COPY.addressChanged("new@example.invalid"));
    expect(button("Send again")).toBeTruthy();
  });

  it("pending, chain cap: the cap line and no Send again; Cancel stays", () => {
    renderCard(pendingCard({ chainCapReached: true, resendCount: 5 }));
    expect(text()).toContain(SIGN_IN_CARD_COPY.chainCap(NAME));
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
    expect(button("Cancel invitation")).toBeTruthy();
  });

  it("pending, the address was removed: the no-address line and only Cancel", () => {
    renderCard(pendingCard({ address: null, invitedAddress: null, addressCurrent: false }));
    expect(text()).toContain(SIGN_IN_CARD_COPY.noAddress(NAME));
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
    expect(button("Cancel invitation")).toBeTruthy();
  });

  it("expired: the expired line and 'Send a new one'", () => {
    renderCard(card({ state: "expired", invitedAddress: ADDRESS, addressCurrent: true, sentAt: SENT, expiresAt: EXPIRES }));
    expect(text()).toMatch(new RegExp(`The invitation to ${ADDRESS} expired on .+\\.`));
    expect(button("Send a new one")).toBeTruthy();
    expect(text()).toContain(CONNECT_OUTLOOK_COPY.by_sign_in(NAME, ADDRESS));
  });

  it.each(["membership_ended", "person_merged", "person_deceased", "needs_support"] as const)(
    "blocked (%s): the honest line and no button",
    (outcome) => {
      renderCard(card({ state: "blocked", blockedOutcome: outcome, outlook: "none" }));
      expect(text()).toContain(blockedCardLine(outcome, NAME, CONGREGATION));
      expect(screen.queryByRole("button")).toBeNull();
    },
  );
});

describe("SignInCard - before hydration and targets", () => {
  it("every trigger is disabled in the server render (DECISION-159)", () => {
    const html = renderToString(
      <SignInCard slug="s" personId="p-1" personName={NAME} congregation={CONGREGATION} card={pendingCard()} />,
    );
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b).toContain('disabled=""');
  });

  it("every trigger is a 44px target", () => {
    renderCard(pendingCard());
    for (const b of screen.getAllByRole("button")) expect(b.className).toContain("min-h-11");
  });
});

describe("SignInCard - the send dialog", () => {
  function open() {
    fireEvent.click(button("Send invitation"));
    return screen.getByRole("alertdialog");
  }

  it("is an AlertDialog, never a native dialog (Rule 2), with the title, the address and the expiry", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm").mockImplementation(() => true);
    renderCard(card());
    const dialog = open();
    expect(within(dialog).getByText(SIGN_IN_DIALOG_COPY.send.title(NAME))).toBeTruthy();
    expect(dialog.textContent).toContain(`We'll email ${ADDRESS}. The link works once and expires on `);
    expect(dialog.textContent).toContain(`Only send it if that address belongs to ${NAME}: whoever opens the link becomes ${NAME} on PresbyPortal.`);
    expect(dialog.querySelector("time")).not.toBeNull();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("sends the address the sender saw, toasts the sent sentence, closes and re-reads the page", async () => {
    mockSend.mockResolvedValue({ ok: true, data: { address: ADDRESS, expiresAt: EXPIRES.toISOString(), delivery: "sent" } });
    renderCard(card());
    const dialog = open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    });
    expect(mockSend).toHaveBeenCalledWith("alder-creek", { personId: "p-1", confirmedAddress: ADDRESS, acknowledged: false });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0][0]).toMatch(new RegExp(`^Invitation sent to ${ADDRESS}\\. It expires `));
    expect(mockRefresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("a queued delivery toasts the saved sentence", async () => {
    mockSend.mockResolvedValue({ ok: true, data: { address: ADDRESS, expiresAt: EXPIRES.toISOString(), delivery: "queued" } });
    renderCard(card());
    const dialog = open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    });
    expect(toastSuccess).toHaveBeenCalledWith(SIGN_IN_DIALOG_COPY.send.toastQueued);
  });

  it("a visitor sees the acknowledgement up front; Send is disabled until the box is ticked, and the flag is sent", async () => {
    mockSend.mockResolvedValue({ ok: true, data: { address: ADDRESS, expiresAt: EXPIRES.toISOString(), delivery: "sent" } });
    renderCard(card({ isVisitor: true, outlook: "visitor" }));
    const dialog = open();
    expect(dialog.textContent).toContain(SIGN_IN_DIALOG_COPY.send.visitorAcknowledgement(NAME));
    expect(dialog.textContent).not.toContain("asked not to be contacted");
    const send = within(dialog).getByRole("button", { name: "Send invitation" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: SIGN_IN_DIALOG_COPY.send.checkbox }));
    expect(send.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(send);
    });
    expect(mockSend).toHaveBeenCalledWith("alder-creek", { personId: "p-1", confirmedAddress: ADDRESS, acknowledged: true });
  });

  it("needs_acknowledgement is not an error: the dialog re-opens its paragraphs (do_not_contact only because the server asked) and shows no sentence", async () => {
    mockSend.mockResolvedValue({ ok: false, error: "", needsAcknowledgement: ["do_not_contact"] });
    renderCard(card());
    const dialog = open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    });
    expect(dialog.textContent).toContain(SIGN_IN_DIALOG_COPY.send.doNotContactAcknowledgement(NAME));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect((within(dialog).getByRole("button", { name: "Send invitation" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a refusal shows its sentence in the dialog (it stays open) and re-reads the page", async () => {
    mockSend.mockResolvedValue({ ok: false, error: "The address on file changed while you were looking. Check it and send again." });
    renderCard(card());
    const dialog = open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    });
    expect(within(dialog).getByRole("alert").textContent).toBe("The address on file changed while you were looking. Check it and send again.");
    expect(mockRefresh).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("a thrown action shows the 'couldn't complete' sentence", async () => {
    mockSend.mockRejectedValue(new Error("network"));
    renderCard(card());
    const dialog = open();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    });
    expect(within(dialog).getByRole("alert").textContent).toBe("We couldn't complete that just now. Try again.");
  });

  it("Cancel closes without sending", () => {
    renderCard(card());
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("reopening resets the checkbox and the error", async () => {
    mockSend.mockResolvedValue({ ok: false, error: "x" });
    renderCard(card({ isVisitor: true, outlook: "visitor" }));
    let dialog = open();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    dialog = open();
    expect((within(dialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

describe("SignInCard - send again and cancel", () => {
  it("Send again confirms with the address, calls the resend action and toasts", async () => {
    mockResend.mockResolvedValue({ ok: true, data: { address: ADDRESS, expiresAt: EXPIRES.toISOString(), delivery: "sent" } });
    renderCard(pendingCard());
    fireEvent.click(button("Send again"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(SIGN_IN_DIALOG_COPY.sendAgain.title)).toBeTruthy();
    expect(dialog.textContent).toContain(SIGN_IN_DIALOG_COPY.sendAgain.body(ADDRESS));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send again" }));
    });
    expect(mockResend).toHaveBeenCalledWith("alder-creek", { personId: "p-1", confirmedAddress: ADDRESS, acknowledged: false });
    expect(mockSend).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(SIGN_IN_DIALOG_COPY.sendAgain.toastSent(ADDRESS));
  });

  it("a resend the server wants acknowledged shows the paragraph and the box", async () => {
    mockResend.mockResolvedValue({ ok: false, error: "", needsAcknowledgement: ["do_not_contact"] });
    renderCard(pendingCard());
    fireEvent.click(button("Send again"));
    const dialog = screen.getByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send again" }));
    });
    expect(dialog.textContent).toContain(SIGN_IN_DIALOG_COPY.send.doNotContactAcknowledgement(NAME));
    expect(within(dialog).getByRole("checkbox")).toBeTruthy();
  });

  it("an expired invitation's button reads 'Send a new one' and resends", async () => {
    mockResend.mockResolvedValue({ ok: true, data: { address: ADDRESS, expiresAt: EXPIRES.toISOString(), delivery: "sent" } });
    renderCard(card({ state: "expired", invitedAddress: ADDRESS, addressCurrent: true, sentAt: SENT, expiresAt: EXPIRES }));
    fireEvent.click(button("Send a new one"));
    const dialog = screen.getByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send again" }));
    });
    expect(mockResend).toHaveBeenCalledTimes(1);
  });

  it("Cancel invitation confirms with the cancel copy, revokes, toasts and re-reads", async () => {
    mockRevoke.mockResolvedValue({ ok: true });
    renderCard(pendingCard());
    fireEvent.click(button("Cancel invitation"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(SIGN_IN_DIALOG_COPY.cancel.title)).toBeTruthy();
    expect(dialog.textContent).toContain(SIGN_IN_DIALOG_COPY.cancel.body(NAME));
    expect(mockRevoke).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel invitation" }));
    });
    expect(mockRevoke).toHaveBeenCalledWith("alder-creek", { personId: "p-1" });
    expect(toastSuccess).toHaveBeenCalledWith(SIGN_IN_DIALOG_COPY.cancel.toast);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("'Keep it' leaves the invitation alone", () => {
    renderCard(pendingCard());
    fireEvent.click(button("Cancel invitation"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Keep it" }));
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("a refused cancel shows its sentence in the dialog", async () => {
    mockRevoke.mockResolvedValue({ ok: false, error: "There's no open invitation to change. Reload the page." });
    renderCard(pendingCard());
    fireEvent.click(button("Cancel invitation"));
    const dialog = screen.getByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel invitation" }));
    });
    expect(within(dialog).getByRole("alert").textContent).toBe("There's no open invitation to change. Reload the page.");
  });
});
