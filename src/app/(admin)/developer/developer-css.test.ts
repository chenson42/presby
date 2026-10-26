/**
 * developer.css keeps the shell-fit and phone rules the portal depends on
 * (E25, E26 partly): no font-size under the 12px `micro` floor, no 100vh inside
 * the shell's <main>, and 44px targets on the links and the filter.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "developer.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe("developer.css", () => {
  it("has no font-size under 0.75rem (12px, the micro floor)", () => {
    const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)(rem|px|em)/g)];
    expect(sizes.length).toBeGreaterThan(10);
    for (const [decl, value, unit] of sizes) {
      const n = Number(value);
      if (unit === "rem") expect(n, decl).toBeGreaterThanOrEqual(0.75);
      if (unit === "px") expect(n, decl).toBeGreaterThanOrEqual(12);
    }
  });

  it("does not force 100vh inside the shell's <main>", () => {
    expect(css).not.toMatch(/min-height:\s*100vh/);
  });

  it("paints no panel of its own inside the shell's <main>", () => {
    expect(ruleBody(".reg")).toMatch(/background:\s*transparent/);
  });

  it("gives links and the filter a 44px target", () => {
    for (const sel of [
      ".reg__crumbs a",
      ".reg__diagramLink",
      ".reg__filterInput",
    ]) {
      expect(ruleBody(sel), sel).toMatch(/min-height:\s*44px/);
    }
  });

  it("wraps long names instead of widening the page", () => {
    for (const sel of [".reg__rowName", ".reg__rowSummary", ".reg__note"]) {
      expect(ruleBody(sel), sel).toMatch(/overflow-wrap:\s*anywhere/);
    }
    expect(ruleBody(".reg__moduleHead")).toMatch(/flex-wrap:\s*wrap/);
  });
});
