/**
 * U1: every form's rules at their boundaries (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 3 "Test plan"). Pure; no database; `today` is INJECTED, so
 * there are no fake timers anywhere in this file.
 */
import { describe, expect, it } from "vitest";
import { VALIDATION } from "./copy";
import {
  charLength,
  cleanLine,
  cleanText,
  parseChangeRole,
  parseCommittee,
  parseDate,
  parseDissolve,
  parseEndSeat,
  parseSeat,
  committeeSchema,
  seatSchema,
  changeRoleSchema,
  endSeatSchema,
  dissolveSchema,
} from "./validate";
import { addYears } from "./derive";

const TODAY = "2026-11-19";
const env = { today: TODAY };
const PERSON = "00000000-0000-4000-8000-000000000001";

const committee = (over: Record<string, string> = {}) => ({
  name: "Committee on Ministry",
  kind: "required",
  purpose: "",
  meetsWhen: "",
  ...over,
});

function fieldError(result: ReturnType<typeof parseCommittee> | ReturnType<typeof parseSeat>, field: string): string | undefined {
  return result.ok ? undefined : result.errors[field];
}

describe("helpers", () => {
  it("parseDate accepts real days and refuses 30 February, the wrong shape and padding tricks", () => {
    expect(parseDate("2026-02-28")).toBe("2026-02-28");
    expect(parseDate("2028-02-29")).toBe("2028-02-29");
    expect(parseDate("2027-02-29")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("26-11-19")).toBeNull();
    expect(parseDate("2026-1-9")).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("addYears keeps the day and clamps 29 February", () => {
    expect(addYears("2026-11-19", 5)).toBe("2031-11-19");
    expect(addYears("2024-02-29", 5)).toBe("2029-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
  });

  it("charLength counts code points as Postgres does (an emoji is one)", () => {
    expect(charLength("a".repeat(200))).toBe(200);
    expect(charLength("\u{1F600}".repeat(200))).toBe(200);
    expect("\u{1F600}".repeat(200).length).toBe(400);
  });

  it("cleanLine turns control characters into one space and trims; cleanText keeps line breaks", () => {
    expect(cleanLine("  a \t\t b\u0000c  ")).toBe("a b c");
    expect(cleanLine(`x${String.fromCharCode(0x2028)}y`)).toBe(`x${String.fromCharCode(0x2028)}y`);
    expect(cleanText("a\r\nb\rc")).toBe("a\nb\nc");
    expect(cleanText("  a\u0000b  ")).toBe("ab");
  });
});

describe("parseCommittee (C4)", () => {
  it("accepts a name of 1 and of 200 characters, refuses 0 (including whitespace only) and 201", () => {
    expect(parseCommittee(committee({ name: "A" })).ok).toBe(true);
    expect(parseCommittee(committee({ name: "a".repeat(200) })).ok).toBe(true);
    expect(fieldError(parseCommittee(committee({ name: "" })), "name")).toBe(VALIDATION.nameRequired);
    expect(fieldError(parseCommittee(committee({ name: "   \t " })), "name")).toBe(VALIDATION.nameRequired);
    expect(fieldError(parseCommittee(committee({ name: "a".repeat(201) })), "name")).toBe(VALIDATION.nameTooLong);
  });

  it("measures a name in code points after cleaning: 200 emoji pass, 201 fail", () => {
    expect(parseCommittee(committee({ name: "\u{1F600}".repeat(200) })).ok).toBe(true);
    expect(parseCommittee(committee({ name: "\u{1F600}".repeat(201) })).ok).toBe(false);
  });

  it("keeps unicode in a name and collapses control characters and runs of spaces", () => {
    const parsed = parseCommittee(committee({ name: "  Comité   de\tministerio ☃ " }));
    expect(parsed).toMatchObject({ ok: true, value: { name: "Comité de ministerio ☃" } });
  });

  it("accepts the three kinds and refuses empty, an unknown value and a near miss", () => {
    for (const kind of ["required", "standing", "ad_hoc"]) expect(parseCommittee(committee({ kind })).ok, kind).toBe(true);
    for (const kind of ["", "optional", "Required", "ad-hoc", "required "]) {
      expect(fieldError(parseCommittee(committee({ kind })), "kind"), kind).toBe(VALIDATION.kindRequired);
    }
  });

  it("limits purpose to 2000 and meets-when to 200, and turns empty into null", () => {
    expect(parseCommittee(committee({ purpose: "p".repeat(2000) })).ok).toBe(true);
    expect(fieldError(parseCommittee(committee({ purpose: "p".repeat(2001) })), "purpose")).toBe(VALIDATION.purposeTooLong);
    expect(parseCommittee(committee({ meetsWhen: "m".repeat(200) })).ok).toBe(true);
    expect(fieldError(parseCommittee(committee({ meetsWhen: "m".repeat(201) })), "meetsWhen")).toBe(VALIDATION.meetsWhenTooLong);
    expect(parseCommittee(committee())).toMatchObject({ ok: true, value: { purpose: null, meetsWhen: null } });
  });

  it("a purpose keeps its line breaks; meets-when is one line", () => {
    expect(parseCommittee(committee({ purpose: "one\ntwo", meetsWhen: "first\nMonday" }))).toMatchObject({
      ok: true,
      value: { purpose: "one\ntwo", meetsWhen: "first Monday" },
    });
  });

  it("reports the first error in rule order and reads a non-object as empty", () => {
    const bad = parseCommittee(committee({ name: "", kind: "" }));
    expect(bad).toMatchObject({ ok: false, field: "name", message: VALIDATION.nameRequired });
    expect(parseCommittee(null).ok).toBe(false);
    expect(parseCommittee({ name: 5, kind: {} }).ok).toBe(false);
  });
});

describe("parseSeat (C5)", () => {
  const seat = (over: Record<string, string> = {}) => ({
    personId: PERSON,
    role: "member",
    startsOn: TODAY,
    endsOn: "",
    ...over,
  });

  it("accepts the six committee roles and refuses leader, an unknown role and empty", () => {
    for (const role of ["chair", "vice_chair", "clerk", "secretary", "ex_officio", "member"]) {
      expect(parseSeat(seat({ role }), env).ok, role).toBe(true);
    }
    for (const role of ["leader", "boss", "", "Chair"]) {
      expect(fieldError(parseSeat(seat({ role }), env), "role"), role).toBe(VALIDATION.roleRequired);
    }
  });

  it("requires a person that is a UUID", () => {
    for (const personId of ["", "abc", "00000000-0000-4000-8000-00000000000", "not-a-uuid-at-all-not-a-uuid-at-all!"]) {
      expect(fieldError(parseSeat(seat({ personId }), env), "personId"), personId).toBe(VALIDATION.personRequired);
    }
  });

  it("the start date: required, a real day, on or after the 1900 floor, at most 5 years ahead", () => {
    expect(fieldError(parseSeat(seat({ startsOn: "" }), env), "startsOn")).toBe(VALIDATION.startRequired);
    expect(fieldError(parseSeat(seat({ startsOn: "2026-02-30" }), env), "startsOn")).toBe(VALIDATION.dateInvalid);
    expect(fieldError(parseSeat(seat({ startsOn: "1899-12-31" }), env), "startsOn")).toBe(VALIDATION.dateInvalid);
    expect(parseSeat(seat({ startsOn: "1900-01-01" }), env).ok).toBe(true);
    expect(parseSeat(seat({ startsOn: addYears(TODAY, 5) }), env).ok).toBe(true);
    expect(fieldError(parseSeat(seat({ startsOn: "2031-11-20" }), env), "startsOn")).toBe(VALIDATION.startTooFar);
  });

  it("the end date: optional, after the start, at most 10 years ahead; equal to the start is refused", () => {
    expect(parseSeat(seat({ endsOn: "" }), env)).toMatchObject({ ok: true, value: { endsOn: null } });
    expect(parseSeat(seat({ endsOn: "2027-01-01" }), env)).toMatchObject({ ok: true, value: { endsOn: "2027-01-01" } });
    expect(fieldError(parseSeat(seat({ endsOn: TODAY }), env), "endsOn")).toBe(VALIDATION.endNotAfterStart);
    expect(fieldError(parseSeat(seat({ endsOn: "2026-11-18" }), env), "endsOn")).toBe(VALIDATION.endNotAfterStart);
    expect(parseSeat(seat({ endsOn: addYears(TODAY, 10) }), env).ok).toBe(true);
    expect(fieldError(parseSeat(seat({ endsOn: "2036-11-20" }), env), "endsOn")).toBe(VALIDATION.endTooFar);
    expect(fieldError(parseSeat(seat({ endsOn: "nope" }), env), "endsOn")).toBe(VALIDATION.dateInvalid);
  });

  it("a back-dated start is accepted (a back-dated seat is how history is entered)", () => {
    expect(parseSeat(seat({ startsOn: "2019-05-01", endsOn: "2021-05-01" }), env).ok).toBe(true);
  });

  it("today is injected: the same input flips with the injected day, with no clock involved", () => {
    const input = seat({ startsOn: "2031-11-19" });
    expect(parseSeat(input, { today: "2026-11-19" }).ok).toBe(true);
    expect(parseSeat(input, { today: "2026-11-18" }).ok).toBe(false);
  });
});

describe("parseChangeRole (C6)", () => {
  const change = (over: Record<string, string> = {}) => ({ newRole: "clerk", effectiveOn: TODAY, ...over });
  const seat = { role: "member", startsOn: "2025-01-01", endsOn: null as string | null };

  it("accepts a different committee role and a real date", () => {
    expect(parseChangeRole(change(), env)).toMatchObject({ ok: true, value: { newRole: "clerk", effectiveOn: TODAY } });
  });

  it("refuses an unknown or empty role, and leader (never offered)", () => {
    for (const newRole of ["", "boss", "leader"]) {
      expect(parseChangeRole(change({ newRole }), env), newRole).toMatchObject({ ok: false, field: "newRole" });
    }
  });

  it("with the seat in hand, refuses the same role", () => {
    expect(parseChangeRole(change({ newRole: "member" }), env, seat)).toMatchObject({ ok: false, field: "newRole", message: VALIDATION.roleDifferent });
    expect(parseChangeRole(change({ newRole: "member" }), env).ok).toBe(true);
  });

  it("the effective date: a real day, at most 5 years ahead", () => {
    expect(parseChangeRole(change({ effectiveOn: "" }), env)).toMatchObject({ ok: false, field: "effectiveOn", message: VALIDATION.dateInvalid });
    expect(parseChangeRole(change({ effectiveOn: addYears(TODAY, 5) }), env).ok).toBe(true);
    expect(parseChangeRole(change({ effectiveOn: "2031-11-20" }), env)).toMatchObject({ field: "effectiveOn", message: VALIDATION.effectiveTooFar });
  });

  it("with the seat in hand: not before it began (equal is allowed), and before a planned end (equal is refused)", () => {
    expect(parseChangeRole(change({ effectiveOn: "2025-01-01" }), env, seat).ok).toBe(true);
    expect(parseChangeRole(change({ effectiveOn: "2024-12-31" }), env, seat)).toMatchObject({
      ok: false,
      field: "effectiveOn",
      message: VALIDATION.effectiveBeforeStart("2025-01-01"),
    });
    const planned = { ...seat, endsOn: "2027-01-01" };
    expect(parseChangeRole(change({ effectiveOn: "2026-12-31" }), env, planned).ok).toBe(true);
    expect(parseChangeRole(change({ effectiveOn: "2027-01-01" }), env, planned)).toMatchObject({
      ok: false,
      message: VALIDATION.effectiveNotBeforeEnd("2027-01-01"),
    });
  });
});

describe("parseEndSeat (C7)", () => {
  it("an empty date is null (the cancel-planned-term path), a real date is kept", () => {
    expect(parseEndSeat({ endsOn: "" }, env)).toMatchObject({ ok: true, value: { endsOn: null } });
    expect(parseEndSeat({ endsOn: "2026-12-31" }, env)).toMatchObject({ ok: true, value: { endsOn: "2026-12-31" } });
  });

  it("refuses a bad date and one more than 10 years ahead", () => {
    expect(parseEndSeat({ endsOn: "2026-02-30" }, env)).toMatchObject({ ok: false, message: VALIDATION.dateInvalid });
    expect(parseEndSeat({ endsOn: addYears(TODAY, 10) }, env).ok).toBe(true);
    expect(parseEndSeat({ endsOn: "2036-11-20" }, env)).toMatchObject({ ok: false, message: VALIDATION.endTooFar });
  });

  it("with the seat in hand, an end before the start is refused and equal is allowed", () => {
    expect(parseEndSeat({ endsOn: "2024-12-31" }, env, { startsOn: "2025-01-01" })).toMatchObject({ ok: false, message: VALIDATION.endBeforeStart });
    expect(parseEndSeat({ endsOn: "2025-01-01" }, env, { startsOn: "2025-01-01" }).ok).toBe(true);
  });
});

describe("parseDissolve (C8)", () => {
  it("accepts today and a past day, refuses tomorrow, a bad date and an empty one", () => {
    expect(parseDissolve({ dissolvedOn: TODAY }, env).ok).toBe(true);
    expect(parseDissolve({ dissolvedOn: "2020-01-01" }, env).ok).toBe(true);
    expect(parseDissolve({ dissolvedOn: "2026-11-20" }, env)).toMatchObject({ ok: false, message: VALIDATION.dissolveFuture });
    expect(parseDissolve({ dissolvedOn: "2026-02-30" }, env)).toMatchObject({ ok: false, message: VALIDATION.dateInvalid });
    expect(parseDissolve({ dissolvedOn: "" }, env)).toMatchObject({ ok: false, field: "dissolvedOn" });
    expect(parseDissolve({ dissolvedOn: "1899-12-31" }, env).ok).toBe(false);
  });
});

describe("the zod schemas are thin wrappers over the same rules", () => {
  it("a schema reports the same field and message the parser does", () => {
    const bad = committeeSchema().safeParse(committee({ name: "" }));
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]).toMatchObject({ path: ["name"], message: VALIDATION.nameRequired });

    expect(seatSchema(env).safeParse({ personId: "x", role: "member", startsOn: TODAY, endsOn: "" }).success).toBe(false);
    expect(seatSchema(env).safeParse({ personId: PERSON, role: "member", startsOn: TODAY, endsOn: "" }).success).toBe(true);
    expect(changeRoleSchema(env).safeParse({ newRole: "clerk", effectiveOn: TODAY }).success).toBe(true);
    expect(endSeatSchema(env).safeParse({ endsOn: "" }).success).toBe(true);
    expect(dissolveSchema(env).safeParse({ dissolvedOn: "2026-11-20" }).success).toBe(false);
  });
});
