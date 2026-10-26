/**
 * The words of the sign-in invitation (Community Increment 2b, Batch B2;
 * Phase 3 Copy as amended by amendment 2 groups D, E, F and I). Every string is
 * pinned by its exact text: a wording change is a decision the operator reads,
 * so it must fail a test loudly. The expected strings below are the operator's
 * Copy, transcribed, not derived from the module under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONNECT_OUTLOOK_COPY,
  ORG_SENT_PANEL_COPY,
  SESSION_BANNER_COPY,
  SIGN_IN_ACTION_CODES,
  SIGN_IN_CARD_COPY,
  SIGN_IN_CARD_HEADING,
  SIGN_IN_DIALOG_COPY,
  SIGN_IN_INVITE_COPY,
  SIGN_IN_MARKER_NO_EMAIL,
  SIGN_IN_REFUSAL_COPY,
  SIGN_IN_REFUSALS_NAMING_THE_PERSON,
  blockedCardLine,
  sessionRowStateLabel,
  signInMarkerLabel,
  signInRefusalMessage,
} from "./sign-in-copy";
import { SIGN_IN_BLOCK_OUTCOMES, SIGN_IN_REFUSALS, SESSION_ROW_STATES } from "./sign-in-types";

const ROOT = path.resolve(__dirname, "../../..");
const fmt = (d: Date) => d.toISOString().slice(0, 10);

describe("sender refusals (SIGN_IN_REFUSAL_COPY)", () => {
  it("covers every database refusal except needs_acknowledgement (not an error) and every action code", () => {
    const covered = Object.keys(SIGN_IN_REFUSAL_COPY).sort();
    const expected = [...SIGN_IN_REFUSALS.filter((r) => r !== "needs_acknowledgement"), ...SIGN_IN_ACTION_CODES].sort();
    expect(covered).toEqual(expected);
    expect(covered).not.toContain("needs_acknowledgement");
  });

  it("the two deleted refusals have no sentence (address_ambiguous, address_invalid)", () => {
    expect(Object.keys(SIGN_IN_REFUSAL_COPY)).not.toContain("address_ambiguous");
    expect(Object.keys(SIGN_IN_REFUSAL_COPY)).not.toContain("address_invalid");
  });

  it("each sentence is the operator-read Copy, with names and numbers inserted", () => {
    const ctx = { name: "Wendeline Ashgrove", congregation: "Quillhaven Fellowship", minutes: 3 };
    const expected: Record<string, string> = {
      forbidden: "You don't have permission to invite people to sign in here.",
      not_found: "That person could not be found.",
      already_signs_in:
        'Wendeline Ashgrove can already sign in. If they\'ve forgotten their password, they can use "Forgot password" on the sign-in page.',
      person_merged: "This person's record was merged into another one, so it can't be invited.",
      person_deceased: "This person's record can't be invited.",
      membership_ended: "This person's connection to Quillhaven Fellowship has ended, so they can't be invited.",
      needs_support: "This needs help from PresbyPortal support. Send us a support ticket.",
      needs_officers_permission:
        "Wendeline Ashgrove holds a seat on the Session or the Board of Deacons. Only someone who can manage officers can invite them.",
      exceeds_your_access:
        "Wendeline Ashgrove holds access that you don't have yourself, so you can't invite them. Ask an administrator who does.",
      no_email_on_file: "Wendeline Ashgrove has no email address on file. Add one, then come back.",
      address_changed: "The address on file changed while you were looking. Check it and send again.",
      address_is_yours: "That's your own email address. Each person needs their own address to sign in.",
      address_shared:
        "Another person at your congregation has the same email address on file. Each person needs their own address to sign in.",
      already_pending: "An invitation is already out. Send it again or cancel it.",
      not_open: "There's no open invitation to change. Reload the page.",
      cooldown: "You sent this a moment ago. You can send it again in 3 minutes.",
      chain_cap:
        "This has been sent several times. Ask Wendeline Ashgrove to check their spam folder, or send us a support ticket.",
      rate_limited: "Too many invitations right now. Try again later.",
      totp_unavailable: "We can't send invitations right now. Send us a support ticket.",
      link_origin_unavailable: "We can't send invitations right now. Send us a support ticket.",
      db_error: "We couldn't complete that just now. Try again.",
    };
    for (const [code, text] of Object.entries(expected)) {
      expect(signInRefusalMessage(code as keyof typeof SIGN_IN_REFUSAL_COPY, ctx), code).toBe(text);
    }
    expect(Object.keys(expected).sort()).toEqual(Object.keys(SIGN_IN_REFUSAL_COPY).sort());
  });

  it("a cooldown of one minute says 'minute', and never less than one", () => {
    expect(signInRefusalMessage("cooldown", { minutes: 1 })).toBe("You sent this a moment ago. You can send it again in 1 minute.");
    expect(signInRefusalMessage("cooldown", { minutes: 0 })).toBe("You sent this a moment ago. You can send it again in 1 minute.");
    expect(signInRefusalMessage("cooldown")).toContain("1 minute.");
  });

  it("a sentence that names the person falls back to 'This person' when no name is known, and one naming the congregation to 'your congregation'", () => {
    expect(signInRefusalMessage("no_email_on_file")).toBe("This person has no email address on file. Add one, then come back.");
    expect(signInRefusalMessage("membership_ended", { congregation: "  " })).toBe(
      "This person's connection to your congregation has ended, so they can't be invited.",
    );
  });

  it("the refusals that read a name are exactly the ones whose sentence has a {Name}", () => {
    const withName = SIGN_IN_REFUSALS.filter(
      (r) => r !== "needs_acknowledgement" && signInRefusalMessage(r, { name: "ZZNAME" }).includes("ZZNAME"),
    ).sort();
    expect([...SIGN_IN_REFUSALS_NAMING_THE_PERSON].sort()).toEqual(withName);
  });
});

describe("the card (heading 'Sign in to PresbyPortal')", () => {
  it("states, with the amendments (Contact & address, the connect lines)", () => {
    expect(SIGN_IN_CARD_HEADING).toBe("Sign in to PresbyPortal");
    expect(SIGN_IN_CARD_COPY.connectedThroughSignIn("Oct 22, 2026")).toBe("Connected through sign-in on Oct 22, 2026.");
    expect(SIGN_IN_CARD_COPY.connectedThroughInvitation("Oct 22, 2026")).toBe("Connected through an invitation on Oct 22, 2026.");
    expect(SIGN_IN_CARD_COPY.connectedUnknown("Wendeline")).toBe("Wendeline is connected to a sign-in.");
    expect(SIGN_IN_CARD_COPY.connectedSupport).toBe("To change who signs in as this person, send us a support ticket.");
    expect(SIGN_IN_CARD_COPY.none("Wendeline", "w@example.invalid")).toBe(
      "Invite Wendeline to sign in. We'll email w@example.invalid with a link that works once. Accepting lets them sign in as themselves. It doesn't change what they can do here.",
    );
    expect(SIGN_IN_CARD_COPY.noAddress("Wendeline")).toBe(
      "Wendeline has no email address on file. Add one under Contact & address, then come back.",
    );
    expect(SIGN_IN_CARD_COPY.pending("w@example.invalid", "Oct 20", "Oct 27")).toBe(
      "Invitation sent to w@example.invalid on Oct 20. It expires Oct 27.",
    );
    expect(SIGN_IN_CARD_COPY.sendAgainHint).toBe("Sending again turns off the earlier link.");
    expect(SIGN_IN_CARD_COPY.cooldown(4)).toBe("You sent this a moment ago. You can send it again in 4 minutes.");
    expect(SIGN_IN_CARD_COPY.expired("w@example.invalid", "Oct 27")).toBe("The invitation to w@example.invalid expired on Oct 27.");
    expect(SIGN_IN_CARD_COPY.bounced("w@example.invalid")).toBe(
      "The email to w@example.invalid bounced. Check the address on file, fix it, and send again.",
    );
    expect(SIGN_IN_CARD_COPY.addressChanged("n@example.invalid")).toBe(
      "The address on file changed after this was sent, so the earlier link no longer works. Send again to reach n@example.invalid.",
    );
    expect(SIGN_IN_CARD_COPY.chainCap("Wendeline")).toBe(
      "This has been sent several times. Ask Wendeline to check their spam folder, or send us a support ticket.",
    );
    expect(SIGN_IN_CARD_COPY.loadFailed).toBe("We couldn't load this just now. Reload the page.");
    expect(SIGN_IN_CARD_COPY.buttons).toEqual({
      send: "Send invitation",
      sendAgain: "Send again",
      sendNew: "Send a new one",
      cancel: "Cancel invitation",
    });
    expect(SIGN_IN_CARD_COPY.delivery).toEqual({ queued: "Queued", sent: "Sent", delivered: "Delivered" });
  });

  it("the old 'Add one under Profile' and 'can sign in' lines are gone (the section is named Contact & address)", () => {
    const text = JSON.stringify([SIGN_IN_CARD_COPY.noAddress("X"), SIGN_IN_CARD_COPY.connectedUnknown("X")]);
    expect(text).not.toMatch(/Profile/);
    expect(text).not.toMatch(/can sign in\./);
  });

  it("blocked lines, one per outcome", () => {
    expect(blockedCardLine("membership_ended", "Wendeline", "Quillhaven Fellowship")).toBe(
      "This invitation couldn't be completed because Wendeline's connection to Quillhaven Fellowship has ended.",
    );
    expect(blockedCardLine("person_merged", "Wendeline", "Q")).toBe(
      "This invitation couldn't be completed because Wendeline's record was merged into another one.",
    );
    expect(blockedCardLine("person_deceased", "Wendeline", "Q")).toBe("This person's record can't be invited.");
    expect(blockedCardLine("needs_support", "Wendeline", "Q")).toBe(
      "This invitation couldn't be completed. Send us a support ticket and we'll look into it.",
    );
    expect(SIGN_IN_BLOCK_OUTCOMES.every((o) => blockedCardLine(o, "N", "C").length > 0)).toBe(true);
  });

  it("the connect lines (group D), hedged: 'if it can', 'once they have confirmed', never a promise of prevention", () => {
    expect(CONNECT_OUTLOOK_COPY.by_sign_in("Wendeline", "w@example.invalid")).toBe(
      "When Wendeline signs in with w@example.invalid, PresbyPortal connects them to this record if it can. An invitation also connects them.",
    );
    expect(CONNECT_OUTLOOK_COPY.by_sign_in_second_factor("Wendeline", "w@example.invalid")).toBe(
      "Wendeline holds a role or a seat here. When they sign in with w@example.invalid, PresbyPortal connects them once they have confirmed two-factor sign-in.",
    );
    expect(CONNECT_OUTLOOK_COPY.visitor("Wendeline")).toBe(
      "Wendeline is a visitor, so signing in won't connect them by itself. Send an invitation if you want them to have access.",
    );
    expect(CONNECT_OUTLOOK_COPY.shared_address("Wendeline")).toBe(
      "Wendeline shares this email address with someone else here, so signing in won't connect either of them by itself. Each person needs their own address.",
    );
    expect(CONNECT_OUTLOOK_COPY.turned_off("Quillhaven Fellowship")).toBe(
      "Connecting people when they sign in is turned off for Quillhaven Fellowship. An invitation still connects them.",
    );
    expect(CONNECT_OUTLOOK_COPY.pendingInvitation("Wendeline")).toBe(
      "While this invitation is open, signing in does not connect Wendeline by itself. They accept the invitation instead.",
    );
  });
});

describe("dialogs and toasts", () => {
  it("send", () => {
    const d = SIGN_IN_DIALOG_COPY.send;
    expect(d.title("Wendeline")).toBe("Send an invitation to Wendeline?");
    expect(d.body("Wendeline", "w@example.invalid", "October 27, 2026")).toBe(
      "We'll email w@example.invalid. The link works once and expires on October 27, 2026. Only send it if that address belongs to Wendeline: whoever opens the link becomes Wendeline on PresbyPortal.",
    );
    expect(d.visitorAcknowledgement("Wendeline")).toBe(
      "Wendeline is recorded as a visitor. Anyone who signs in can see your member directory and your calendar, with each person's privacy settings applied. Only continue if you want Wendeline to have that.",
    );
    expect(d.doNotContactAcknowledgement("Wendeline")).toBe(
      "Wendeline asked not to be contacted at this address. This is a one-time account email, not marketing. Send it anyway?",
    );
    expect(d.checkbox).toBe("I understand, send it anyway");
    expect([d.cancel, d.confirm]).toEqual(["Cancel", "Send invitation"]);
    expect(d.toastSent("w@example.invalid", "October 27, 2026")).toBe("Invitation sent to w@example.invalid. It expires October 27, 2026.");
    expect(d.toastQueued).toBe("Invitation saved. The email will go out shortly.");
  });

  it("send again and cancel", () => {
    const a = SIGN_IN_DIALOG_COPY.sendAgain;
    expect(a.title).toBe("Send this invitation again?");
    expect(a.body("w@example.invalid")).toBe("We'll email w@example.invalid a new link. The earlier link stops working.");
    expect([a.cancel, a.confirm]).toEqual(["Cancel", "Send again"]);
    expect(a.toastSent("w@example.invalid")).toBe("Invitation sent again to w@example.invalid.");
    const c = SIGN_IN_DIALOG_COPY.cancel;
    expect(c.title).toBe("Cancel this invitation?");
    expect(c.body("Wendeline")).toBe("The link will stop working, and Wendeline won't be able to sign in until you send a new one.");
    expect([c.keep, c.confirm]).toEqual(["Keep it", "Cancel invitation"]);
    expect(c.toast).toBe("Invitation cancelled.");
  });
});

describe("markers (group E): icon and word, never colour alone", () => {
  it("each state's words", () => {
    expect(signInMarkerLabel({ kind: "pending", sentAt: new Date("2026-10-20T12:00:00Z") }, fmt)).toBe("Invitation sent 2026-10-20");
    expect(signInMarkerLabel({ kind: "expired" }, fmt)).toBe("Invitation expired. Send again");
    expect(signInMarkerLabel({ kind: "bounced" }, fmt)).toBe("Email bounced. Check the address");
    expect(signInMarkerLabel({ kind: "not_connected", noEmail: false }, fmt)).toBe("Not connected yet");
    expect(signInMarkerLabel({ kind: "not_connected", noEmail: true }, fmt)).toBe("Not connected yet");
    expect(signInMarkerLabel({ kind: "blocked" }, fmt)).toBe("Invitation couldn't be completed");
    expect(SIGN_IN_MARKER_NO_EMAIL).toBe("No email on file");
  });

  it("'Can't sign in yet' is gone (it was false for a Google user with a proven address)", () => {
    const all = [
      signInMarkerLabel({ kind: "not_connected", noEmail: true }, fmt),
      signInMarkerLabel({ kind: "expired" }, fmt),
      signInMarkerLabel({ kind: "blocked" }, fmt),
    ].join(" ");
    expect(all).not.toMatch(/can't sign in/i);
  });
});

describe("the Session banner and hand-off (group F)", () => {
  it("line 1 counts members and agrees in number", () => {
    expect(SESSION_BANNER_COPY.noSignIn(1)).toBe(
      "1 member of the Session is recorded, but none has connected a sign-in yet, so no one can approve.",
    );
    expect(SESSION_BANNER_COPY.noSignIn(3)).toBe(
      "3 members of the Session are recorded, but none has connected a sign-in yet, so no one can approve.",
    );
  });

  it("the hand-off, the counts, the other viewers' sentence and the neighbours", () => {
    expect(SESSION_BANNER_COPY.handOff).toBe(
      "A member of the Session is also connected when they sign in with the email address on their record, after confirming two-factor sign-in.",
    );
    expect(SESSION_BANNER_COPY.invitationsOut(2, 5)).toBe(
      "Invitations sent to 2 of the 5 members of the Session. Waiting for them to accept.",
    );
    expect(SESSION_BANNER_COPY.otherViewers).toBe("Ask an administrator to invite your Session members to sign in.");
    expect(SESSION_BANNER_COPY.termsNotStarted).toBe("To approve, a member of the Session also needs to have connected a sign-in.");
    expect(SESSION_BANNER_COPY.noPermission).toBe(
      "Some members of the Session have connected a sign-in, but none of them has permission to approve roll actions. This usually means the Session member role was changed. Ask an administrator to check the Session member role, or send us a support ticket.",
    );
    expect(SESSION_BANNER_COPY.officersNote).toBe(
      "Members of the Session decide who is received onto the roll. Recording a ruling elder, installed pastor, co-pastor or associate pastor here seats them on the Session. They can approve only once they have connected a sign-in, either by signing in with the email address on their record or by accepting an invitation.",
    );
    expect(SESSION_BANNER_COPY.rowLinks).toEqual({ invite: "Invite", open: "Open" });
  });

  it("the row states", () => {
    const sent = new Date("2026-10-20T12:00:00Z");
    expect(sessionRowStateLabel("no_email", fmt, null)).toBe("No email on file");
    expect(sessionRowStateLabel("not_invited", fmt, null)).toBe("Not invited yet");
    expect(sessionRowStateLabel("sent", fmt, sent)).toBe("Invitation sent 2026-10-20");
    expect(sessionRowStateLabel("expired", fmt, sent)).toBe("Invitation expired");
    expect(sessionRowStateLabel("bounced", fmt, sent)).toBe("Email bounced");
    expect(sessionRowStateLabel("blocked", fmt, sent)).toBe("Invitation couldn't be completed");
    for (const s of SESSION_ROW_STATES) expect(sessionRowStateLabel(s, fmt, sent).length).toBeGreaterThan(0);
  });
});

describe("the /invite page for a sign_in invitation, and the platform panel", () => {
  it("summary and the neutral blocked sentences (G6)", () => {
    expect(SIGN_IN_INVITE_COPY.summary("Quillhaven Fellowship")).toBe(
      "Quillhaven Fellowship invited you to sign in. Signing in lets you see what Quillhaven Fellowship shares with its people. What you can do depends on your role there.",
    );
    expect(SIGN_IN_INVITE_COPY.blockedOwnOrganization("Quillhaven Fellowship")).toBe(
      "This invitation can't be completed. Contact Quillhaven Fellowship's office.",
    );
    expect(SIGN_IN_INVITE_COPY.blockedSharedAddress).toBe(
      "This email address is already connected to someone else's record at this congregation, for example a family member. Each person needs their own address. Contact the person who invited you.",
    );
    expect(SIGN_IN_INVITE_COPY.blockedOther).toBe("This invitation can't be completed. Contact the person who invited you.");
  });

  it("the org-sent panel", () => {
    expect(ORG_SENT_PANEL_COPY.heading).toBe("Sign-in invitations sent by this organization");
    expect(ORG_SENT_PANEL_COPY.counts(1, 2, 3, 4)).toBe("1 open, 2 accepted, 3 expired, 4 cancelled.");
    expect(ORG_SENT_PANEL_COPY.revokeAllButton(6)).toBe("Cancel all open sign-in invitations (6)");
    expect(ORG_SENT_PANEL_COPY.revokeAllConfirm).toBe(
      "This stops every open sign-in link this congregation has sent. People who already accepted keep their access. The congregation can send new ones.",
    );
    expect(ORG_SENT_PANEL_COPY.designationsButton(2)).toBe("Cancel all open designation invitations (2)");
  });
});

describe("what the copy never claims", () => {
  const strings = (): string[] => {
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") out.push(v);
      else if (typeof v === "function") {
        try {
          const r = (v as (...a: unknown[]) => unknown)("N", "A", "C", 1, 2);
          if (typeof r === "string") out.push(r);
        } catch {
          /* a function needing a Date */
        }
      } else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    [SIGN_IN_CARD_COPY, CONNECT_OUTLOOK_COPY, SIGN_IN_DIALOG_COPY, SESSION_BANNER_COPY, SIGN_IN_INVITE_COPY, ORG_SENT_PANEL_COPY].forEach(walk);
    for (const code of Object.keys(SIGN_IN_REFUSAL_COPY)) out.push(signInRefusalMessage(code as keyof typeof SIGN_IN_REFUSAL_COPY, { name: "N", congregation: "C", minutes: 2 }));
    return out;
  };

  it("never uses the analyst's 'two-step', never claims a connection is prevented or guaranteed, and never says a sender confirmed an address", () => {
    const all = strings();
    expect(all.length).toBeGreaterThan(60);
    for (const s of all) {
      expect(s, s).not.toMatch(/two-step|prevent|guarantee|verified by|confirmed by (the )?(sender|office)/i);
    }
  });

  it("is pure: it imports nothing from the database, the server runtime or the library", () => {
    const source = readFileSync(path.join(ROOT, "src/lib/onboarding/sign-in-copy.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/@\/lib\/db|server-only|audit-tx|org-invite|from "\.\/issue"/);
    expect(code).toMatch(/from "\.\/sign-in-types"/);
  });
});
