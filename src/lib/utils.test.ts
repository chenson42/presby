import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("rounded-md", "px-4")).toBe("rounded-md px-4");
  });

  it("lets the later class win a Tailwind conflict", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
    expect(cn("bg-muted", "bg-primary")).toBe("bg-primary");
  });

  it("drops falsy values and flattens conditional shapes", () => {
    expect(cn("h-9", undefined, null, false, ["px-4", { "sr-only": false }])).toBe(
      "h-9 px-4",
    );
  });

  it("returns an empty string when given nothing", () => {
    expect(cn()).toBe("");
  });
});
