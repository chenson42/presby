import { describe, expect, it } from "vitest";
import { planEmailSave, primaryChanged, type EmailPlan } from "./email-plan";
import { row } from "./test-rows";
import type { ActiveEmailRow, EmailRowInput } from "./types";

/** What the form submits for an unchanged saved row. */
function same(r: ActiveEmailRow, over: Partial<EmailRowInput> = {}): EmailRowInput {
  return { id: r.id, value: r.value, subtype: r.subtype, isPrimary: r.isPrimary, doNotContact: r.doNotContact, ...over };
}
function fresh(value: string, over: Partial<EmailRowInput> = {}): EmailRowInput {
  return { value, subtype: null, isPrimary: false, doNotContact: false, ...over };
}
function plan(active: ActiveEmailRow[], submitted: EmailRowInput[]): EmailPlan {
  const result = planEmailSave(active, submitted);
  if (result.kind !== "plan") throw new Error(`expected a plan, got ${JSON.stringify(result.refusal)}`);
  return result.plan;
}
function refusal(active: ActiveEmailRow[], submitted: EmailRowInput[]) {
  const result = planEmailSave(active, submitted);
  if (result.kind !== "refused") throw new Error("expected a refusal");
  return result.refusal;
}

const M = () => row("m", { subtype: "personal", main: true });
const O = () => row("older", { subtype: "work" });
const N = () => row("newer", { subtype: "other" });

describe("planEmailSave — adding", () => {
  it("the first address becomes the main address, automatically", () => {
    const p = plan([], [fresh("a@b.co")]);
    expect(p.insert).toEqual([{ value: "a@b.co", subtype: null, isPrimary: true, doNotContact: false }]);
    expect(p.primary).toEqual({ fromId: null, toExistingId: null, toInsertIndex: 0, automatic: true });
    expect(primaryChanged(p)).toBe(false);
    expect(p.end).toEqual([]);
    expect(p.demote).toEqual([]);
    expect(p.promote).toEqual([]);
    expect(p.changed).toBe(true);
  });

  it("the first address of several is the main; later ones are not", () => {
    const p = plan([], [fresh("a@b.co"), fresh("c@d.co", { subtype: "work" })]);
    expect(p.insert.map((i) => i.isPrimary)).toEqual([true, false]);
  });

  it("an explicitly flagged new row is the main, not the first", () => {
    const p = plan([], [fresh("a@b.co"), fresh("c@d.co", { isPrimary: true })]);
    expect(p.insert.map((i) => i.isPrimary)).toEqual([false, true]);
    expect(p.primary).toMatchObject({ toInsertIndex: 1, automatic: false });
  });

  it("adding a non-main address leaves the main alone", () => {
    const m = M();
    const p = plan([m], [same(m), fresh("x@y.co", { subtype: "work" })]);
    expect(p.insert).toEqual([{ value: "x@y.co", subtype: "work", isPrimary: false, doNotContact: false }]);
    expect(p.demote).toEqual([]);
    expect(p.promote).toEqual([]);
    expect(p.end).toEqual([]);
    expect(p.primary).toEqual({ fromId: "m", toExistingId: "m", toInsertIndex: null, automatic: false });
    expect(primaryChanged(p)).toBe(false);
  });

  it("normalizes a new row (trim, lowercase)", () => {
    const p = plan([], [fresh("  Nora@Example.INVALID ")]);
    expect(p.insert[0]!.value).toBe("nora@example.invalid");
  });

  it("a blank new row is dropped, and a list of only blanks plans nothing", () => {
    const p = plan([], [fresh(""), fresh("   ")]);
    expect(p.insert).toEqual([]);
    expect(p.primary).toBeNull();
    expect(p.changed).toBe(false);
  });
});

