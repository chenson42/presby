/**
 * The audience registry is closed and complete (ER14, DECISION-216): a
 * TypeScript-AST scan of non-test `src/` finds every call to `enqueueEmail()`
 * and `insertQueueRowInTx()` and takes the `templateKey` of its object-literal
 * argument.
 *
 *   - a string literal must be a registry key;
 *   - a non-literal must be on the small NAMED map below (an identifier or
 *     property access whose value is known), else the test fails with
 *     "classify this sender";
 *   - every registry key must be found (no stale entry).
 *
 * So the question "which address does this send use?" is asked mechanically
 * for every sender, today and for the next one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EMAIL_AUDIENCE, audienceFor, type Audience } from "./email-audience";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");
const rel = (file: string) => path.relative(ROOT, file);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const isTest = (file: string) => /\.(test|spec)\.(ts|tsx)$/.test(file);

/**
 * Non-literal template keys, by the exact source text of the expression. A value
 * may be a LIST when one call site sends several keys (the reimbursement notices
 * choose their key from the notice they build); each is then classified and each
 * counts as used.
 */
const NAMED: Readonly<Record<string, string | readonly string[]>> = {
  // src/lib/onboarding/invitation-email.ts: `export const ACCOUNT_INVITATION_TEMPLATE_KEY = "account_invitation"`
  ACCOUNT_INVITATION_TEMPLATE_KEY: "account_invitation",
  // src/lib/onboarding/invitation-email.ts: `export const ACCOUNT_SIGN_IN_TEMPLATE_KEY = "account_sign_in_invitation"`
  ACCOUNT_SIGN_IN_TEMPLATE_KEY: "account_sign_in_invitation",
  // src/lib/giving/statements/notice.ts: `buildStatementNotice()` returns STATEMENT_NOTICE_TEMPLATE
  "notice.templateKey": "giving.statement.notice",
  // src/lib/reimbursement/notify.ts: `buildNotice()` returns one of NOTICE_TEMPLATE_KEYS
  "built.templateKey": [
    "reimbursement.notice.needs_approval",
    "reimbursement.notice.needs_treasurer",
    "reimbursement.notice.ready_to_pay",
    "reimbursement.notice.requester_update",
  ],
};

const SENDERS: Record<string, number> = { enqueueEmail: 0, insertQueueRowInTx: 1 };
/** The definitions themselves compose the two (`insertQueueRowInTx(db, input)`). */
const QUEUE_MODULE = path.join(SRC, "lib", "email", "queue.ts");

interface Found {
  file: string;
  callee: string;
  /** The template key, or the unclassifiable expression text. */
  key: string | null;
  expression: string;
}

