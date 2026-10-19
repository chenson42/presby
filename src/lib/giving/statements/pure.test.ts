import { describe, expect, it, vi } from "vitest";
import {
  decodeListCursor,
  encodeListCursor,
  isValidStatementYear,
  mapIssueError,
  parseYearParam,
  statementIssuingEnabled,
} from "./pure";

vi.mock("server-only", () => ({}));

describe("statementIssuingEnabled (Operator Q6 gate)", () => {
  it("is open in development, test and CI", () => {
    expect(statementIssuingEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(statementIssuingEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(statementIssuingEnabled({})).toBe(true);
  });
  it("is closed in production until GIVING_STATEMENTS_ENABLED is exactly 1", () => {
    expect(statementIssuingEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(statementIssuingEnabled({ NODE_ENV: "production", GIVING_STATEMENTS_ENABLED: "" })).toBe(false);
    expect(statementIssuingEnabled({ NODE_ENV: "production", GIVING_STATEMENTS_ENABLED: "true" })).toBe(false);
    expect(statementIssuingEnabled({ NODE_ENV: "production", GIVING_STATEMENTS_ENABLED: "0" })).toBe(false);
    expect(statementIssuingEnabled({ NODE_ENV: "production", GIVING_STATEMENTS_ENABLED: "1" })).toBe(true);
  });
});

describe("isValidStatementYear / parseYearParam", () => {
  it("accepts 2000 up to the current year and nothing else", () => {
    expect(isValidStatementYear(2000, 2028)).toBe(true);
    expect(isValidStatementYear(2028, 2028)).toBe(true);
    expect(isValidStatementYear(2029, 2028)).toBe(false);
    expect(isValidStatementYear(1999, 2028)).toBe(false);
    expect(isValidStatementYear(2027.5, 2028)).toBe(false);
    expect(isValidStatementYear("2027", 2028)).toBe(false);
    expect(isValidStatementYear(Number.NaN, 2028)).toBe(false);
  });
  it("reads only four-digit year parameters", () => {
    expect(parseYearParam("2027")).toBe(2027);
    expect(parseYearParam(["2027", "2026"])).toBe(2027);
    expect(parseYearParam("27")).toBeNull();
    expect(parseYearParam("2027; drop")).toBeNull();
    expect(parseYearParam(undefined)).toBeNull();
  });
});

describe("list cursor", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  it("round-trips a lowercased name and id", () => {
    expect(decodeListCursor(encodeListCursor({ donorName: "Linden MARSH | x", id }))).toEqual({ name: "linden marsh | x", id });
  });
  it("drops a tampered cursor to page one", () => {
    expect(decodeListCursor("not base64 json")).toBeNull();
    expect(decodeListCursor(Buffer.from(JSON.stringify(["a", "not-a-uuid"])).toString("base64url"))).toBeNull();
    expect(decodeListCursor(Buffer.from(JSON.stringify({ a: 1 })).toString("base64url"))).toBeNull();
    expect(decodeListCursor(null)).toBeNull();
    expect(decodeListCursor("")).toBeNull();
  });
});

describe("mapIssueError (the Batch 5a error table)", () => {
  const wrap = (message: string) => Object.assign(new Error("Failed query: insert ..."), { cause: new Error(message) });
  it("maps each refusal", () => {
    expect(mapIssueError(wrap('duplicate key value violates unique constraint "giving_statements_version_key"'))).toBe("already_issued");
    expect(mapIssueError(wrap('duplicate key value violates unique constraint "giving_statements_supersedes_once_idx"'))).toBe("already_reissued");
    expect(mapIssueError(wrap("giving_statement: supersedes_invalid"))).toBe("already_reissued");
    expect(mapIssueError(wrap("giving_statement: already_superseded"))).toBe("already_reissued");
    expect(mapIssueError(wrap("giving_statement: not permitted"))).toBe("forbidden");
    expect(mapIssueError(wrap("giving_statement: donor_unavailable"))).toBe("donor_unavailable");
    expect(mapIssueError(wrap("giving_statement: donor_unidentified"))).toBe("donor_unavailable");
    expect(mapIssueError(wrap('new row violates check constraint "giving_statements_totals_shape"'))).toBe("nothing_to_count");
    expect(mapIssueError(wrap("giving_statement 1234: inconsistent: totals_mismatch (header 3 lines)"))).toBe("consistency");
    expect(mapIssueError(wrap("giving_statement: blob_invalid"))).toBe("consistency");
    expect(mapIssueError(new Error("connection reset"))).toBe("unknown");
  });
});
