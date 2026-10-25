/**
 * Unit tests for the briefings staleness counter. The decision half counts
 * recorded DECISION numbers above the marker that docs/briefings.md does not
 * name (G11): a high-water mark (`max - marker`) overcounts numbers that were
 * never assigned and goes blind to a pre-assigned number that lands late.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  recordedDecisions,
  namedDecisions,
  unnamedAboveFloor,
  renderBehindLine,
} from "./briefings-check.mjs";

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** A decisions.md body with the given numbers, mixing both heading styles. */
function decisionsFile(nums) {
  return nums
    .map((n) => (n <= 121 ? `## DECISION-${String(n).padStart(3, "0")}: t` : `**DECISION-${n} — t**`))
    .join("\n\nbody\n\n");
}

describe("recordedDecisions", () => {
  it("counts both heading styles, distinct and sorted", () => {
    const text = "## DECISION-007: a\n\n**DECISION-122 — b**\n\n**DECISION-122 again**\n\n## DECISION-003: c";
    expect(recordedDecisions(text)).toEqual([3, 7, 122]);
  });

  it("ignores mentions that are not headings", () => {
    expect(recordedDecisions("see DECISION-050 for why\n")).toEqual([]);
  });

  it("returns an empty list for an empty log", () => {
    expect(recordedDecisions("")).toEqual([]);
  });
});

describe("namedDecisions", () => {
  it("reads zero-padded and plain numbers", () => {
    expect([...namedDecisions("DECISION-003, DECISION-45 and DECISION-0229")].sort((a, b) => a - b)).toEqual([3, 45, 229]);
  });

  it("expands a hyphen range, an en-dash range and a 'to' range inclusively", () => {
    const named = namedDecisions("DECISION-215-219; DECISION-300–303; DECISION-400 to DECISION-402");
    for (const n of [215, 216, 217, 218, 219, 300, 301, 302, 303, 400, 401, 402]) {
      expect(named.has(n)).toBe(true);
    }
  });

  it("accepts a second DECISION- inside a range", () => {
    const named = namedDecisions("DECISION-215–DECISION-219");
    expect(range(215, 219).every((n) => named.has(n))).toBe(true);
  });

  it("a reversed range names no interior number", () => {
    const named = namedDecisions("DECISION-219-215");
    expect(named.has(216)).toBe(false);
    expect(named.has(217)).toBe(false);
    expect(named.has(218)).toBe(false);
  });

  it("an over-wide range (more than 60 apart) names no interior number", () => {
    const named = namedDecisions("DECISION-100-200");
    expect(named.has(150)).toBe(false);
    expect(named.has(101)).toBe(false);
  });

  it("a date after a decision is not read as a range member", () => {
    const named = namedDecisions("DECISION-229 - 2026-10-24");
    expect(named.has(230)).toBe(false);
    expect(named.has(229)).toBe(true);
  });

  it("the covers marker names nothing", () => {
    expect(namedDecisions("<!-- covers: decision=224 commit=abc1234 -->").size).toBe(0);
  });
});

describe("unnamedAboveFloor", () => {
  // The 2026-10-24 backlog: 168-206 (39), 215-224 (10), 229 (1); 207-214 never assigned.
  const backlog = recordedDecisions(
    decisionsFile([...range(168, 206), ...range(215, 224), 229]),
  );

  it("counts distinct recorded numbers, not max minus marker: 50, not 62", () => {
    expect(backlog.length).toBe(50);
    expect(unnamedAboveFloor(backlog, new Set(), 167).length).toBe(50);
    expect(229 - 167).toBe(62);
  });

  it("is silent once the entries name everything above the floor (marker 224, 229 named)", () => {
    expect(unnamedAboveFloor(backlog, new Set([229]), 224)).toEqual([]);
  });

  it("flags a late-landing pre-assigned number even though a higher one is already recorded", () => {
    const withLate = [...backlog, 226].sort((a, b) => a - b);
    expect(unnamedAboveFloor(withLate, new Set([229]), 224)).toEqual([226]);
  });

  it("naming the late number silences it", () => {
    const withLate = [...backlog, 226].sort((a, b) => a - b);
    expect(unnamedAboveFloor(withLate, new Set([226, 229]), 224)).toEqual([]);
  });

  it("never reports a number at or below the marker", () => {
    expect(unnamedAboveFloor([10, 224, 225], new Set(), 224)).toEqual([225]);
  });

  it("reports nothing when no decisions are recorded", () => {
    expect(unnamedAboveFloor([], new Set(), 0)).toEqual([]);
  });
});

