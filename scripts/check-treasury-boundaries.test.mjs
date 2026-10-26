/**
 * Fixture tests for the treasury-boundaries tripwire. Every rule here is
 * "appears nowhere / appears in one place", so on a clean tree each one passes
 * vacuously; a rule nobody has proved works is a rule that drifts. The proof is
 * synthetic files fed straight to checkTreasuryBoundaries() - which is why it
 * takes an array of { path, content } instead of reading the disk - one
 * violating tree per rule, plus the legal neighbours that must NOT fire, plus a
 * test that the real repository is clean and one that planting a violation in a
 * real file makes the real scan fail.
 *
 * Run via: npm test
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  checkSharpHasItsImporter,
  checkTreasuryBoundaries,
  checkTreasuryBoundariesTree,
  collectFiles,
  DEV_DOCS_FILE,
  EMAIL_AUDIENCE_FILE,
  inputTags,
  isNoOwnerConnectionZone,
  mayNameReimbursementTables,
  SHARP_FILE,
} from "./check-treasury-boundaries.mjs";

/** @param {string} path @param {string} content */
const f = (path, content) => ({ path, content });
const rules = (violations) => violations.map((v) => v.rule);

const MEMBER = "src/app/(org)/o/[slug]/reimbursements";
const ADMIN = "src/app/(org)/o/[slug]/admin/reimbursements";

// ── T1 - no owner connection in the money paths ─────────────────────────────

describe("T1 - no owner connection under reimbursement, treasury or either route tree", () => {
  it.each([
    ["src/lib/reimbursement/payments.ts", 'import { getPlatformDb } from "@/lib/db";'],
    ["src/lib/reimbursement/reads.ts", "const url = process.env.PLATFORM_DATABASE_URL;"],
    ["src/lib/treasury/team.ts", "const url = process.env.MIGRATE_DATABASE_URL;"],
    ["src/components/treasury/team-panel.tsx", "const db = getPlatformDb();"],
    [`${MEMBER}/actions.ts`, "const db = getPlatformDb();"],
    [`${MEMBER}/[id]/print/route.ts`, "const db = getPlatformDb();"],
    [`${ADMIN}/export/route.ts`, "const db = getPlatformDb();"],
    [`${ADMIN}/team/actions.ts`, "const db = getPlatformDb();"],
    ["src/app/api/cron/reimbursements/route.ts", "const db = getPlatformDb();"],
  ])("flags %s", (path, src) => {
    const v = checkTreasuryBoundaries([f(path, src)]);
    expect(rules(v)).toEqual(["T1"]);
    expect(v[0].line).toBe(1);
    expect(v[0].file).toBe(path);
  });

  it("does not fire outside the zone, in a test, or in a comment", () => {
    expect(checkTreasuryBoundaries([f("src/lib/admin/giving-ingest-health.ts", "const db = getPlatformDb();")])).toEqual([]);
    expect(checkTreasuryBoundaries([f("src/app/(org)/o/[slug]/giving/page.tsx", "const db = getPlatformDb();")])).toEqual([]);
    expect(checkTreasuryBoundaries([f("src/lib/reimbursement/text.db.test.ts", "const owner = getPlatformDb();")])).toEqual([]);
    expect(checkTreasuryBoundaries([f("src/lib/reimbursement/reads.ts", "// never call getPlatformDb() here\n/* PLATFORM_DATABASE_URL */")])).toEqual([]);
  });

  it("defines the zone as the two libraries, the components, both trees and any reimbursement api path", () => {
    expect(isNoOwnerConnectionZone("src/lib/reimbursement/a.ts")).toBe(true);
    expect(isNoOwnerConnectionZone("src/lib/treasury/a.ts")).toBe(true);
    expect(isNoOwnerConnectionZone("src/components/treasury/a.tsx")).toBe(true);
    expect(isNoOwnerConnectionZone(`${MEMBER}/page.tsx`)).toBe(true);
    expect(isNoOwnerConnectionZone(`${ADMIN}/page.tsx`)).toBe(true);
    expect(isNoOwnerConnectionZone("src/app/api/reimbursements/export/route.ts")).toBe(true);
    expect(isNoOwnerConnectionZone("src/lib/giving/a.ts")).toBe(false);
    expect(isNoOwnerConnectionZone("src/app/(org)/o/[slug]/admin/giving/page.tsx")).toBe(false);
    expect(isNoOwnerConnectionZone("src/app/api/cron/domains/route.ts")).toBe(false);
  });
});

