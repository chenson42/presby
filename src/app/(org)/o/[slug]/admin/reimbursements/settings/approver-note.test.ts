import { describe, expect, it } from "vitest";
import { approverNote } from "./approver-note";

describe("approverNote (Copy C9)", () => {
  it("counts chairs or leaders, singular and plural", () => {
    expect(approverNote({ membershipSource: "managed", approverCount: 1 })).toBe("1 chair or leader can approve.");
    expect(approverNote({ membershipSource: "managed", approverCount: 3 })).toBe("3 chairs or leaders can approve.");
  });

  it("says requests go to the treasurer when there is no one, with the managed and derived wordings", () => {
    expect(approverNote({ membershipSource: "managed", approverCount: 0 })).toBe(
      "No chair or leader right now: requests go to the treasurer.",
    );
    expect(approverNote({ membershipSource: "derived", approverCount: 0 })).toBe(
      "No chair or leader: requests go to the treasurer.",
    );
  });
});
