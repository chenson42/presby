import { describe, expect, it } from "vitest";
import { extractHeadings, plainHeadingText } from "./headings";

describe("plainHeadingText", () => {
  it("strips emphasis, code ticks, links and images down to their text", () => {
    expect(plainHeadingText("**Bold** and `code`")).toBe("Bold and code");
    expect(plainHeadingText("[Sign in](/signin) first")).toBe("Sign in first");
    expect(plainHeadingText("![the form](shot:signin-form) Form")).toBe("the form Form");
  });
});

describe("extractHeadings", () => {
  it("returns level, plain text and the de-duplicated id in document order", () => {
    const md = "Intro\n\n## Signing in\n\n### Forgot password?\n\n## Signing in\n";
    expect(extractHeadings(md)).toEqual([
      { level: 2, text: "Signing in", id: "signing-in" },
      { level: 3, text: "Forgot password?", id: "forgot-password" },
      { level: 2, text: "Signing in", id: "signing-in-2" },
    ]);
  });
  it("ignores headings inside fenced code", () => {
    expect(extractHeadings("```\n## not a heading\n```\n## Real\n")).toEqual([
      { level: 2, text: "Real", id: "real" },
    ]);
  });
  it("keeps level 1 so the checker can reject it", () => {
    expect(extractHeadings("# Top\n")[0]).toMatchObject({ level: 1, id: "top" });
  });
});
