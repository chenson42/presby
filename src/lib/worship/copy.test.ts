import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_COPY,
  BOARD_COPY,
  EMAIL_COPY,
  EMAIL_LINE_CAP,
  FEATURES_WARNING_COPY,
  FEATURE_COPY,
  GATE_COPY,
  HUB_COPY,
  MEMBER_COPY,
  NAV_COPY,
  PERMISSION_COPY,
  PLATFORM_ADMIN_LABELS,
  SERVICES_COPY,
  TEAMS_COPY,
  TEMPLATE_ROLE_NAME,
  TILE_COPY,
} from "./copy";
import { REASONS } from "./vocab";

const SOURCE = readFileSync(path.resolve(__dirname, "copy.ts"), "utf8");

/** Every string a function in an object returns, or the string itself, flattened. */
function strings(value: unknown, args: unknown[] = ["Name", "Name", "Name", "Name"]): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    try {
      const out = (value as (...a: unknown[]) => unknown)(...args);
      return strings(out, args);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, args));
  if (value && typeof value === "object") return Object.values(value).flatMap((v) => strings(v, args));
  return [];
}

const ALL = {
  TILE_COPY,
  FEATURE_COPY,
  PERMISSION_COPY,
  PLATFORM_ADMIN_LABELS,
  GATE_COPY,
  ACTION_COPY,
  HUB_COPY,
  TEAMS_COPY,
  SERVICES_COPY,
  BOARD_COPY,
  MEMBER_COPY,
  EMAIL_COPY,
  FEATURES_WARNING_COPY,
};

describe("the word 'session' appears nowhere (G3: a session is the church court, not a rehearsal)", () => {
  it("not in any rendered string", () => {
    const found = Object.entries(ALL).flatMap(([name, group]) =>
      strings(group).filter((s) => /session/i.test(s)).map((s) => `${name}: ${s}`),
    );
    expect(found).toEqual([]);
  });

  it("not in the source of copy.ts outside this rule's own mention in comments", () => {
    const code = SOURCE.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
    expect(/session/i.test(code)).toBe(false);
  });
});

describe("G1 - tile, catalog, permissions, template (byte for byte)", () => {
  it("the member tile, admin tile, Features card and template name", () => {
    expect(TILE_COPY.member).toEqual({
      label: "Worship",
      description: "See when you're asked to serve, answer requests, and set dates you can't serve.",
    });
    expect(TILE_COPY.admin).toEqual({
      label: "Plan worship",
      description: "For the people who plan worship. Set up teams and positions, plan services, and schedule people.",
    });
    expect(FEATURE_COPY).toEqual({
      name: "Worship",
      description:
        "Lets your congregation set up worship teams, plan services on the calendar, and ask people to serve. Turning this off hides every worship page and stops requests and reminders. Nothing is deleted.",
    });
    expect(TEMPLATE_ROLE_NAME).toBe("Worship Leader");
    expect(PLATFORM_ADMIN_LABELS).toEqual({
      "worship.manage": "worship teams",
      "worship.plan": "worship services",
      "worship.schedule": "worship scheduling",
    });
  });

  it("the permission descriptions equal the ones the migration inserts", () => {
    const migration = readFileSync(path.resolve(__dirname, "../../../drizzle/0085_presby_worship.sql"), "utf8");
    for (const description of Object.values(PERMISSION_COPY)) expect(migration).toContain(description);
  });
});