describe("planEmailSave — changing the main address", () => {
  it("an explicit main change demotes the old main and promotes the new one", () => {
    const m = M();
    const o = O();
    const p = plan([m, o], [same(m, { isPrimary: false }), same(o, { isPrimary: true })]);
    expect(p.demote).toEqual(["m"]);
    expect(p.promote).toEqual(["older"]);
    expect(p.primary).toEqual({ fromId: "m", toExistingId: "older", toInsertIndex: null, automatic: false });
    expect(primaryChanged(p)).toBe(true);
  });

  it("a new row flagged main demotes a kept old main", () => {
    const m = M();
    const p = plan([m], [same(m, { isPrimary: false }), fresh("new@x.co", { isPrimary: true })]);
    expect(p.demote).toEqual(["m"]);
    expect(p.promote).toEqual([]);
    expect(p.insert[0]!.isPrimary).toBe(true);
    expect(primaryChanged(p)).toBe(true);
  });

  it("two submitted mains is multiple_primary, pointing at the second", () => {
    const m = M();
    const o = O();
    expect(refusal([m, o], [same(m), same(o, { isPrimary: true })])).toEqual({ reason: "multiple_primary", index: 1 });
  });

  it("zero mains submitted with the old main kept keeps it (no change of main)", () => {
    const m = M();
    const o = O();
    const p = plan([m, o], [same(m, { isPrimary: false }), same(o)]);
    expect(p.primary).toEqual({ fromId: "m", toExistingId: "m", toInsertIndex: null, automatic: true });
    expect(p.demote).toEqual([]);
    expect(p.promote).toEqual([]);
    expect(p.changed).toBe(false);
    expect(primaryChanged(p)).toBe(false);
  });
});

describe("planEmailSave — removing", () => {
  it("removing the main promotes the oldest remaining address, automatically (Q3)", () => {
    const m = M();
    const o = O();
    const n = N();
    const p = plan([m, o, n], [same(o, { isPrimary: false }), same(n)]);
    expect(p.end).toEqual([{ id: "m", subtype: "personal", wasPrimary: true }]);
    expect(p.promote).toEqual(["older"]);
    expect(p.primary).toEqual({ fromId: "m", toExistingId: "older", toInsertIndex: null, automatic: true });
    expect(primaryChanged(p)).toBe(true);
  });

  it("the promoted address is the oldest whatever its label (a Work address can become main)", () => {
    const m = M();
    const o = O(); // work, older
    const n = N();
    const p = plan([m, o, n], [same(o), same(n)]);
    expect(p.primary!.toExistingId).toBe("older");
    expect(p.primary!.automatic).toBe(true);
  });

  it("removing the main while flagging another keeps that choice (not automatic)", () => {
    const m = M();
    const o = O();
    const n = N();
    const p = plan([m, o, n], [same(o), same(n, { isPrimary: true })]);
    expect(p.promote).toEqual(["newer"]);
    expect(p.primary).toMatchObject({ toExistingId: "newer", automatic: false });
  });

  it("removing a non-main address changes nothing about the main", () => {
    const m = M();
    const o = O();
    const p = plan([m, o], [same(m)]);
    expect(p.end).toEqual([{ id: "older", subtype: "work", wasPrimary: false }]);
    expect(p.demote).toEqual([]);
    expect(p.promote).toEqual([]);
    expect(p.primary).toMatchObject({ fromId: "m", toExistingId: "m" });
    expect(primaryChanged(p)).toBe(false);
  });

  it("removing every address ends them all and leaves no main", () => {
    const m = M();
    const o = O();
    const p = plan([m, o], []);
    expect(p.end.map((e) => e.id).sort()).toEqual(["m", "older"]);
    expect(p.primary).toBeNull();
    expect(p.promote).toEqual([]);
    expect(p.insert).toEqual([]);
    expect(primaryChanged(p)).toBe(false);
  });
});

