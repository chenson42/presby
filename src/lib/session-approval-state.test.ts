import { describe, expect, it } from "vitest";
import {
  deriveSessionApprovalKind,
  type SessionApprovalCounts,
} from "./session-approval-state";

function counts(overrides: Partial<SessionApprovalCounts> = {}): SessionApprovalCounts {
  return {
    hasSessionGroup: true,
    recorded: 0,
    startingLater: 0,
    withAccount: 0,
    canApprove: 0,
    ...overrides,
  };
}

describe("deriveSessionApprovalKind (Flow 7)", () => {
  it("no Session group is no_session, whatever else is true", () => {
    expect(deriveSessionApprovalKind(counts({ hasSessionGroup: false }))).toBe("no_session");
    expect(
      deriveSessionApprovalKind(
        counts({ hasSessionGroup: false, recorded: 3, withAccount: 3, canApprove: 3 }),
      ),
    ).toBe("no_session");
  });

  it("a Session group with nobody seated now or later is empty", () => {
    expect(deriveSessionApprovalKind(counts())).toBe("empty");
  });

  it("seats that all start later are terms_not_started, not empty and not no_sign_in", () => {
    expect(deriveSessionApprovalKind(counts({ recorded: 0, startingLater: 2 }))).toBe(
      "terms_not_started",
    );
  });

  it("future-dated seat holders never reach no_sign_in, whether or not they have accounts", () => {
    expect(
      deriveSessionApprovalKind(counts({ recorded: 0, startingLater: 1, withAccount: 0 })),
    ).toBe("terms_not_started");
    expect(
      deriveSessionApprovalKind(
        counts({ recorded: 0, startingLater: 1, withAccount: 1, canApprove: 1 }),
      ),
    ).toBe("terms_not_started");
  });

  it("order: no_session beats terms_not_started; empty is only recorded 0 and startingLater 0", () => {
    expect(
      deriveSessionApprovalKind(counts({ hasSessionGroup: false, startingLater: 2 })),
    ).toBe("no_session");
    expect(deriveSessionApprovalKind(counts({ recorded: 0, startingLater: 0 }))).toBe("empty");
    expect(deriveSessionApprovalKind(counts({ recorded: 0, startingLater: 1 }))).not.toBe("empty");
  });

  it("seated members with no account are no_sign_in", () => {
    expect(deriveSessionApprovalKind(counts({ recorded: 4, withAccount: 0 }))).toBe("no_sign_in");
  });

  it("accounts exist but nobody holds roll.approve is no_permission", () => {
    expect(
      deriveSessionApprovalKind(counts({ recorded: 3, withAccount: 2, canApprove: 0 })),
    ).toBe("no_permission");
  });

  it("one seated member with an account who holds roll.approve is ready", () => {
    expect(
      deriveSessionApprovalKind(counts({ recorded: 3, withAccount: 1, canApprove: 1 })),
    ).toBe("ready");
  });

  it("a seat that starts later does not make a ready Session unready", () => {
    expect(
      deriveSessionApprovalKind(
        counts({ recorded: 1, startingLater: 1, withAccount: 1, canApprove: 1 }),
      ),
    ).toBe("ready");
  });
});