describe("renderBehindLine", () => {
  const tail = " — write them up and name each DECISION in an entry, then move the covers: marker";

  it("names one decision", () => {
    expect(renderBehindLine([226], 0)).toBe(
      `briefings are BEHIND by 1 decision not yet named (DECISION-226)${tail}`,
    );
  });

  it("names two, with the commit clause joined by 'and'", () => {
    expect(renderBehindLine([226, 228], 3)).toBe(
      `briefings are BEHIND by 2 decisions not yet named (DECISION-226, DECISION-228) and 3 feat/fix commits${tail}`,
    );
  });

  it("names up to five", () => {
    const line = renderBehindLine([201, 202, 203, 204, 205], 0);
    expect(line).toContain("5 decisions not yet named (DECISION-201, DECISION-202, DECISION-203, DECISION-204, DECISION-205)");
  });

  it("collapses six or more to the newest", () => {
    const line = renderBehindLine([201, 202, 203, 204, 205, 229], 0);
    expect(line).toContain("6 decisions not yet named (newest DECISION-229)");
    expect(line).not.toContain("DECISION-201");
  });

  it("a commit clause alone, singular", () => {
    expect(renderBehindLine([], 1)).toBe(`briefings are BEHIND by 1 feat/fix commit${tail}`);
  });

  it("is null when there is nothing behind", () => {
    expect(renderBehindLine([], 0)).toBe(null);
    expect(renderBehindLine([], null)).toBe(null);
  });
});

// The explanatory preamble of docs/briefings.md once gave its example as a range
// of real numbers (DECISION-215–219). namedDecisions reads the whole file, so
// the example "named" five decisions no entry describes and the banner
// under-counted by five. The preamble must name none.
describe("real docs/briefings.md", () => {
  const FIRST_ENTRY = /^## \d{4}-\d{2}-\d{2}/m;
  const preambleOf = (text) => {
    const m = FIRST_ENTRY.exec(text);
    expect(m, "no dated entry heading found").not.toBeNull();
    expect(m.index, "the preamble is empty").toBeGreaterThan(0);
    return text.slice(0, m.index);
  };

  it("the explanatory preamble names no decision", () => {
    const text = readFileSync(new URL("../docs/briefings.md", import.meta.url), "utf8");
    const preamble = preambleOf(text);
    expect(preamble).toContain("covers:"); // the marker lives in the preamble: we read the right text
    expect([...namedDecisions(preamble)]).toEqual([]);
  });

  it("can fail: the old paragraph, with its real example range, names five decisions", () => {
    const old = [
      "# Operator briefings",
      "",
      "if decisions above the marker that no entry names (write `DECISION-NNN`, or a",
      "range like `DECISION-215–219`, in the entry) or feat/fix commits since the marker",
      "",
      "---",
      "",
      "## 2026-10-15",
      "",
    ].join("\n");
    expect([...namedDecisions(preambleOf(old))].sort((a, b) => a - b)).toEqual([215, 216, 217, 218, 219]);
  });

  it("the replacement wording names none", () => {
    const fixed = [
      "# Operator briefings",
      "(write `DECISION-NNN`, or a range like `DECISION-NNN to DECISION-MMM`, in the entry)",
      "## 2026-10-15",
    ].join("\n");
    expect(namedDecisions(preambleOf(fixed)).size).toBe(0);
  });
});