// ── T2 - only src/lib/reimbursement/ and the mirror name the tables ─────────

describe("T2 - only src/lib/reimbursement/ and the Drizzle mirror name a reimbursement table or definer", () => {
  it.each([
    [`${MEMBER}/page.tsx`, 'await tx.execute(sql`select * from reimbursement_requests`);'],
    [`${ADMIN}/actions.ts`, "sql`insert into reimbursement_payments (id) values (1)`;"],
    ["src/lib/org-feature-warnings.ts", 'const q = "select count(*) from reimbursement_events";'],
    [`${MEMBER}/[id]/page.tsx`, "sql`select presby_reimbursement_detail(${id}::uuid, ${u}::uuid, 'member')`;"],
    ["src/lib/treasury/team.ts", 'sql`select presby_reimbursement_open_count()`;'],
    ["src/components/treasury/team-panel.tsx", 'import { reimbursementRequests } from "@/lib/db/domain";'],
    ["src/lib/giving/x.ts", "from(reimbursementPayments)"],
    ["src/lib/x.ts", "const t = 'reimbursement_chargeable_groups', c = 'reimbursement_categories', a = 'reimbursement_attachments';"],
  ])("flags %s", (path, src) => {
    const v = checkTreasuryBoundaries([f(path, src)]);
    expect(rules(v)).toContain("T2");
    expect(v[0].file).toBe(path);
  });

  it("allows the module itself, the Drizzle mirror and the DB-test fixtures", () => {
    expect(
      checkTreasuryBoundaries([
        f("src/lib/reimbursement/reads.ts", "sql`select presby_reimbursement_detail(${id}::uuid)`;"),
        f("src/lib/reimbursement/csv-export.ts", "sql`select * from presby_reimbursement_export_rows(${a})`;"),
        f("src/lib/db/domain/reimbursement.ts", 'export const reimbursementRequests = pgTable("reimbursement_requests", {});'),
        f("src/lib/testing/reimbursement-fixture.ts", "sql`insert into reimbursement_categories (name) values ('x')`;"),
      ]),
    ).toEqual([]);
  });

  it("does not mistake the permission keys, the team path or the role keys for tables", () => {
    expect(
      checkTreasuryBoundaries([
        f(`${ADMIN}/team/actions.ts`, 'const AUDIT_PATH = "reimbursement_team"; const key = "reimbursement.view";'),
        f("src/lib/treasury/team.ts", 'templateKeys: ["treasurer", "reimbursement_clerk"],'),
        f("src/lib/org-features.ts", 'key: "org_portal.reimbursement",'),
        f("src/lib/audit.ts", 'REIMBURSEMENT_APPROVED: "tenant.reimbursement.approved",'),
      ]),
    ).toEqual([]);
  });

  it("does not fire in a test or a comment", () => {
    expect(checkTreasuryBoundaries([f(`${MEMBER}/actions.test.ts`, "sql`select from reimbursement_requests`")])).toEqual([]);
    expect(checkTreasuryBoundaries([f("src/lib/audit.ts", "// reimbursement_events is the record\n/* presby_reimbursement_detail */")])).toEqual([]);
  });

  it("lets the developer reference file the tables by name, and nothing else in src/lib/ do the same", () => {
    expect(checkTreasuryBoundaries([f(DEV_DOCS_FILE, '  reimbursement_requests: "T. Reimbursements",')])).toEqual([]);
    expect(rules(checkTreasuryBoundaries([f("src/lib/dev-docs-extra.ts", '  reimbursement_requests: "T. Reimbursements",')]))).toEqual(["T2"]);
  });

  it("defines the allowed places", () => {
    expect(mayNameReimbursementTables("src/lib/reimbursement/a.ts")).toBe(true);
    expect(mayNameReimbursementTables("src/lib/db/domain/reimbursement.ts")).toBe(true);
    expect(mayNameReimbursementTables("src/lib/db/domain/reimbursement.schema.ts")).toBe(true);
    expect(mayNameReimbursementTables("src/lib/testing/reimbursement-fixture.ts")).toBe(true);
    // the developer reference classifies every table by name (F283, filed by each pipeline per F338)
    expect(mayNameReimbursementTables(DEV_DOCS_FILE)).toBe(true);
    expect(mayNameReimbursementTables("src/lib/dev-docs.test.ts")).toBe(false);
    expect(mayNameReimbursementTables("src/lib/dev-docs/other.ts")).toBe(false);
    expect(mayNameReimbursementTables("src/lib/db/domain/people.ts")).toBe(false);
    expect(mayNameReimbursementTables("src/lib/db/domain/reimbursement/x.ts")).toBe(false);
    expect(mayNameReimbursementTables("src/lib/treasury/team.ts")).toBe(false);
  });
});

