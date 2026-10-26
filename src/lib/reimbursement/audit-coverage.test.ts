/**
 * EC43 / P3-20: `check:audit` scans only `actions.ts` files that call `db.`
 * directly, so it cannot see the audit rows this module writes from
 * `src/lib/`. This source scan is the proof it would have been:
 *
 *   - every function in `src/lib/reimbursement/` that calls an AUDITED write
 *     definer also calls `auditReimbursement(` (which writes the row with
 *     `insertAuditRow` in the SAME transaction);
 *   - every write definer the module calls is CLASSIFIED below as audited or
 *     deliberately unaudited (the events table is its record: Phase 3 "Not
 *     audited"), so a new write door cannot slip in unclassified;
 *   - nothing here uses `recordAudit()` (it opens its own connection and swallows
 *     failures, so a transition could commit with no audit row).
 *
 * Grows with each batch: Batch 3 added approve/return (decisions.ts), Batch 4 added
 * payments, waive, void (payments.ts) and the CSV export (csv-export.ts), Batch 2b adds
 * receipts. Every definer on the audited list below is now called by exactly the
 * functions that audit it (the "no audited definer is unused" test keeps it so); a
 * definer called by a function that does not audit it fails.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

/** Write definers whose act is audited, with the AUDIT_ACTIONS key(s) the audit call may use. */
const AUDITED: Record<string, string[]> = {
  presby_reimbursement_approve: ["REIMBURSEMENT_APPROVED", "REIMBURSEMENT_OVERRIDE_APPROVED"],
  presby_reimbursement_return: ["REIMBURSEMENT_RETURNED", "REIMBURSEMENT_NOT_APPROVED"],
  presby_reimbursement_void: ["REIMBURSEMENT_VOIDED"],
  presby_reimbursement_waive_receipt: ["REIMBURSEMENT_RECEIPT_WAIVED"],
  presby_reimbursement_record_payment: ["REIMBURSEMENT_PAYMENT_RECORDED"],
  presby_reimbursement_reverse_payment: ["REIMBURSEMENT_PAYMENT_REVERSED"],
  presby_reimbursement_set_chargeable: ["REIMBURSEMENT_CHARGEABLE_CHANGED"],
  presby_reimbursement_save_category: ["REIMBURSEMENT_CATEGORY_CHANGED"],
  presby_reimbursement_end_category: ["REIMBURSEMENT_CATEGORY_CHANGED"],
};

/** Write definers whose history is the events table (accepted by design, listed for QA). */
const UNAUDITED = new Set([
  "presby_reimbursement_save_draft",
  "presby_reimbursement_update_request",
  "presby_reimbursement_submit",
  "presby_reimbursement_withdraw",
  "presby_reimbursement_add_note",
  "presby_reimbursement_receipt_preflight",
  "presby_reimbursement_attach_receipt",
  "presby_reimbursement_detach_receipt",
]);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

interface Fn {
  file: string;
  name: string;
  body: string;
}

function functionsIn(file: string): Fn[] {
  const source = stripComments(readFileSync(path.join(DIR, file), "utf8"));
  const parts = source.split(/\n(?=export (?:async )?function )/);
  return parts.slice(1).map((part) => ({
    file,
    name: /^export (?:async )?function (\w+)/.exec(part)![1]!,
    body: part,
  }));
}