function scan(): Found[] {
  const found: Found[] = [];
  const files = walk(SRC).filter((f) => !isTest(f) && f !== QUEUE_MODULE);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!/enqueueEmail|insertQueueRowInTx/.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text in SENDERS) {
        const callee = node.expression.text;
        const arg = node.arguments[SENDERS[callee]!];
        let keys: readonly string[] = [];
        let expression = "(no object-literal argument)";
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const prop = arg.properties.find(
            (p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
              (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
              ts.isIdentifier(p.name) &&
              p.name.text === "templateKey",
          );
          if (prop) {
            const init = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
            expression = init.getText(source);
            if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) keys = [init.text];
            else {
              const named = NAMED[expression];
              keys = named === undefined ? [] : typeof named === "string" ? [named] : named;
            }
          } else {
            expression = "(no templateKey property)";
          }
        }
        if (keys.length === 0) found.push({ file: rel(file), callee, key: null, expression });
        for (const key of keys) found.push({ file: rel(file), callee, key, expression });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

const FOUND = scan();

describe("the audience registry is closed and complete (ER14)", () => {
  it("the scan finds the senders (not vacuous)", () => {
    expect(FOUND.length).toBeGreaterThanOrEqual(14);
    expect(FOUND.map((f) => f.callee)).toContain("insertQueueRowInTx");
    expect(FOUND.map((f) => f.callee)).toContain("enqueueEmail");
  });

  it("every sender's template key is resolvable: classify any new sender in email-audience.ts", () => {
    const unresolved = FOUND.filter((f) => f.key === null).map(
      (f) => `${f.file}: ${f.callee}(...) has templateKey ${f.expression} - classify this sender (add the key to EMAIL_AUDIENCE, or to NAMED if it is a named constant)`,
    );
    expect(unresolved).toEqual([]);
  });

  it("every resolved template key is classified in the registry", () => {
    const unclassified = FOUND.filter((f) => f.key !== null && audienceFor(f.key) === null).map(
      (f) => `${f.file}: template key "${f.key}" is not in EMAIL_AUDIENCE - classify this sender`,
    );
    expect(unclassified).toEqual([]);
  });

  it("every registry key is used by a sender (no stale entry)", () => {
    const used = new Set(FOUND.map((f) => f.key));
    const stale = Object.keys(EMAIL_AUDIENCE).filter((key) => !used.has(key));
    expect(stale).toEqual([]);
  });

  it("every NAMED expression is still used (no stale mapping)", () => {
    const usedExpressions = new Set(FOUND.map((f) => f.expression));
    expect(Object.keys(NAMED).filter((e) => !usedExpressions.has(e))).toEqual([]);
  });

  it("audiences are drawn from the closed vocabulary", () => {
    const allowed: Audience[] = ["account", "typed", "donor", "person:credential", "person:role", "person:personal"];
    for (const [key, audience] of Object.entries(EMAIL_AUDIENCE)) {
      expect(allowed, key).toContain(audience);
    }
  });

  it("the classification today (a change here is a decision about where mail goes)", () => {
    expect(EMAIL_AUDIENCE).toEqual({
      password_reset: "account",
      email_change_verify: "account",
      feedback_notification: "account",
      domain_notification: "account",
      ticket_new: "account",
      ticket_filed_confirmation: "account",
      ticket_operator_reply: "account",
      ticket_submitter_reply: "account",
      ticket_resolved: "account",
      ticket_feedback_promoted: "account",
      account_invitation: "typed",
      statistics_submission_grant: "typed",
      account_sign_in_invitation: "person:credential",
      "giving.statement.notice": "donor",
      // Treasury Increment 1, P3-11: approver, treasurer and requester notices
      "reimbursement.notice.needs_approval": "person:role",
      "reimbursement.notice.needs_treasurer": "person:role",
      "reimbursement.notice.ready_to_pay": "person:role",
      "reimbursement.notice.requester_update": "person:role",
    });
  });

  it("the senders that address a person's contact email are the congregation's sign-in invitation (person:credential) and the four reimbursement notices (person:role); giving is not wired, D7", () => {
    const personKeys = Object.entries(EMAIL_AUDIENCE).filter(([, a]) => a.startsWith("person:"));
    expect(personKeys.sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ["account_sign_in_invitation", "person:credential"],
      ["reimbursement.notice.needs_approval", "person:role"],
      ["reimbursement.notice.needs_treasurer", "person:role"],
      ["reimbursement.notice.ready_to_pay", "person:role"],
      ["reimbursement.notice.requester_update", "person:role"],
    ]);
  });

  it("the sign-in invitation is sent by org-invite.ts alone, through the definer-chosen address (the registry entry and the sender land together)", () => {
    const senders = FOUND.filter((f) => f.key === "account_sign_in_invitation");
    expect(senders.map((f) => f.file)).toEqual(["src/lib/onboarding/org-invite.ts"]);
  });

  it("audienceFor is exact: inherited object keys are not classified", () => {
    expect(audienceFor("constructor")).toBeNull();
    expect(audienceFor("toString")).toBeNull();
    expect(audienceFor("password_reset")).toBe("account");
  });
});