// ── T3 - no `capture` on a file input ───────────────────────────────────────

describe("T3 - no capture attribute on any file input", () => {
  it.each([
    ['<input type="file" capture="environment" />'],
    ["<input type='file' capture />"],
    ['<input type="file" accept="image/*" capture={true} />'],
    ['<Input type="file" capture="user" />'],
    ['<input\n  type="file"\n  accept="image/*"\n  capture="environment"\n  onChange={(e) => handle(e)}\n/>'],
    ['<input capture="environment" type="file" />'],
    ['<input type={"file"} capture="environment" />'],
    ['<input onChange={(e) => { if (e.target.files) go(e.target.files); }} type="file" capture />'],
  ])("flags %j", (jsx) => {
    const v = checkTreasuryBoundaries([f(`${MEMBER}/receipt-slot.tsx`, `export const A = () => (\n${jsx}\n);`)]);
    expect(rules(v)).toEqual(["T3"]);
  });

  it("is global: a component outside src/app is flagged too", () => {
    expect(rules(checkTreasuryBoundaries([f("src/components/shared/photo.tsx", '<input type="file" capture />')]))).toEqual(["T3"]);
  });

  it("reports the line of the tag", () => {
    const v = checkTreasuryBoundaries([f("src/components/shared/photo.tsx", 'const a = 1;\nconst b = <input type="file" capture />;')]);
    expect(v[0].line).toBe(2);
  });

  it("does not fire on a file input without capture, or on capture where the input is not a file input", () => {
    expect(
      checkTreasuryBoundaries([
        f("src/a.tsx", '<input type="file" accept="image/*,application/pdf" multiple />'),
        f("src/b.tsx", '<input type="text" capture="x" />'),
        f("src/c.tsx", '<input type="file" className="capture" aria-label="capture a receipt" />'),
        f("src/d.tsx", '<input type="file" onChange={() => capture(file)} />'),
        f("src/e.tsx", '<input type="file" data-capture="no" id="capture" />'),
        f("src/f.tsx", "<Input type=\"file\" title='capture' />"),
      ]),
    ).toEqual([]);
  });

  it("does not fire in a test or a comment", () => {
    expect(checkTreasuryBoundaries([f("src/a.test.tsx", '<input type="file" capture />')])).toEqual([]);
    expect(checkTreasuryBoundaries([f("src/a.tsx", '// <input type="file" capture />\n/* <input type="file" capture /> */')])).toEqual([]);
  });

  it("parses a tag's own attributes, not words inside values", () => {
    const [tag] = inputTags('<input type="file" className="capture" onChange={() => capture()} capture={x} />');
    expect([...tag.attributes].sort()).toEqual(["capture", "className", "onChange", "type"].sort());
    const [other] = inputTags('<input type="file" className="capture" onChange={() => capture()} />');
    expect(other.attributes.has("capture")).toBe(false);
  });
});

// ── T4 - a notice carries no money and no free text ─────────────────────────

