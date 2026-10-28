import { describe, expect, it } from "vitest";
import { applyHelpTokens, unknownTemplateTokens } from "./tokens";
import { HELP_CONTACT_LINE } from "./contact";

describe("HELP_CONTACT_LINE", () => {
  it("is the operator-ruled interim sentence", () => {
    expect(HELP_CONTACT_LINE).toBe("Ask the person who invited you.");
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
  it("resolves every token when Increment 2 swaps the constant (the one-constant change)", () => {
    const out = applyHelpTokens("x {{contact}} y", "Use the form.");
    expect(out).toBe("x Use the form. y");
    expect(out).not.toContain("{{");
  });
  it("does not re-expand a replacement that itself contains braces", () => {
    expect(applyHelpTokens("{{contact}}", "{{contact}}")).toBe("{{contact}}");
  });
});

describe("unknownTemplateTokens", () => {
  it("accepts {{contact}} only", () => {
    expect(unknownTemplateTokens("see {{contact}}")).toEqual([]);
  });
  it("flags any other {{", () => {
    expect(unknownTemplateTokens("a {{name}} b")).toEqual([{ line: 1, snippet: "{{name}}" }]);
    expect(unknownTemplateTokens("ok\n{{ contact }}")).toEqual([{ line: 2, snippet: "{{ contact }}" }]);
    expect(unknownTemplateTokens("broken {{ never closed")).toEqual([{ line: 1, snippet: "{{ never closed" }]);
  });
});
