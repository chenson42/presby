import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { helpRedirects } from "./select";

const config = readFileSync(path.resolve(__dirname, "../../../next.config.ts"), "utf8");

describe("next.config.ts help redirects", () => {
  it("spreads helpRedirects() with the platform host pattern into redirects()", () => {
    expect(config).toMatch(/import \{ helpRedirects \} from "\.\/src\/lib\/help\/select"/);
    expect(config).toMatch(/\.\.\.helpRedirects\(PLATFORM_HOST\)/);
  });
  it("yields exactly the redirects of the placeholders a published page replaced", () => {
    // worship Increment 1: /help/worship-setting-up replaces the planned worship-planning placeholder.
    expect(helpRedirects("(?:example\\.test)").map((r) => r.source)).toEqual(["/help/planned/worship-planning"]);
  });
});
