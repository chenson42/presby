import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_RECORD_REFUSALS,
  PARTICIPANT_VOID_REFUSALS,
} from "@/lib/roll-action-kinds";
import {
  CREATE_COPY,
  PARTICIPANT_COPY,
  SUCCESS_COPY,
  VALIDATION_COPY,
} from "./participant-copy";

describe("participant copy table", () => {
  it("has non-empty copy for every record refusal, every void refusal, and forbidden", () => {
    for (const code of [
      ...PARTICIPANT_RECORD_REFUSALS,
      ...PARTICIPANT_VOID_REFUSALS,
      "forbidden" as const,
    ]) {
      expect(typeof PARTICIPANT_COPY[code], code).toBe("string");
      expect(PARTICIPANT_COPY[code].length, code).toBeGreaterThan(10);
    }
  });

  it("carries no code the database cannot return (no dead copy)", () => {
    const known = new Set<string>([
      ...PARTICIPANT_RECORD_REFUSALS,
      ...PARTICIPANT_VOID_REFUSALS,
      "forbidden",
    ]);
    for (const code of Object.keys(PARTICIPANT_COPY)) {
      expect(known.has(code), code).toBe(true);
    }
  });

  it("never leaks a code, a function name or a database term into user copy", () => {
    const everything = [
      ...Object.values(PARTICIPANT_COPY),
      ...Object.values(VALIDATION_COPY),
      ...Object.values(SUCCESS_COPY),
      ...Object.values(CREATE_COPY),
    ];
    for (const text of everything) {
      expect(text).not.toMatch(/presby_|roll_actions|sqlstate|constraint|memberships_guard|_/);
    }
  });

  it("uses the Phase 3 wording for the refusals an administrator will actually meet", () => {
    expect(PARTICIPANT_COPY.pending_action).toBe(
      "This person has a roll action waiting for the Session, so this can't be recorded yet. Try again once the Session has decided it or it has been withdrawn. Withdrawing is done from Pending approvals, by someone who can propose roll actions.",
    );
    expect(PARTICIPANT_COPY.pending_action).toMatch(/withdrawn/);
    expect(PARTICIPANT_COPY.pending_action).not.toMatch(/Wait for the Session/);
    expect(PARTICIPANT_COPY.holds_position).toMatch(/office, a role or a staff position/);
    expect(PARTICIPANT_COPY.self_target).toMatch(/remove yourself/);
    expect(PARTICIPANT_COPY.forbidden).toBe("You don't have permission to record roll actions here.");
  });
});
