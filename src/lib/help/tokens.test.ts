import { describe, expect, it } from "vitest";
import { applyHelpTokens, unknownTemplateTokens } from "./tokens";
import { HELP_CONTACT_ADMIN_LINE, HELP_CONTACT_LINE, HELP_PRIVACY_CONTACT_FALLBACK, privacyContactText } from "./contact";

describe("HELP_CONTACT_LINE", () => {
  it("is the inviter first, then the contact form (Increment 2)", () => {
    expect(HELP_CONTACT_LINE).toBe(
      "Ask the person who invited you, or [send the PresbyPortal team a message](/help/contact).",
    );
  });
});

describe("{{contactAdmin}}", () => {
  it("is the ticket route first, then the form for someone who cannot file one", () => {
    expect(HELP_CONTACT_ADMIN_LINE).toBe(
      "File a ticket: open Administration, then Tickets (see [Getting help](/help/getting-help) for the steps). If you cannot file one, [send the PresbyPortal team a message](/help/contact).",
    );
  });
  it("is replaced by its own text, not by {{contact}}'s", () => {
    expect(applyHelpTokens("A {{contact}} B {{contactAdmin}}", "one", null, "two")).toBe("A one B two");
    expect(applyHelpTokens("{{contactAdmin}}")).toBe(HELP_CONTACT_ADMIN_LINE);
  });
  it("is a known token, and a near miss still fails H5", () => {
    expect(unknownTemplateTokens("x {{contactAdmin}} y")).toEqual([]);
    expect(unknownTemplateTokens("{{contactadmin}}")).toEqual([{ line: 1, snippet: "{{contactadmin}}" }]);
  });
  it("does not re-expand a replacement that contains braces", () => {
    expect(applyHelpTokens("{{contactAdmin}}", "x", null, "{{contact}}")).toBe("{{contact}}");
  });
});

describe("applyHelpTokens", () => {
  it("replaces every {{contact}} with the contact line", () => {
    expect(applyHelpTokens("A {{contact}} B {{contact}}")).toBe(
      `A ${HELP_CONTACT_LINE} B ${HELP_CONTACT_LINE}`,
    );
  });
  it("leaves text without a token alone", () => {
    expect(applyHelpTokens("Plain text.")).toBe("Plain text.");
  });
  it("resolves every token when a caller passes its own line", () => {
    const out = applyHelpTokens("x {{contact}} y", "Use the form.");
    expect(out).toBe("x Use the form. y");
    expect(out).not.toContain("{{");
  });
  it("does not re-expand a replacement that itself contains braces", () => {
    expect(applyHelpTokens("{{contact}}", "{{contact}}")).toBe("{{contact}}");
  });
});

describe("privacyContactText", () => {
  it("is a mailto link when an address is configured", () => {
    expect(privacyContactText("privacy@example.invalid")).toBe(
      "Email us at [privacy@example.invalid](mailto:privacy@example.invalid).",
    );
  });
  it("escapes an underscore in the link text so it cannot read as emphasis", () => {
    expect(privacyContactText("a_b_c@example.invalid")).toBe(
      "Email us at [a\\_b\\_c@example.invalid](mailto:a_b_c@example.invalid).",
    );
  });
  it("is the truthful fallback when there is no address: no address, no mailto, one allowlisted link", () => {
    expect(privacyContactText(null)).toBe(HELP_PRIVACY_CONTACT_FALLBACK);
    expect(HELP_PRIVACY_CONTACT_FALLBACK).not.toMatch(/@|mailto:/);
    expect(HELP_PRIVACY_CONTACT_FALLBACK).toContain("(https://github.com/chenson42/presby)");
  });
});

describe("applyHelpTokens — {{privacyContact}}", () => {
  it("with the variable set, becomes the mailto sentence", () => {
    const out = applyHelpTokens("Write.\n\n{{privacyContact}}\n", undefined, "privacy@example.invalid");
    expect(out).toBe("Write.\n\nEmail us at [privacy@example.invalid](mailto:privacy@example.invalid).\n");
  });
  it("with the variable unset, becomes the fallback and contains no address", () => {
    const out = applyHelpTokens("{{privacyContact}}");
    expect(out).toBe(HELP_PRIVACY_CONTACT_FALLBACK);
    expect(out).not.toContain("@");
    expect(applyHelpTokens("{{privacyContact}}", undefined, null)).toBe(HELP_PRIVACY_CONTACT_FALLBACK);
  });
  it("leaves {{contact}} on its own line alone", () => {
    expect(applyHelpTokens("{{contact}} / {{privacyContact}}", "Ask.", "p@example.invalid")).toBe(
      "Ask. / Email us at [p@example.invalid](mailto:p@example.invalid).",
    );
  });
  it("does not re-expand braces in either replacement, and leaves `$&` alone", () => {
    expect(applyHelpTokens("{{contact}} {{privacyContact}}", "{{privacyContact}} $&")).toBe(
      `{{privacyContact}} $& ${HELP_PRIVACY_CONTACT_FALLBACK}`,
    );
  });
});

describe("unknownTemplateTokens", () => {
  it("accepts {{contact}}, {{contactAdmin}} and {{privacyContact}} only", () => {
    expect(unknownTemplateTokens("see {{contact}}")).toEqual([]);
    expect(unknownTemplateTokens("see {{privacyContact}} and {{contact}}")).toEqual([]);
  });
  it("flags a near miss of the new token", () => {
    expect(unknownTemplateTokens("{{privacycontact}}")).toEqual([{ line: 1, snippet: "{{privacycontact}}" }]);
  });
  it("flags any other {{", () => {
    expect(unknownTemplateTokens("a {{name}} b")).toEqual([{ line: 1, snippet: "{{name}}" }]);
    expect(unknownTemplateTokens("ok\n{{ contact }}")).toEqual([{ line: 2, snippet: "{{ contact }}" }]);
    expect(unknownTemplateTokens("broken {{ never closed")).toEqual([{ line: 1, snippet: "{{ never closed" }]);
  });
});
