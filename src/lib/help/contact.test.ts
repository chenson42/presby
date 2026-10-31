import { describe, expect, it } from "vitest";
import {
  HELP_CONTACT_ADMIN_LINE,
  HELP_CONTACT_LINE,
  HELP_PRIVACY_CONTACT_FALLBACK,
  HELP_REPOSITORY_URL,
} from "./contact";
import { EXTERNAL_LINK_ALLOWLIST } from "./links";
import { switchedOnText } from "./copy";
import { HELP_CONTACT_HREF } from "./urls";

describe("the contact lines (Increment 2)", () => {
  it("both end with a link to the contact form, and neither promises a reply or a time", () => {
    for (const line of [HELP_CONTACT_LINE, HELP_CONTACT_ADMIN_LINE]) {
      expect(line).toContain(`[send the PresbyPortal team a message](${HELP_CONTACT_HREF})`);
      expect(line).not.toMatch(/\b(within|hours?|days?|promise|guarantee|soon|will reply)\b/i);
    }
  });

  it("the form is never called a ticket; only the administrator line names the other route", () => {
    expect(HELP_CONTACT_LINE).not.toMatch(/ticket/i);
    expect(HELP_CONTACT_ADMIN_LINE).toMatch(/File a ticket/);
    expect(HELP_CONTACT_ADMIN_LINE.replace(/File a ticket/g, "").replace(/then Tickets/g, "")).not.toMatch(/ticket/i);
  });

  it("the administrator line links the page that says how to file a ticket", () => {
    expect(HELP_CONTACT_ADMIN_LINE).toContain("[Getting help](/help/getting-help)");
  });

  it("the repository URL (the exit block's and the privacy fallback's) is in the link allowlist", () => {
    expect(EXTERNAL_LINK_ALLOWLIST).toContain(HELP_REPOSITORY_URL);
    expect(HELP_PRIVACY_CONTACT_FALLBACK).toContain(`(${HELP_REPOSITORY_URL})`);
  });

  it("the Needs-block sentence is plain text (a <dd> is not markdown) and names the ticket route", () => {
    const text = switchedOnText("Website address");
    expect(text).not.toMatch(/[\[\]]|\(\/help/);
    expect(text).toContain("file a ticket (Administration, then Tickets) or ask the person who invited you");
  });
});