describe("planEmailSave — replacing (a typo fix) is end-and-replace, never an in-place value change", () => {
  it("replacing the main ends it and inserts a new main carrying the submitted label and flag", () => {
    const m = row("m", { subtype: "work", main: true, dnc: true });
    const p = plan([m], [same(m, { value: "Fixed@Example.invalid" })]);
    expect(p.end).toEqual([{ id: "m", subtype: "work", wasPrimary: true, replacedByInsert: 0 }]);
    expect(p.insert).toEqual([
      { value: "fixed@example.invalid", subtype: "work", isPrimary: true, doNotContact: true, replacesId: "m" },
    ]);
    expect(p.primary).toEqual({ fromId: "m", toExistingId: null, toInsertIndex: 0, automatic: false });
    // The row id changed, so it is a primary change for the audit trail.
    expect(primaryChanged(p)).toBe(true);
  });

  it("the replacement takes exactly what the form submitted: the label and flag can change at the same time", () => {
    const m = row("m", { subtype: "work", main: true, dnc: true });
    const p = plan([m], [same(m, { value: "x@y.co", subtype: "personal", doNotContact: false })]);
    expect(p.insert[0]).toMatchObject({ subtype: "personal", doNotContact: false });
  });

  it("verified_at never appears in a plan: there is nowhere for it to travel", () => {
    const m = M();
    const p = plan([m], [same(m, { value: "x@y.co" })]);
    expect(JSON.stringify(p)).not.toMatch(/verified/i);
  });

  it("replacing a non-main address leaves the main alone", () => {
    const m = M();
    const o = O();
    const p = plan([m, o], [same(m), same(o, { value: "fixed@x.co" })]);
    expect(p.end).toEqual([{ id: "older", subtype: "work", wasPrimary: false, replacedByInsert: 0 }]);
    expect(p.insert[0]).toMatchObject({ value: "fixed@x.co", isPrimary: false, replacesId: "older" });
    expect(primaryChanged(p)).toBe(false);
  });

  it("replacing the main without flagging it hands the main to the oldest remaining row (automatic)", () => {
    const m = M();
    const o = O();
    const p = plan([m, o], [same(m, { value: "fixed@x.co", isPrimary: false }), same(o)]);
    expect(p.promote).toEqual(["older"]);
    expect(p.insert[0]!.isPrimary).toBe(false);
    expect(p.primary).toMatchObject({ fromId: "m", toExistingId: "older", automatic: true });
  });

  it("replacing the only address without flagging it makes the replacement the main (automatic)", () => {
    const m = M();
    const p = plan([m], [same(m, { value: "fixed@x.co", isPrimary: false })]);
    expect(p.insert[0]!.isPrimary).toBe(true);
    expect(p.primary).toMatchObject({ fromId: "m", toInsertIndex: 0, automatic: true });
  });

  it("swapping two addresses in one save ends both rows and inserts both (no duplicate refusal)", () => {
    const a = row("a", { value: "one@x.co", main: true });
    const b = row("b", { value: "two@x.co" });
    const p = plan([a, b], [same(a, { value: "two@x.co" }), same(b, { value: "one@x.co" })]);
    expect(p.end.map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(p.insert.map((i) => i.value)).toEqual(["two@x.co", "one@x.co"]);
    expect(p.insert.map((i) => i.replacesId)).toEqual(["a", "b"]);
  });

  it("a new row may reuse the address of a row that is being ended in the same save", () => {
    const a = row("a", { value: "one@x.co", main: true });
    const p = plan([a], [fresh("one@x.co", { isPrimary: true })]); // a is not submitted, so it is ended
    expect(p.end.map((e) => e.id)).toEqual(["a"]);
    expect(p.insert[0]).toMatchObject({ value: "one@x.co", isPrimary: true });
    expect(p.insert[0]!.replacesId).toBeUndefined();
  });

  it("the same address after normalization is NOT a change", () => {
    const m = row("m", { value: "nora@example.invalid", main: true });
    const p = plan([m], [same(m, { value: "  NORA@Example.Invalid " })]);
    expect(p.changed).toBe(false);
    expect(p.end).toEqual([]);
    expect(p.insert).toEqual([]);
  });
});

describe("planEmailSave — in-place changes", () => {
  it("a label change relabels in place", () => {
    const o = O();
    const m = M();
    const p = plan([m, o], [same(m), same(o, { subtype: "personal" })]);
    expect(p.relabel).toEqual([{ id: "older", subtype: "personal", doNotContact: false, fields: ["subtype"] }]);
    expect(p.end).toEqual([]);
    expect(p.insert).toEqual([]);
  });

  it("clearing a label (null) is a relabel", () => {
    const o = O();
    const m = M();
    const p = plan([m, o], [same(m), same(o, { subtype: null })]);
    expect(p.relabel[0]).toMatchObject({ id: "older", subtype: null, fields: ["subtype"] });
  });

  it("a do-not-contact change relabels in place, and both fields can change together", () => {
    const m = M();
    const only = plan([m], [same(m, { doNotContact: true })]);
    expect(only.relabel).toEqual([{ id: "m", subtype: "personal", doNotContact: true, fields: ["doNotContact"] }]);
    const both = plan([m], [same(m, { doNotContact: true, subtype: "other" })]);
    expect(both.relabel[0]!.fields).toEqual(["subtype", "doNotContact"]);
  });

  it("submitting the list exactly as loaded plans nothing", () => {
    const m = M();
    const o = O();
    const p = plan([m, o], [same(m), same(o)]);
    expect(p.changed).toBe(false);
    expect(p.end).toEqual([]);
    expect(p.demote).toEqual([]);
    expect(p.relabel).toEqual([]);
    expect(p.insert).toEqual([]);
    expect(p.promote).toEqual([]);
  });
});

describe("planEmailSave — legacy data with active addresses and no main", () => {
  it("normalizes by the same rule: the oldest active row is promoted (automatic, no previous main)", () => {
    const a = row("a");
    const b = row("b");
    const p = plan([a, b], [same(a), same(b)]);
    expect(p.promote).toEqual(["a"]);
    expect(p.primary).toEqual({ fromId: null, toExistingId: "a", toInsertIndex: null, automatic: true });
    expect(primaryChanged(p)).toBe(false);
    expect(p.changed).toBe(true);
  });
});

describe("planEmailSave — refusals (nothing is planned)", () => {
  const m = M();

  it("a blank EXISTING row is invalid_shape (the Remove button is how you remove)", () => {
    expect(refusal([m], [same(m, { value: "   " })])).toEqual({ reason: "invalid_shape", index: 0 });
  });

  it.each([
    ["no at sign", "plain"],
    ["no dot in the domain", "a@b"],
    ["two at signs", "a@b@c.co"],
    ["whitespace inside", "a b@c.co"],
    ["a comma list", "a@x.co, b@y.co"],
  ])("invalid_shape: %s", (_name, value) => {
    expect(refusal([], [fresh(value)])).toEqual({ reason: "invalid_shape", index: 0 });
  });

  it("too_long past 254 characters", () => {
    const long = `${"a".repeat(250)}@b.co`;
    expect(refusal([], [fresh(long)])).toEqual({ reason: "too_long", index: 0 });
  });

  it("duplicate within one submission, after normalization, points at the later row", () => {
    expect(refusal([], [fresh("a@b.co"), fresh(" A@B.CO ")])).toEqual({ reason: "duplicate", index: 1 });
  });

  it("an existing row and a new row with the same address are a duplicate", () => {
    expect(refusal([m], [same(m), fresh(m.value.toUpperCase())])).toEqual({ reason: "duplicate", index: 1 });
  });

  it("the same existing id submitted twice is refused as a duplicate", () => {
    expect(refusal([m], [same(m), same(m, { value: "other@x.co" })])).toEqual({ reason: "duplicate", index: 1 });
  });

  it("an unknown id means the form is stale: emails_changed", () => {
    expect(refusal([m], [same(m), { ...fresh("a@b.co"), id: "not-in-the-list" }])).toEqual({
      reason: "emails_changed",
      index: 1,
    });
  });

  it("a subtype outside the vocabulary is bad_subtype (home is a phone label, not an email one)", () => {
    expect(refusal([], [fresh("a@b.co", { subtype: "home" as never })])).toEqual({ reason: "bad_subtype", index: 0 });
    expect(refusal([], [fresh("a@b.co", { subtype: "" as never })])).toEqual({ reason: "bad_subtype", index: 0 });
  });

  it("ten addresses are allowed, eleven are too_many, and blank rows do not count", () => {
    const ten = Array.from({ length: 10 }, (_v, i) => fresh(`a${i}@b.co`));
    expect(plan([], ten).insert).toHaveLength(10);
    const eleven = [...ten, fresh("a10@b.co")];
    expect(refusal([], eleven)).toEqual({ reason: "too_many" });
    expect(plan([], [...ten, fresh(""), fresh("  ")]).insert).toHaveLength(10);
  });
});
