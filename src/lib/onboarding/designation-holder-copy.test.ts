/**
 * The pure copy file for the designation-holder list and revoke (docs/work-log/
 * 2026-10-22-designation-revoke.md, Phase 3 "Copy"). No database.
 */
import { describe, expect, it } from "vitest";
import {
  DIALOG_BUTTONS,
  OUTCOME_COPY,
  PROVENANCE_COPY,
  REASON_COPY,
  codePointLength,
  derivedRowText,
  formatSince,
  groupRowCount,
  parseReason,
  reasonSchema,
  revokeButtonLabel,
  revokeDialogContent,
  revokedMessage,
  sectionLead,
} from "./designation-holder-copy";
import type { HolderRow } from "./designation-holder-types";

function row(overrides: Partial<HolderRow> = {}): HolderRow {
  return {
    key: "person:p1",
    subjectKind: "person",
    subjectId: "p1",
    displayName: "Perpetua Ashgrove",
    holderPeopleCount: 1,
    since: "2026-10-01",
    provenance: "designation",
    roleNames: ["Founding Administrator"],
    companionRoleNames: [],
    permissions: [{ key: "roles.manage", description: "Create and edit roles" }],
    grantIds: ["g1"],
    alsoThroughGroupNames: [],
    leavesNoHolders: true,
    revocable: true,
    derivedGroupName: null,
    ...overrides,
  };
}

describe("reasonSchema (10 to 500 code points, trimmed, no control characters)", () => {
  it("trims, then accepts 10 characters and rejects 9", () => {
    expect(parseReason("  1234567890  ")).toEqual({ ok: true, reason: "1234567890" });
    expect(parseReason("123456789")).toEqual({ ok: false, message: REASON_COPY.short });
  });

  it("rejects empty, whitespace-only and non-string input as too short", () => {
    expect(parseReason("")).toEqual({ ok: false, message: REASON_COPY.short });
    expect(parseReason("            ")).toEqual({ ok: false, message: REASON_COPY.short });
    expect(parseReason(null)).toEqual({ ok: false, message: REASON_COPY.short });
    expect(parseReason(42)).toEqual({ ok: false, message: REASON_COPY.short });
  });

  it("counts code points: 500 emoji pass and 501 fail", () => {
    expect(parseReason("\u{1F600}".repeat(500)).ok).toBe(true);
    expect(parseReason("\u{1F600}".repeat(501))).toEqual({ ok: false, message: REASON_COPY.long });
    expect(codePointLength("\u{1F600}\u{1F600}")).toBe(2);
  });

  it("rejects control characters but allows a newline and a tab inside", () => {
    expect(parseReason("a reason with a bell \u0007 inside")).toEqual({ ok: false, message: REASON_COPY.control });
    expect(parseReason("a reason with a NUL \u0000 inside")).toEqual({ ok: false, message: REASON_COPY.control });
    expect(parseReason("a reason with C1 \u0085 inside")).toEqual({ ok: false, message: REASON_COPY.control });
    expect(parseReason("first line\nsecond\tline ok").ok).toBe(true);
  });

  it("is a zod schema the action and the library share", () => {
    expect(reasonSchema.safeParse("long enough reason").success).toBe(true);
  });
});

describe("formatSince (string split, never a Date)", () => {
  it("formats d Mon yyyy without a leading zero", () => {
    expect(formatSince("2026-10-01")).toBe("1 Oct 2026");
    expect(formatSince("2020-01-15")).toBe("15 Jan 2020");
    expect(formatSince("2026-12-31")).toBe("31 Dec 2026");
  });

  it("returns an unparseable value untouched", () => {
    expect(formatSince("soon")).toBe("soon");
    expect(formatSince("2026-13-01")).toBe("2026-13-01");
  });
});

describe("section and row wording", () => {
  it("leads with the count, singular and plural, per slot", () => {
    expect(sectionLead("founding_administrator", 1)).toMatch(/^1 person can manage roles at this organization\./);
    expect(sectionLead("founding_administrator", 3)).toMatch(/^3 people can manage roles at this organization\./);
    expect(sectionLead("treasurer", 2)).toMatch(/^2 people can manage giving at this organization\./);
  });

  it("the treasurer lead says gift and donor records stay and the platform gains no access", () => {
    expect(sectionLead("treasurer", 1)).toMatch(/Gift and donor records stay as they are, and the platform operator gains no access to them\./);
    expect(sectionLead("founding_administrator", 1)).not.toMatch(/donor/);
  });

  it("no holder-row string contains 'Self-designated' or 'Accepted' (existing e2e strict-mode matches)", () => {
    const strings = [
      sectionLead("founding_administrator", 2),
      sectionLead("treasurer", 2),
      PROVENANCE_COPY.designation,
      PROVENANCE_COPY.other,
      groupRowCount(row({ subjectKind: "group", holderPeopleCount: 3 })),
      derivedRowText(row({ subjectKind: "group", holderPeopleCount: 7, derivedGroupName: "Session", revocable: false })),
      revokeButtonLabel(row()),
      ...Object.values(OUTCOME_COPY),
    ];
    for (const text of strings) {
      expect(text).not.toMatch(/self-designated/i);
      expect(text).not.toMatch(/accepted/i);
    }
  });

  it("uses singular and plural verbs for a group's people", () => {
    expect(groupRowCount(row({ subjectKind: "group", holderPeopleCount: 1 }))).toBe("1 person holds this through the group.");
    expect(groupRowCount(row({ subjectKind: "group", holderPeopleCount: 3 }))).toBe("3 people hold this through the group.");
    expect(derivedRowText(row({ subjectKind: "group", holderPeopleCount: 7, derivedGroupName: "Session", revocable: false }))).toBe(
      "7 people hold this through Session; the congregation's own officers change this.",
    );
  });

  it("labels the button for a person and for a group", () => {
    expect(revokeButtonLabel(row())).toBe("Revoke access for Perpetua Ashgrove");
    expect(revokeButtonLabel(row({ subjectKind: "group", displayName: "Office Volunteers" }))).toBe(
      "Revoke access for the Office Volunteers group",
    );
  });

  it("writes the success sentence, with the invite hint only when the slot is now empty", () => {
    expect(revokedMessage(row(), false)).toBe("Access ended for Perpetua Ashgrove.");
    expect(revokedMessage(row(), true)).toBe("Access ended for Perpetua Ashgrove. Nobody holds this now. Invite a replacement below.");
    expect(revokedMessage(row({ subjectKind: "group", displayName: "Office Volunteers" }), false)).toBe(
      "Access ended for the Office Volunteers group.",
    );
  });
});

