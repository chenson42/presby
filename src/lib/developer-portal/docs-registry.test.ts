/**
 * The Documentation registry cannot rot (E19): every "lives today" path exists,
 * keys are unique, nothing mentions the surfaces Ruling 9 excluded, and the
 * reviewed date is a real calendar date.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCS_REVIEWED,
  DOC_KIND_LABEL,
  DOC_ROWS,
  livesTodayText,
} from "./docs-registry";

const ROOT = resolve(__dirname, "../../..");

describe("DOC_ROWS", () => {
  it("has the seven approved rows in order", () => {
    expect(DOC_ROWS.map((r) => r.key)).toEqual([
      "getting-started",
      "architecture",
      "decisions",
      "runbooks",
      "security",
      "changelog",
      "status",
    ]);
  });

  it("has unique keys and titles", () => {
    expect(new Set(DOC_ROWS.map((r) => r.key)).size).toBe(DOC_ROWS.length);
    expect(new Set(DOC_ROWS.map((r) => r.title)).size).toBe(DOC_ROWS.length);
  });

  it("names only files that exist", () => {
    for (const row of DOC_ROWS) {
      if ("files" in row.livesToday) {
        expect(row.livesToday.files.length, row.key).toBeGreaterThan(0);
        for (const f of row.livesToday.files) {
          expect(existsSync(resolve(ROOT, f)), `${row.key}: ${f}`).toBe(true);
        }
      }
    }
  });

  it("uses a known kind on every row", () => {
    for (const row of DOC_ROWS) expect(DOC_KIND_LABEL[row.kind]).toBeTruthy();
  });

  it("mentions no API, SDK, rate limit or webhook (Ruling 9)", () => {
    for (const row of DOC_ROWS) {
      const text = [row.title, row.willContain, livesTodayText(row)].join(" ");
      expect(text, row.key).not.toMatch(/sdk|rate limit|webhook/i);
      expect(text, row.key).not.toMatch(/\bAPI\b/);
    }
  });

  it("renders the lives-today sentence in the approved wording", () => {
    const byKey = Object.fromEntries(DOC_ROWS.map((r) => [r.key, r]));
    expect(livesTodayText(byKey["getting-started"])).toBe(
      "Planned. Not built yet. Today this material lives in README.md and docs/testing.md.",
    );
    expect(livesTodayText(byKey["status"])).toBe(
      "Planned. Not built yet. Today, parts of this appear on the platform administrators' dashboard (email queue and domains).",
    );
  });

  it("has a valid calendar date for DOCS_REVIEWED", () => {
    expect(DOCS_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date(`${DOCS_REVIEWED}T00:00:00Z`);
    expect(Number.isNaN(d.getTime())).toBe(false);
    expect(d.toISOString().slice(0, 10)).toBe(DOCS_REVIEWED);
  });
});