describe("G2 - gate and error states", () => {
  it("the off, not-applicable, forbidden, load-error and closed-request strings", () => {
    expect(GATE_COPY.off("Alder Creek")).toBe("Worship isn't turned on for Alder Creek yet.");
    expect(GATE_COPY.offLink).toBe("Turn it on under Features");
    expect(GATE_COPY.offAsk("Alder Creek")).toBe("Ask someone who manages Alder Creek's features to turn it on.");
    expect(GATE_COPY.notApplicable).toBe("Worship planning is for congregations and new worshiping communities.");
    expect(GATE_COPY.forbidden("Alder Creek")).toBe(
      "You don't have permission to plan worship at Alder Creek. If you think this is a mistake, ask your stated clerk or another administrator there.",
    );
    expect(GATE_COPY.loadError).toBe("We couldn't load worship right now. Try again in a moment.");
    expect(GATE_COPY.closedRequest).toEqual({
      heading: "This request is no longer open",
      body: "The service was cancelled, it has already started, or the request was taken back. Your other requests are on your schedule.",
      link: "Go to my schedule",
    });
  });

  it("the action strings", () => {
    expect(ACTION_COPY.generic).toBe("We couldn't save that. Try again.");
    expect(ACTION_COPY.forbidden).toBe("You don't have permission to do that.");
    expect(ACTION_COPY.stale).toBe("That has changed. Refresh the page and try again.");
    expect(ACTION_COPY.serviceStarted).toBe("That service has already started.");
    expect(ACTION_COPY.serviceCancelled).toBe("That service was cancelled.");
    expect(ACTION_COPY.notOnTeam("Pat Quimby")).toBe("Pat Quimby is no longer on this team.");
    expect(ACTION_COPY.teamRetired("Praise band")).toBe("Praise band has been retired.");
    expect(ACTION_COPY.inUse("Praise band", 3)).toBe("Praise band is still scheduled for 3 upcoming services. Remove those people first.");
    expect(ACTION_COPY.inUse("Drums", 1)).toBe("Drums is still scheduled for 1 upcoming service. Remove those people first.");
    expect(ACTION_COPY.roleBound).toBe(
      "This team's people receive a role, so only someone who manages groups can change who is on it.",
    );
    expect(ACTION_COPY.sendNothing).toBe("There's nothing to send. Add people first.");
    expect(ACTION_COPY.sendMailUnavailable).toBe("We couldn't send requests right now. Nothing was changed.");
    expect(ACTION_COPY.sendOverCap).toBe("You can send up to 200 requests at once. Send fewer, then send again.");
  });
});

describe("G3 - teams", () => {
  it("the seat note and the Groups helper state the reimbursement coupling and never say a leader 'only schedules' (R6)", () => {
    expect(TEAMS_COPY.page.seatNote).toBe(
      "Chairs and leaders are chosen under Groups. A chair or leader can schedule people for this team and, where reimbursements are in use and your treasurer has allowed requests for this group, can approve them.",
    );
    expect(TEAMS_COPY.groupsHelper).toBe(
      "A chair or leader can also schedule people when this group is a worship team, and can approve this group's reimbursement requests when your treasurer allows requests for it.",
    );
    for (const text of [TEAMS_COPY.page.seatNote, TEAMS_COPY.groupsHelper]) expect(text).not.toMatch(/\bonly\b/i);
  });

  it("the dialogs and validation strings", () => {
    expect(TEAMS_COPY.removeDialog.title("Pat Quimby", "Praise band")).toBe("Remove Pat Quimby from Praise band?");
    expect(TEAMS_COPY.removeDialog.body).toBe(
      "They stay on record and are no longer offered for this team. Anything they're already scheduled for stays as it is.",
    );
    expect(TEAMS_COPY.retireTeamDialog.title("Praise band")).toBe("Retire Praise band?");
    expect(TEAMS_COPY.retirePositionDialog.body).toBe("It stops being offered. People already scheduled for it stay as they are.");
    expect(TEAMS_COPY.validation.positionDuplicate("Drums")).toBe("You already have a position called Drums on this team.");
    expect(TEAMS_COPY.validation.notOnRoll("Alder Creek")).toBe(
      "Only people with a current record at Alder Creek can be added to a team.",
    );
    expect(TEAMS_COPY.validation.seatsUnderGroups).toBe("Chairs and leaders are changed under Groups.");
    expect(TEAMS_COPY.rowCounts(4, 7)).toBe("4 people, 7 positions");
  });
});

