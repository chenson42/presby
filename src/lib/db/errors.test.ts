/**
 * Unit tests for src/lib/db/errors.ts
 *
 * Covers:
 *  - isUniqueViolation(): correct detection of Postgres 23505 errors
 *  - isExclusionViolation(): correct detection of Postgres 23P01 errors
 *    (officers admin, docs/work-log/2026-08-26-groups-and-officers.md
 *    Phase 4 commit 2 — `officer_terms_no_overlap`)
 *
 * Ported from huddleup.health/web/src/lib/db/errors.test.ts (13 cases).
 * True cases (5): direct code, wrapped cause, Error message, case-insensitive
 *   message, and numeric code coercion.
 * False cases (8): wrong code, unrelated message, null, undefined, bare string,
 *   bare number, wrong cause code, empty object.
 */

import { describe, it, expect } from "vitest";
import { isExclusionViolation, isUniqueViolation } from "./errors";

describe("isUniqueViolation()", () => {
  // ── True cases ────────────────────────────────────────────────────────────

  it("returns true when err.code is '23505' (Neon direct error shape)", () => {
    const err = { code: "23505", message: "duplicate key value..." };
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("returns true when err.cause.code is '23505' (Drizzle-wrapped error)", () => {
    const err = {
      message: "Query failed",
      cause: { code: "23505", message: "duplicate key value..." },
    };
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("returns true when err is an Error with the canonical Postgres message", () => {
    const err = new Error(
      'duplicate key value violates unique constraint "users_email_unique"',
    );
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("message match is case-insensitive", () => {
    const err = new Error(
      "DUPLICATE KEY VALUE VIOLATES UNIQUE CONSTRAINT",
    );
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("returns true when err.code is numeric 23505 (String() coerces to '23505')", () => {
    // String(23505) === "23505"
    const err = { code: 23505 };
    expect(isUniqueViolation(err)).toBe(true);
  });

  // ── False cases ───────────────────────────────────────────────────────────

  it("returns false for a non-unique-violation Postgres error (FK violation 23503)", () => {
    const err = { code: "23503", message: "foreign key violation" };
    expect(isUniqueViolation(err)).toBe(false);
  });

  it("returns false for a plain Error with an unrelated message", () => {
    const err = new Error("connection timeout");
    expect(isUniqueViolation(err)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("returns false for a bare string '23505'", () => {
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("returns false for a bare number 23505", () => {
    // Distinct from { code: 23505 } which returns true — bare number is not an
    // object so codeOf() returns undefined, it is not an Error, and it fails
    // all three checks.
    expect(isUniqueViolation(23505)).toBe(false);
  });

  it("returns false when err.cause is present but does NOT have code 23505", () => {
    const err = {
      message: "Query failed",
      cause: { code: "23503", message: "foreign key violation" },
    };
    expect(isUniqueViolation(err)).toBe(false);
  });

  it("returns false for an empty object", () => {
    expect(isUniqueViolation({})).toBe(false);
  });
});

describe("isExclusionViolation()", () => {
  // ── True cases ────────────────────────────────────────────────────────────

  it("returns true when err.code is '23P01' (Neon direct error shape)", () => {
    const err = {
      code: "23P01",
      message:
        'conflicting key value violates exclusion constraint "officer_terms_no_overlap"',
    };
    expect(isExclusionViolation(err)).toBe(true);
  });

  it("returns true when err.cause.code is '23P01' (Drizzle-wrapped error)", () => {
    const err = {
      message: "Query failed",
      cause: {
        code: "23P01",
        message: "conflicting key value violates exclusion constraint...",
      },
    };
    expect(isExclusionViolation(err)).toBe(true);
  });

  it("returns true when err is an Error with the canonical Postgres message", () => {
    const err = new Error(
      'conflicting key value violates exclusion constraint "officer_terms_no_overlap"',
    );
    expect(isExclusionViolation(err)).toBe(true);
  });

  it("message match is case-insensitive", () => {
    const err = new Error(
      "CONFLICTING KEY VALUE VIOLATES EXCLUSION CONSTRAINT",
    );
    expect(isExclusionViolation(err)).toBe(true);
  });

  // No numeric-code-coercion case here (unlike isUniqueViolation's
  // `{ code: 23505 }`): Postgres SQLSTATE 23P01 contains a letter, so it can
  // never arrive as a JS number literal — there is nothing to coerce.

  // ── False cases ───────────────────────────────────────────────────────────

  it("returns false for a unique-violation Postgres error (23505) — codes don't collide", () => {
    const err = { code: "23505", message: "duplicate key value..." };
    expect(isExclusionViolation(err)).toBe(false);
  });

  it("returns false for a foreign-key violation (23503) — codes don't collide", () => {
    const err = { code: "23503", message: "foreign key violation" };
    expect(isExclusionViolation(err)).toBe(false);
  });

  it("returns false for a check-constraint violation (23514) — codes don't collide", () => {
    const err = {
      code: "23514",
      message:
        'new row for relation "officer_terms" violates check constraint "officer_terms_org_unit_deacon_check"',
    };
    expect(isExclusionViolation(err)).toBe(false);
  });

  it("returns false for a plain Error with an unrelated message", () => {
    const err = new Error("connection timeout");
    expect(isExclusionViolation(err)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isExclusionViolation(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isExclusionViolation(undefined)).toBe(false);
  });

  it("returns false for a bare string '23P01'", () => {
    expect(isExclusionViolation("23P01")).toBe(false);
  });

  it("returns false when err.cause is present but does NOT have code 23P01", () => {
    const err = {
      message: "Query failed",
      cause: { code: "23503", message: "foreign key violation" },
    };
    expect(isExclusionViolation(err)).toBe(false);
  });

  it("returns false for an empty object", () => {
    expect(isExclusionViolation({})).toBe(false);
  });
});