describe("T4 - a file that builds or sends a reimbursement notice names no money or free-text identifier", () => {
  const KEY = 'export const KEY = "reimbursement.notice.needs_approval";\n';

  it.each([
    ["amount", "const amount = 1;"],
    ["amountCents", "x(detail.amountCents);"],
    ["amount_cents", 'sql`select amount_cents from t`;'],
    ["formatMoney", "formatMoney(c);"],
    ["formatCents", "formatCents(c);"],
    ["centsToDecimal", "centsToDecimal(c);"],
    ["totalCents", "const totalCents = 1;"],
    ["formatAmount", "formatAmount(c);"],
    ["Intl.NumberFormat", 'new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });'],
    ["dollars", "const dollars = 1;"],
    ["purpose", "const purpose = detail.purpose;"],
    ["vendorName", "vendorName"],
    ["payeeName", "payeeName"],
    ["expenseDate", "expenseDate"],
    ["expense_date", "expense_date"],
    ["reason", "const reason = r;"],
  ])("flags %s in a file that references a notice key", (_name, body) => {
    const v = checkTreasuryBoundaries([f("src/lib/reimbursement/notices.ts", KEY + body)]);
    expect(rules(v)).toEqual(["T4"]);
    expect(v[0].line).toBe(2);
  });

  it("flags a file that imports the notices module, however it is spelled", () => {
    for (const spec of ["./notices", "@/lib/reimbursement/notices"]) {
      const v = checkTreasuryBoundaries([
        f("src/lib/reimbursement/notify.ts", `import { buildNotice } from "${spec}";\nconst amount = 1;`),
      ]);
      expect(rules(v)).toEqual(["T4"]);
    }
  });

  it("does not fire on a clean notice file, a clean sender, or neighbours like footnote and requester_update", () => {
    expect(
      checkTreasuryBoundaries([
        f(
          "src/lib/reimbursement/notices.ts",
          KEY + 'export const FOOTNOTE = "x"; const variant = "requester_update"; const kind = "needs_treasurer";',
        ),
        f("src/lib/reimbursement/notify.ts", 'import { buildNotice, noticeLink } from "./notices";\nawait attemptQueuedSend(queueId);'),
      ]),
    ).toEqual([]);
  });

  it("does not fire in a file that references neither the key nor the module (a permission key starts reimbursement. too)", () => {
    expect(
      checkTreasuryBoundaries([
        f("src/lib/reimbursement/payments.ts", 'const amount = 1; const purpose = ""; const key = "reimbursement.pay";'),
        f("src/lib/reimbursement/decisions.ts", 'import { queueNotices } from "./notify";\nconst reason = "r";'),
      ]),
    ).toEqual([]);
  });

  it("does not fire in a comment or a test, and exempts the shared audience registry by name", () => {
    expect(checkTreasuryBoundaries([f("src/lib/reimbursement/notices.ts", KEY + "// no amount, purpose or reason here")])).toEqual([]);
    expect(checkTreasuryBoundaries([f("src/lib/reimbursement/notices.test.ts", KEY + "const amount = 1;")])).toEqual([]);
    expect(checkTreasuryBoundaries([f(EMAIL_AUDIENCE_FILE, KEY + "const purpose = 'role';")])).toEqual([]);
    expect(checkTreasuryBoundaries([f("src/lib/contact-methods/other.ts", KEY + "const purpose = 'role';")])).toHaveLength(1);
  });
});

// ── T5 - sharp is imported at runtime by one file ───────────────────────────

