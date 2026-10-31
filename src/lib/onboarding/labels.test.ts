/**
 * `inviteeBlockedCopy` and the blocked-reason tables (Community Increment 2b,
 * Batch B2; G6): what the invitee reads when an acceptance was blocked, by
 * PURPOSE. A designation keeps its existing sentences byte for byte; a sign_in
 * invitation reads neutral variants that never explain why a record is in the
 * state it is in.
 */
import "@/lib/db/schema";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_INVITATION_BLOCKED_REASONS,
  ACCOUNT_INVITATION_BLOCKED_REASONS_ALLOWED,
  ACCOUNT_INVITATION_PURPOSES_ALLOWED,
} from "@/lib/db/domain/invitations";
import {
  BLOCKED_REASON_OPERATOR_COPY,
  INVITEE_BLOCKED_COPY,
  PURPOSE_LABEL,
  inviteeBlockedCopy,
} from "./labels";

describe("the tables are total over the widened vocabulary", () => {
  it("both blocked tables carry every reason the CHECK admits, including person_deceased", () => {
    expect(Object.keys(BLOCKED_REASON_OPERATOR_COPY).sort()).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS_ALLOWED].sort());
    expect(Object.keys(INVITEE_BLOCKED_COPY).sort()).toEqual([...ACCOUNT_INVITATION_BLOCKED_REASONS_ALLOWED].sort());
  });

  it("PURPOSE_LABEL carries every purpose", () => {
    expect(Object.keys(PURPOSE_LABEL).sort()).toEqual([...ACCOUNT_INVITATION_PURPOSES_ALLOWED].sort());
  });
});

describe("inviteeBlockedCopy", () => {
  it("a founding administrator or treasurer reads the existing sentence, whatever organization name is passed", () => {
    for (const purpose of ["founding_administrator", "treasurer"] as const) {
      for (const reason of ACCOUNT_INVITATION_BLOCKED_REASONS) {
        expect(inviteeBlockedCopy(purpose, reason, "Quillhaven Fellowship"), `${purpose}/${reason}`).toBe(INVITEE_BLOCKED_COPY[reason]);
      }
    }
  });

  it("a sign_in invitation's own-organization reasons read the neutral office sentence naming the congregation", () => {
    for (const reason of ["membership_ended", "person_merged", "person_deceased"] as const) {
      expect(inviteeBlockedCopy("sign_in", reason, "Quillhaven Fellowship")).toBe(
        "This invitation can't be completed. Contact Quillhaven Fellowship's office.",
      );
    }
  });

  it("the sentence for two records sharing an address names a family member and asks for their own address", () => {
    for (const reason of ["ambiguous_person", "person_linked_elsewhere"] as const) {
      expect(inviteeBlockedCopy("sign_in", reason, "Quillhaven Fellowship")).toBe(
        "This email address is already connected to someone else's record at this congregation, for example a family member. Each person needs their own address. Contact the person who invited you.",
      );
    }
  });

  it("person_elsewhere, and any reason the sign_in branch cannot commit, read the neutral sentence", () => {
    for (const reason of ["person_elsewhere", "has_holders", "not_applicable", "provisioning_incomplete"] as const) {
      expect(inviteeBlockedCopy("sign_in", reason, "Quillhaven Fellowship")).toBe("This invitation can't be completed. Contact the person who invited you.");
    }
  });

  it("a missing organization name falls back to 'your congregation'", () => {
    expect(inviteeBlockedCopy("sign_in", "membership_ended")).toBe("This invitation can't be completed. Contact your congregation's office.");
    expect(inviteeBlockedCopy("sign_in", "person_merged", "   ")).toBe("This invitation can't be completed. Contact your congregation's office.");
  });

  it("no sign_in sentence reveals why (ended, merged, deceased are indistinguishable) or that an account exists", () => {
    const three = new Set(
      (["membership_ended", "person_merged", "person_deceased"] as const).map((r) => inviteeBlockedCopy("sign_in", r, "C")),
    );
    expect(three.size).toBe(1);
    for (const reason of ACCOUNT_INVITATION_BLOCKED_REASONS_ALLOWED) {
      expect(inviteeBlockedCopy("sign_in", reason, "C"), reason).not.toMatch(/deceased|merged|ended|no account|sign up/i);
    }
  });

  it("an unknown purpose throws rather than falling into another purpose's text (F196's TypeScript half)", () => {
    expect(() => inviteeBlockedCopy("mystery" as never, "person_merged")).toThrow(/Unhandled invitation purpose/);
  });
});