const FILES = readdirSync(DIR).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "migration-text.ts",
);
const FUNCTIONS = FILES.flatMap(functionsIn);
const DEFINER_CALL = /presby_reimbursement_[a-z_]+(?=\s*\()/g;

describe("audit coverage of src/lib/reimbursement (EC43)", () => {
  it("finds the module's functions (the scan is not vacuous)", () => {
    expect(FUNCTIONS.map((f) => f.name)).toEqual(expect.arrayContaining([
      "saveRequest", "submitRequest", "withdrawRequest", "approveRequest", "returnRequest",
      "recordPayment", "reversePayment", "waiveReceipt", "voidRequest", "addNote", "exportRequests",
      "setChargeable", "saveCategory", "endCategory",
    ]));
  });

  it("every write definer the module calls is classified as audited or deliberately unaudited", () => {
    const READS = new Set([
      "presby_reimbursement_may_file",
      "presby_reimbursement_org_today",
      "presby_reimbursement_my_requests",
      "presby_reimbursement_waiting_for_me",
      "presby_reimbursement_counts",
      "presby_reimbursement_treasurer_list",
      "presby_reimbursement_detail",
      "presby_reimbursement_attachment_lookup",
      "presby_reimbursement_export_rows",
      "presby_reimbursement_settings",
      "presby_reimbursement_form_options",
      "presby_reimbursement_pay_holder_count",
      "presby_reimbursement_open_count",
    ]);
    for (const fn of FUNCTIONS) {
      for (const called of new Set(fn.body.match(DEFINER_CALL) ?? [])) {
        const known = called in AUDITED || UNAUDITED.has(called) || READS.has(called);
        expect(known, `${fn.file}#${fn.name} calls ${called}, which is not classified`).toBe(true);
      }
    }
  });

  it("every function that calls an audited write definer calls auditReimbursement with one of its keys", () => {
    let checked = 0;
    for (const fn of FUNCTIONS) {
      for (const [definer, keys] of Object.entries(AUDITED)) {
        if (!new RegExp(`${definer}\\s*\\(`).test(fn.body)) continue;
        checked += 1;
        expect(fn.body, `${fn.file}#${fn.name} calls ${definer} but not auditReimbursement`).toMatch(/auditReimbursement\(/);
        expect(
          keys.some((key) => fn.body.includes(`AUDIT_ACTIONS.${key}`)),
          `${fn.file}#${fn.name} must audit with one of ${keys.join(", ")}`,
        ).toBe(true);
      }
    }
    // approve, return, void, waive_receipt, record_payment, reverse_payment, set_chargeable, save_category, end_category
    expect(checked).toBeGreaterThanOrEqual(9);
  });

  it("every audited write definer is called by at least one function (a new door cannot hide behind the list)", () => {
    for (const definer of Object.keys(AUDITED)) {
      const callers = FUNCTIONS.filter((fn) => new RegExp(`${definer}\\s*\\(`).test(fn.body));
      expect(callers.length, `${definer} has no caller in src/lib/reimbursement`).toBeGreaterThan(0);
    }
  });

  it("the CSV export (a bulk tier-2 read) audits itself in the read's own transaction with REIMBURSEMENT_EXPORTED", () => {
    const fn = FUNCTIONS.find((f) => f.name === "exportRequests")!;
    expect(fn.file).toBe("csv-export.ts");
    expect(fn.body).toMatch(/presby_reimbursement_export_rows\s*\(/);
    expect(fn.body).toMatch(/auditReimbursement\(\s*tx\b/);
    expect(fn.body).toContain("AUDIT_ACTIONS.REIMBURSEMENT_EXPORTED");
    // the audit comes AFTER the cap test: a refused (413) export left nothing the database should record
    expect(fn.body.indexOf("exceedsCsvCap")).toBeGreaterThan(-1);
    expect(fn.body.indexOf("exceedsCsvCap")).toBeLessThan(fn.body.indexOf("auditReimbursement("));
  });

  it("the unaudited doors write no audit row: a note and the member verbs leave only their history event", () => {
    for (const name of ["addNote", "saveRequest", "submitRequest", "withdrawRequest"]) {
      const fn = FUNCTIONS.find((f) => f.name === name)!;
      expect(fn.body, name).not.toMatch(/auditReimbursement\(/);
    }
  });

  it("the audit call passes the same transaction (never a second connection) and no free-text metadata", () => {
    for (const fn of FUNCTIONS) {
      for (const call of fn.body.matchAll(/auditReimbursement\(\s*tx\b/g)) expect(call[0]).toContain("tx");
      if (/auditReimbursement\(/.test(fn.body) && fn.file !== "audit.ts") {
        expect(fn.body, `${fn.file}#${fn.name}`).toMatch(/auditReimbursement\(\s*tx\b/);
      }
    }
    const metadata = FUNCTIONS.flatMap((fn) => [...fn.body.matchAll(/metadata:\s*\{([^}]*)\}/g)].map((m) => m[1]!));
    for (const m of metadata) {
      expect(m, "metadata carries ids and tags only").not.toMatch(/\b(purpose|name|reason|note|amount|vendor|displayName)\b/);
    }
  });

  it("nothing in the module uses recordAudit() (it would open its own connection)", () => {
    for (const file of FILES) {
      expect(stripComments(readFileSync(path.join(DIR, file), "utf8")), file).not.toMatch(/\brecordAudit\b/);
    }
  });
});