describe("revokeDialogContent", () => {
  it("names the person, the organization, the roles and what they carry (founding administrator)", () => {
    const c = revokeDialogContent("founding_administrator", "Alder Creek Church", row());
    expect(c.title).toBe("End Perpetua Ashgrove's access?");
    expect(c.intro).toBe("This ends Perpetua Ashgrove's access to manage roles at Alder Creek Church.");
    expect(c.rolesLine).toBe("This role ends today: Founding Administrator.");
    expect(c.permissionDescriptions).toEqual(["Create and edit roles"]);
    expect(c.treasurerLine).toBeNull();
    expect(c.groupLine).toBeNull();
  });

  it("pluralises the roles line", () => {
    const c = revokeDialogContent("founding_administrator", "X", row({ roleNames: ["A", "B"] }));
    expect(c.rolesLine).toBe("These roles end today: A, B.");
  });

  it("names the companion grant separately when there is one", () => {
    const c = revokeDialogContent("founding_administrator", "X", row({ companionRoleNames: ["Congregation Stated Clerk"] }));
    expect(c.companionLine).toBe("Congregation Stated Clerk was assigned together with the designation and ends with it.");
    expect(revokeDialogContent("founding_administrator", "X", row()).companionLine).toBeNull();
  });

  it("says nobody can manage roles until a replacement is invited when this is the last holder", () => {
    const c = revokeDialogContent("founding_administrator", "X", row({ leavesNoHolders: true }));
    expect(c.lastHolderLine).toBe(
      "Perpetua Ashgrove is the only person who has this access. Nobody will be able to manage roles until you invite a replacement.",
    );
  });

  it("points at the organization's own page when others can still manage", () => {
    const fa = revokeDialogContent("founding_administrator", "X", row({ leavesNoHolders: false }));
    expect(fa.lastHolderLine).toMatch(/Others can still manage roles here\./);
    expect(fa.lastHolderLine).toMatch(/own Roles page/);
    const tr = revokeDialogContent("treasurer", "X", row({ leavesNoHolders: false }));
    expect(tr.lastHolderLine).toMatch(/Others can still manage giving here\./);
    expect(tr.lastHolderLine).toMatch(/own Giving team page/);
  });

  it("says a person will still hold the access through a group", () => {
    const c = revokeDialogContent("founding_administrator", "X", row({ alsoThroughGroupNames: ["Office Volunteers", "Elders"] }));
    expect(c.stillHoldsLine).toBe("Perpetua Ashgrove will still hold this access through Office Volunteers and Elders.");
    expect(revokeDialogContent("founding_administrator", "X", row()).stillHoldsLine).toBeNull();
  });

  it("a group: every counted member loses it, the group and its members are unchanged", () => {
    const c = revokeDialogContent(
      "founding_administrator",
      "X",
      row({ subjectKind: "group", displayName: "Office Volunteers", holderPeopleCount: 3 }),
    );
    expect(c.title).toBe("End access for the Office Volunteers group?");
    expect(c.groupLine).toBe(
      "3 people hold this access through the Office Volunteers group. All of them lose it, unless they hold it another way. The group and its members are not changed.",
    );
    expect(c.stillHoldsLine).toBeNull();
  });

  it("the treasurer wording states donor and gift data stays and the platform gains no access", () => {
    const c = revokeDialogContent("treasurer", "X", row());
    expect(c.intro).toMatch(/manage giving at X\.$/);
    expect(c.treasurerLine).toBe("Gift and donor records are not changed, and ending this gives the platform operator no access to them.");
  });

  it("always says it is recorded in the audit log with the reason and cannot be undone here", () => {
    for (const slot of ["founding_administrator", "treasurer"] as const) {
      expect(revokeDialogContent(slot, "X", row()).recordLine).toMatch(/recorded in the audit log with your reason/);
      expect(revokeDialogContent(slot, "X", row()).recordLine).toMatch(/can't undo it here/);
    }
  });

  it("never carries an email or a constraint name", () => {
    const c = revokeDialogContent("treasurer", "X", row());
    expect(JSON.stringify(c)).not.toMatch(/@|constraint|violat/i);
  });

  it("has the specified button labels", () => {
    expect(DIALOG_BUTTONS).toEqual({ cancel: "Cancel", confirm: "Yes, end access", pending: "Ending…" });
  });
});
