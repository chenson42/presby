import { describe, expect, it } from "vitest";
import { OPEN_TO_EVERYONE_LABEL, openToEveryoneHint } from "./website-listing-copy";

describe("openToEveryoneHint (DECISION-316; operator ruling 2026-11-02, visitors only)", () => {
  it("names visitors as the people who do not see an unticked event, and the organization", () => {
    const hint = openToEveryoneHint("Alder Creek Presbyterian Church");
    expect(hint).toContain("visitors to Alder Creek Presbyterian Church do not see the event on the calendar");
  });

  it("never claims that ONLY members see it (Inactive, Moved away, staff and managers still do)", () => {
    const hint = openToEveryoneHint("Alder Creek");
    expect(hint).not.toMatch(/only (?:members|on the member calendar)/i);
    expect(hint).toContain("Members, staff and everyone else who can see the calendar still do.");
  });

  it("keeps the Copy month and website consequences", () => {
    const hint = openToEveryoneHint("Alder Creek");
    expect(hint).toContain("stays out of Copy month");
    expect(hint).toContain("cannot be shown on the website");
  });

  it("the label the help page quotes is unchanged", () => {
    expect(OPEN_TO_EVERYONE_LABEL).toBe("Open to everyone, not only members");
  });
});
