import { describe, expect, it } from "vitest";
import { FIELD_OUTCOMES, OUTCOMES, SUBMIT_MISSING, SUBMIT_ROUTES, type OutcomeName } from "./outcomes";
import { MIGRATION_0073, functionBody } from "./migration-text";

/** Every outcome literal a definer body can assign, including inside `case … end`. */
function outcomesIn(body: string): Set<string> {
  const found = new Set<string>();
  for (const assignment of body.matchAll(/\boutcome := (case[\s\S]*?end|'[a-z_]+')\s*;/g)) {
    for (const literal of assignment[1]!.matchAll(/'([a-z_]+)'/g)) found.add(literal[1]!);
  }
  return found;
}

const DEFINER: Record<OutcomeName, string> = {
  saveDraft: "presby_reimbursement_save_draft",
  updateRequest: "presby_reimbursement_update_request",
  submit: "presby_reimbursement_submit",
  withdraw: "presby_reimbursement_withdraw",
  approve: "presby_reimbursement_approve",
  return: "presby_reimbursement_return",
  void: "presby_reimbursement_void",
  waiveReceipt: "presby_reimbursement_waive_receipt",
  recordPayment: "presby_reimbursement_record_payment",
  reversePayment: "presby_reimbursement_reverse_payment",
  addNote: "presby_reimbursement_add_note",
  receiptPreflight: "presby_reimbursement_receipt_preflight",
  attachReceipt: "presby_reimbursement_attach_receipt",
  detachReceipt: "presby_reimbursement_detach_receipt",
  setChargeable: "presby_reimbursement_set_chargeable",
  saveCategory: "presby_reimbursement_save_category",
  endCategory: "presby_reimbursement_end_category",
};

describe("outcomes.ts is pinned to drizzle/0073 (both directions)", () => {
  const fieldOutcomes = outcomesIn(functionBody(MIGRATION_0073, "presby_reimbursement__check_fields"));

  it("FIELD_OUTCOMES is the shared field validator's outcome set (minus ok)", () => {
    fieldOutcomes.delete("ok");
    expect([...FIELD_OUTCOMES].sort()).toEqual([...fieldOutcomes].sort());
  });

  for (const [name, definer] of Object.entries(DEFINER) as Array<[OutcomeName, string]>) {
    it(`${name}: the list equals the outcomes ${definer} can return`, () => {
      const body = functionBody(MIGRATION_0073, definer);
      const found = outcomesIn(body);
      // the two save doors delegate their field outcomes to check_fields
      if (name === "saveDraft" || name === "updateRequest") for (const o of fieldOutcomes) found.add(o);
      found.add("ok");
      expect([...OUTCOMES[name]].sort()).toEqual([...found].sort());
    });
  }

  it("every list contains ok exactly once and nothing twice", () => {
    for (const [name, list] of Object.entries(OUTCOMES)) {
      expect(list.filter((o) => o === "ok"), name).toHaveLength(1);
      expect(new Set(list).size, name).toBe(list.length);
    }
  });

  it("SUBMIT_MISSING and SUBMIT_ROUTES are the literals the submit definer writes", () => {
    const body = functionBody(MIGRATION_0073, "presby_reimbursement_submit");
    const missing = [...body.matchAll(/array_append\(v_missing, '([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(missing).toEqual([...SUBMIT_MISSING]);
    const route = functionBody(MIGRATION_0073, "presby_reimbursement__route");
    const routes = new Set([...route.matchAll(/'(seat|treasurer|nobody)'/g)].map((m) => m[1]));
    expect([...routes].sort()).toEqual([...SUBMIT_ROUTES].sort());
  });
});