describe("T5 - sharp is imported at runtime only by src/lib/storage/image-sanitize.ts", () => {
  it.each([
    ['import sharp from "sharp";'],
    ["import sharp from 'sharp';"],
    ['import * as sharp from "sharp";'],
    ['import { default as sharp } from "sharp";'],
    ['import "sharp";'],
    ['const sharp = require("sharp");'],
    ['const sharp = (await import("sharp")).default;'],
    ['export { default } from "sharp";'],
    ['import sharp from "sharp/lib/index.js";'],
    ['import {\n  default as sharp,\n} from "sharp";'],
  ])("flags %j in any other file", (src) => {
    const v = checkTreasuryBoundaries([f("src/lib/reimbursement/receipts.ts", src)]);
    expect(rules(v)).toEqual(["T5"]);
  });

  it("allows the one file, a type-only import anywhere, a test, and a comment", () => {
    expect(
      checkTreasuryBoundaries([
        f(SHARP_FILE, 'import sharp from "sharp";'),
        f("src/lib/reimbursement/receipts.ts", 'import type { Sharp } from "sharp";'),
        f("src/lib/storage/image-sanitize.test.ts", 'import sharp from "sharp";'),
        f("src/lib/reimbursement/x.ts", '// import sharp from "sharp";'),
      ]),
    ).toEqual([]);
  });

  it("does not mistake another package whose name starts with sharp", () => {
    expect(checkTreasuryBoundaries([f("src/lib/x.ts", 'import s from "sharp-thing";')])).toEqual([]);
  });

  describe("exactly one: the allowed file must exist and import it at runtime", () => {
    it("passes when the one file imports sharp, however it is written", () => {
      for (const src of ['import sharp from "sharp";', 'const sharp = require("sharp");', 'const s = await import("sharp");']) {
        expect(checkSharpHasItsImporter([f(SHARP_FILE, src)])).toEqual([]);
      }
    });

    it("fails when the file is missing from the tree", () => {
      const v = checkSharpHasItsImporter([f("src/lib/storage/blob-store.ts", "export {};")]);
      expect(rules(v)).toEqual(["T5"]);
      expect(v[0].file).toBe(SHARP_FILE);
      expect(v[0].message).toMatch(/does not exist/);
    });

    it("fails when the file exists but no longer imports sharp (or only its types, or only in a comment)", () => {
      for (const src of ["export const x = 1;", 'import type { Sharp } from "sharp";', '// import sharp from "sharp";']) {
        const v = checkSharpHasItsImporter([f(SHARP_FILE, src)]);
        expect(rules(v), src).toEqual(["T5"]);
        expect(v[0].message).toMatch(/no longer imports/);
      }
    });

    it("the whole-tree check is the main check plus this one, so an extra importer AND a missing one both show", () => {
      const v = checkTreasuryBoundariesTree([f("src/lib/reimbursement/receipts.ts", 'import sharp from "sharp";')]);
      expect(rules(v)).toEqual(["T5", "T5"]);
      expect(v.map((x) => x.file)).toEqual(["src/lib/reimbursement/receipts.ts", SHARP_FILE]);
    });
  });
});

// ── The scan itself ─────────────────────────────────────────────────────────

describe("the real repository", () => {
  it("is clean, and image-sanitize.ts is the one file importing sharp (T5, exactly one)", async () => {
    const files = await collectFiles();
    expect(checkTreasuryBoundariesTree(files)).toEqual([]);
    expect(files.some((file) => file.path === SHARP_FILE)).toBe(true);
  });

  it("scans real files (the scan is not vacuous) and planting one violation per rule in the real tree makes it fail", async () => {
    const files = await collectFiles();
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((file) => file.path === "src/lib/reimbursement/notices.ts")).toBe(true);
    expect(files.some((file) => file.path === "src/lib/reimbursement/print.ts")).toBe(true);
    const planted = [
      f(`${ADMIN}/page.tsx`, "const db = getPlatformDb();"),
      f(`${MEMBER}/new/page.tsx`, "sql`select * from reimbursement_requests`"),
      f("src/components/shared/receipt.tsx", '<input type="file" capture="environment" />'),
      f("src/lib/reimbursement/notify.ts", 'import { buildNotice } from "./notices";\nconst amount = 1;'),
      f("src/lib/reimbursement/receipts.ts", 'import sharp from "sharp";'),
    ];
    const notifyReal = files.find((file) => file.path === "src/lib/reimbursement/notify.ts");
    expect(notifyReal).toBeDefined();
    const violations = checkTreasuryBoundaries([...files.filter((file) => file.path !== "src/lib/reimbursement/notify.ts"), ...planted]);
    expect(new Set(rules(violations))).toEqual(new Set(["T1", "T2", "T3", "T4", "T5"]));
  });
});

describe("the wiring", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  it("has its own npm script and runs inside `npm run check`, after the giving tripwire", () => {
    expect(pkg.scripts["check:treasury-boundaries"]).toBe("node scripts/check-treasury-boundaries.mjs");
    const steps = pkg.scripts.check.split("&&").map((s) => s.trim());
    expect(steps).toContain("npm run check:treasury-boundaries");
    expect(steps.indexOf("npm run check:treasury-boundaries")).toBeGreaterThan(steps.indexOf("npm run check:giving-boundaries"));
  });

  it("runs all nine tripwires", () => {
    const steps = pkg.scripts.check.split("&&").map((s) => s.trim());
    expect(steps).toHaveLength(9);
    for (const step of steps) expect(step).toMatch(/^npm run check:[a-z-]+$/);
  });
});
