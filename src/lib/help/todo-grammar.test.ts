/**
 * The TODO token grammar (F349), one test per row of the Phase 3 table.
 */
import { describe, expect, it } from "vitest";
import { readTodoTokens, readingFor } from "./todo-grammar";

const todo = (lines: string[]) => lines.join("\n");
const head = ["# TODO", "", "## In Flight"];

describe("readTodoTokens, the pinned grammar", () => {
  it("1. an open `- [ ]` line above ## Done is open", () => {
    const r = readTodoTokens(todo([...head, "- [ ] a thing [help:x]", "## Done", "- [x] old"]));
    expect(r.classifiable).toBe(true);
    expect(readingFor(r, "x")).toEqual({ token: "x", state: "open", lines: [4] });
  });

  it("2. a `- [x]` line below ## Done is done", () => {
    const r = readTodoTokens(todo([...head, "## Done", "- [x] shipped [help:x]"]));
    expect(readingFor(r, "x")).toMatchObject({ state: "done", lines: [5] });
  });

  it("3. a `- [x]` line in In Flight (above ## Done) is ambiguous and names the line", () => {
    const r = readTodoTokens(todo([...head, "- [x] half shipped [help:x]", "## Done"]));
    expect(readingFor(r, "x")).toMatchObject({ state: "ambiguous", lines: [4] });
  });

  it("4. a `- [ ]` line below ## Done is ambiguous", () => {
    const r = readTodoTokens(todo([...head, "## Done", "- [ ] odd [help:x]"]));
    expect(readingFor(r, "x")).toMatchObject({ state: "ambiguous", lines: [5] });
  });

  it("5. an open-checkbox line containing 'declined' (any case) is declined", () => {
    const r = readTodoTokens(
      todo([...head, "- [ ] a thing, Declined 2026-10-25 [help:x]", "## Done"]),
    );
    expect(readingFor(r, "x")).toMatchObject({ state: "declined", lines: [4] });
  });

  it("6. a token that is absent reads as missing", () => {
    const r = readTodoTokens(todo([...head, "- [ ] something else", "## Done"]));
    expect(readingFor(r, "x")).toEqual({ token: "x", state: "missing", lines: [] });
  });

  it("7. a token on two lines is a duplicate", () => {
    const r = readTodoTokens(
      todo([...head, "- [ ] one [help:x]", "- [ ] two [help:x]", "## Done"]),
    );
    expect(readingFor(r, "x")).toMatchObject({ state: "duplicate", lines: [4, 5] });
  });

  it("8. a token twice on one line is a duplicate", () => {
    const r = readTodoTokens(todo([...head, "- [ ] one [help:x] and [help:x]", "## Done"]));
    expect(readingFor(r, "x")).toMatchObject({ state: "duplicate", lines: [4] });
  });

  it("9. a missing ## Done heading makes the whole file unclassifiable", () => {
    const r = readTodoTokens(todo([...head, "- [ ] a [help:x]"]));
    expect(r.classifiable).toBe(false);
    expect(r.reason).toMatch(/## Done/);
  });

  it("9b. two ## Done headings are also unclassifiable", () => {
    const r = readTodoTokens(todo([...head, "## Done", "## Done"]));
    expect(r.classifiable).toBe(false);
  });

  it("10. a token on a prose paragraph line is ambiguous", () => {
    const r = readTodoTokens(todo([...head, "Some prose mentioning [help:x] here.", "## Done"]));
    expect(readingFor(r, "x")).toMatchObject({ state: "ambiguous", lines: [4] });
  });

  it("12. near-miss spellings are not tokens", () => {
    const r = readTodoTokens(
      todo([...head, "- [ ] a [help: x]", "- [ ] b [Help:x]", "- [ ] c [help:X]", "## Done"]),
    );
    expect(readingFor(r, "x").state).toBe("missing");
    expect(r.readings.size).toBe(0);
  });

  it("reads every distinct token in the file", () => {
    const r = readTodoTokens(
      todo([...head, "- [ ] a [help:one]", "- [ ] b [help:two-b]", "## Done", "- [x] c [help:three]"]),
    );
    expect([...r.readings.keys()].sort()).toEqual(["one", "three", "two-b"]);
  });

  it("matches the ## Done heading exactly (a longer heading is not it)", () => {
    const r = readTodoTokens(todo([...head, "## Done soon", "- [x] a [help:x]"]));
    expect(r.classifiable).toBe(false);
  });
});