describe("G4 - services", () => {
  it("the cancel dialog says where an address exists and that the schedule stays on record (it does not promise everyone is told)", () => {
    expect(SERVICES_COPY.cancelDialog.body).toBe(
      "It is marked Cancelled in your services list and leaves the calendar. We email the people who were asked or scheduled, where we have an address for them, and open requests are closed. Their schedule stays on record.",
    );
    expect(SERVICES_COPY.cancelDialog.body).toContain("where we have an address");
  });

  it("the list and form strings", () => {
    expect(SERVICES_COPY.list.filled(3, 7)).toBe("3 of 7 positions filled");
    expect(SERVICES_COPY.list.waiting(2)).toBe("2 waiting for an answer");
    expect(SERVICES_COPY.form.duplicate("Sunday worship")).toBe("There's already a service at that time: Sunday worship.");
    expect(SERVICES_COPY.several.tooMany).toBe("You can add up to 26 at a time.");
    expect(SERVICES_COPY.several.repeatOptions).toEqual({ weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly (same date)" });
  });
});

describe("G5 - board, picker, Send", () => {
  it("the reach notes (the minor note says 'may be', never 'is')", () => {
    expect(BOARD_COPY.reach).toEqual({
      emailed: "Request emailed.",
      guardian: "No email sent: may be under 18. Ask a parent or guardian, then record their answer.",
      noAddress: "No email sent: no email address on file.",
      doNotContact: "No email sent: marked do not contact.",
    });
    for (const text of Object.values(BOARD_COPY.reach)) expect(text).not.toMatch(/\bis (a )?minor\b/i);
  });

  it("the chips: Declined carries its closed-list reason", () => {
    expect(BOARD_COPY.chips.draft).toBe("Not sent yet");
    expect(BOARD_COPY.chips.requested).toBe("Waiting for an answer");
    for (const reason of REASONS) {
      expect(BOARD_COPY.chips.declinedWithReason(reason)).toMatch(/^Declined: (Away|Work|Family|Other)$/);
    }
  });

  it("the remove dialog tells the leader nobody is messaged (F430)", () => {
    expect(BOARD_COPY.removeDialog.bodySent).toBe(
      "They stay on record. They aren't sent a message about this, so let them know yourself.",
    );
    expect(BOARD_COPY.removeDialog.bodyDraft).toBe("They haven't been asked yet.");
  });

  it("the Send dialog", () => {
    expect(BOARD_COPY.send.button(5)).toBe("Send requests (5)");
    expect(BOARD_COPY.send.title(5)).toBe("Send 5 requests?");
    expect(BOARD_COPY.send.title(1)).toBe("Send 1 request?");
    expect(BOARD_COPY.send.body(4, 1, 2, 1)).toBe(
      "Each person gets one email listing their positions and dates. 4 can't be emailed (1 may be under 18, 2 have no email address, 1 are marked do not contact). For them, record their answer yourself.",
    );
    expect(BOARD_COPY.send.toast(3, 2)).toBe("Requests sent. 3 emailed, 2 not emailed.");
  });

  it("the picker and the guest hint", () => {
    expect(BOARD_COPY.guestHint).toBe("Just a name. Contact details aren't kept here.");
    expect(BOARD_COPY.picker.cantServeOn("Sunday, November 16")).toBe("Can't serve on Sunday, November 16");
    expect(BOARD_COPY.picker.mayBeUnder18).toBe("May be under 18. They won't get an email.");
    expect(BOARD_COPY.record.helper).toBe("This is saved as entered by you.");
  });
});

describe("G6 - member pages", () => {
  it("the home sections and request page", () => {
    expect(MEMBER_COPY.home.waiting).toBe("Waiting for your answer");
    expect(MEMBER_COPY.home.scheduled).toBe("You're scheduled");
    expect(MEMBER_COPY.home.declined).toBe("You said you can't serve");
    expect(MEMBER_COPY.home.serveAfterAll).toBe("I can serve after all");
    expect(MEMBER_COPY.request.body("Alder Creek", "Drums", "Praise band", "Sunday, November 16 at 9:00 AM")).toBe(
      "Alder Creek asks you to serve as Drums with Praise band on Sunday, November 16 at 9:00 AM.",
    );
    expect(MEMBER_COPY.request.reasonHelper).toBe("People who schedule worship can see this.");
    expect(MEMBER_COPY.request.toastDeclined).toBe("Thanks for letting us know. You're not scheduled for that date.");
  });

  it("the blockout strings: a blockout never cancels what was agreed", () => {
    expect(MEMBER_COPY.blockouts.helper).toBe(
      "People who schedule worship are told when you've saved a date they're choosing for, but they don't see your reason. Saving dates doesn't cancel anything you've already agreed to.",
    );
    expect(MEMBER_COPY.blockouts.row("Dec 1", "Dec 8", "away")).toBe("Dec 1 to Dec 8, Away");
    expect(MEMBER_COPY.blockouts.row("Dec 1", "Dec 8", null)).toBe("Dec 1 to Dec 8");
    expect(MEMBER_COPY.blockouts.conflict("Sunday, December 7")).toBe(
      "You're already confirmed to serve on Sunday, December 7. This doesn't change that. Let the person who asked you know.",
    );
    expect(MEMBER_COPY.blockouts.tooMany).toBe("You can save up to 50 sets of dates. Remove some you no longer need.");
  });
});

describe("G9 - strings reviewed in Phase 3 amendment 3", () => {
  it("the Groups role note no longer denies the role coupling, and names no access it does not give", () => {
    expect(TEAMS_COPY.groupsRoleNote).toBe(
      "Member, Chair and Leader describe a person's part in the group. If the group has been given a role, everyone in it gets that role, whatever their part.",
    );
    expect(TEAMS_COPY.groupsRoleNote).not.toMatch(/no access/i);
  });

  it("the empty states name no action the surface's default role cannot take", () => {
    expect(NAV_COPY.teamNone).toBe("No teams yet. When a team has been made, you can choose it here.");
    expect(NAV_COPY.noServiceTypesTitle).toBe("No service types yet.");
    expect(NAV_COPY.noServiceTypesToUse).toBe(
      "Someone who sets up worship needs to save a service type first. Then you can add several services here.",
    );
    expect(NAV_COPY.searchNone).toBe(
      "No one matches that search. People already on this team, and people without a current record, aren't listed.",
    );
    expect(NAV_COPY.teamNone).not.toMatch(/make a team first/i);
    expect(NAV_COPY.noServiceTypesToUse).not.toMatch(/^Save a service type first/);
  });
});

describe("G7 - emails carry no person's name and no free text", () => {
  it("none of the email strings has a slot that takes a person", () => {
    expect(EMAIL_LINE_CAP).toBe(12);
    expect(EMAIL_COPY.request.subject("Alder Creek")).toBe("Alder Creek: a request to serve");
    expect(EMAIL_COPY.request.footnote).toBe("You need to sign in to answer. If you can't, let whoever asked you know.");
    expect(EMAIL_COPY.declined.body("Drums", "Sunday, November 16 at 9:00 AM")).toBe(
      "Someone you scheduled has declined Drums on Sunday, November 16 at 9:00 AM.",
    );
    expect(EMAIL_COPY.declined.footnote).toBe("This message doesn't include their name. Open the schedule to see who.");
    expect(EMAIL_COPY.cancelled.body("Sunday, November 16 at 9:00 AM")).toBe(
      "The service on Sunday, November 16 at 9:00 AM was cancelled, so you are not serving that day.",
    );
    expect(EMAIL_COPY.reminderConfirmed.footnote).toBe(
      "Can't make it any more? Open your schedule and choose Decline, or tell your team leader.",
    );
  });
});

describe("G8 - the Features warning", () => {
  it("plural, singular and fallback", () => {
    expect(FEATURES_WARNING_COPY.title).toBe("People are scheduled for upcoming services");
    expect(FEATURES_WARNING_COPY.description(4)).toBe(
      "4 people are asked or scheduled for upcoming services. Turning this off hides the schedule and stops requests and reminders. People who were asked can't answer until you turn it back on. Nothing is deleted.",
    );
    expect(FEATURES_WARNING_COPY.description(1)).toMatch(/^1 person is asked or scheduled for upcoming services\./);
    expect(FEATURES_WARNING_COPY.fallbackTitle).toBe("People may be scheduled for upcoming services");
    expect(FEATURES_WARNING_COPY.fallbackDescription).toBe(
      "We couldn't check who is scheduled just now. Turning this off hides the schedule and stops requests and reminders. Nothing is deleted.",
    );
  });
});

describe("hub", () => {
  it("the three cards", () => {
    expect(HUB_COPY.heading).toBe("Plan worship");
    expect(HUB_COPY.cards.services.title).toBe("Services");
    expect(HUB_COPY.cards.teams.title).toBe("Teams");
    expect(HUB_COPY.cards.serviceTypes.title).toBe("Service types");
  });
});
