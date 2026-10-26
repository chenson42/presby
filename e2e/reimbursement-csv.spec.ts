/**
 * reimbursement-csv.spec.ts - the CSV export's BYTES, against a running server
 * (Treasury Increment 1, Batch 7; docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * API Contract Layer 4, P3-16, DECISION-271, EC37, and the Batch 6 amendment T4).
 *
 * The unit tests pin the writer (`csv-shape.test.ts`) and the route's gate with its
 * collaborators mocked (`export/route.test.ts`); this spec reads what a browser
 * session actually receives from the running route, end to end through the database:
 *   - the header row, exact, and one row per request, CRLF-terminated including the last;
 *   - RFC 4180 quoting (a comma and a double quote in free text), and the formula guard on
 *     every free-text cell (a payee or purpose starting `=`, `+`, `-` or `@` is prefixed);
 *   - `Content-Type`, `Content-Disposition: attachment` (named for the congregation and the
 *     day) and `Cache-Control: no-store`;
 *   - the filters (a status, a date range, a range that matches nothing, junk that is
 *     ignored);
 *   - T4: with a group chosen on screen, the file still holds the request of ANOTHER group;
 *   - the audit row (`tenant.reimbursement.exported`): the row count and the filters, never
 *     an amount, a purpose, a payee or a name; written for each file, not for a refusal;
 *   - the gate: signed out is sent to /signin, a holder of `pay` alone (no `view`) is a 403;
 *   - the 413 over 20,000 rows ("Narrow the date range"), with no file and no audit row.
 *     Crossing 20,000 takes 20,001 requests, which no definer loop could build in a test's
 *     lifetime: they are `import`-origin rows (the migration door of EC36), inserted in one
 *     statement. THAT TEST IS THE SLOW ONE (the database's per-row guards run for each of the
 *     20,001 rows: seconds on a warm Neon branch, up to about two and a half minutes on a cold one),
 *     and the congregation's removal can take half a minute more; it is the last test.
 *
 * Everything lives in a THROWAWAY congregation (`e2e-reimbc-<stamp>`) removed in afterAll by
 * deleting that organization. Invented names, `.invalid` addresses, no real data.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { platformSql, withDbRetry, type Sql } from "./support/db";
import {
  auditRows,
  orgToday,
  REIMB_NAMES as NAMES,
  removeReimbursementFixture,
  seedImportedPaid,
  seedRequest,
  setupReimbursementFixture,
  verifiedTreasurerContext,
  type ReimbursementFixture,
} from "./support/reimbursement-fixture";

const HEADER =
  "request_id,status,kind,submitted_on,expense_date,charged_to,category,payee,purpose,amount,approved_on,approval_path,paid_on,payment_method,payment_reference,requested_by,approved_by,paid_by,self_paid";
const EXPORTED = "tenant.reimbursement.exported";

const VENDOR_FORMULA = `=HYPERLINK("http://example.invalid","click")`;
const PURPOSE_QUOTES = `Chairs, "folding" and tables`;

let sql: Sql;
let fx: ReimbursementFixture;
let context: BrowserContext;
const ids: Record<string, string> = {};

const base = () => `/o/${fx.slug}/admin/reimbursements`;
const exportUrl = (query = "") => `${base()}/export${query}`;

/** An RFC 4180 reader: quoted cells, doubled quotes, commas and CRLF inside quotes. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      i++;
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

async function fetchCsv(query = "") {
  const res = await context.request.get(exportUrl(query), { maxRedirects: 0 });
  const body = await res.text();
  return { res, body, rows: res.status() === 200 ? parseCsv(body) : [] };
}

const column = (name: string) => HEADER.split(",").indexOf(name);

async function exportedAudit() {
  return auditRows(sql, EXPORTED, fx.orgId);
}

test.describe.configure({ mode: "serial" });

test.describe("Reimbursements: the CSV export's bytes", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    // A crashed run of THIS spec leaves 20,001 imported rows behind, whose cascade takes about half a minute to sweep.
    test.setTimeout(240_000);
    sql = platformSql("reimbursement-csv.spec");
    fx = await setupReimbursementFixture(sql, { tag: "c" });
    const actors = { orgId: fx.orgId, categorySupplies: fx.categorySupplies, requesterUser: fx.requesterUser, chairUser: fx.chairUser, treasurerUser: fx.treasurerUser };
    ids.paid = await seedRequest(sql, actors, {
      key: "csv-paid-000001", group: fx.groupProperty, cents: 12550, purpose: PURPOSE_QUOTES, kind: "vendor", vendor: VENDOR_FORMULA,
      upTo: "paid", reference: "1042",
    });
    ids.approved = await seedRequest(sql, actors, { key: "csv-appr-000001", group: fx.groupProperty, cents: 4100, purpose: "+SUM(1,2) of tape", upTo: "waived" });
    ids.submitted = await seedRequest(sql, actors, { key: "csv-subm-000001", group: fx.groupProperty, cents: 1500, purpose: "-5 off the sale", upTo: "submitted" });
    // A DIFFERENT group from the one the screen will be filtered to.
    ids.worship = await seedRequest(sql, actors, { key: "csv-wors-000001", group: fx.groupWorship, cents: 700, purpose: "@cmd line", upTo: "submitted" });
    context = await verifiedTreasurerContext(browser, base());
  });

  test.afterAll(async () => {
    // Removing the congregation cascades 20,000+ requests, their payments and events: about half a minute.
    test.setTimeout(240_000);
    await context?.close().catch(() => undefined);
    if (!fx) return; // setup failed before the fixture existed; the next run's sweep clears any leftover
    await removeReimbursementFixture(sql, fx);
  });

  // -------------------------------------------------------------------------
  test("the file: headers, the exact header row, CRLF, one row per request, RFC 4180 quoting, the formula guard, decimal amounts", async () => {
    const before = (await exportedAudit()).length;
    const { res, body, rows } = await fetchCsv();
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["content-disposition"]).toBe(`attachment; filename="reimbursements-${fx.slug}-${new Date().toISOString().slice(0, 10)}.csv"`);

    // The header row, byte for byte; every line ends CRLF, the last one too; no bare LF anywhere.
    expect(body.split("\r\n")[0]).toBe(HEADER);
    expect(body.endsWith("\r\n")).toBe(true);
    expect(body.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(rows[0]).toEqual(HEADER.split(","));
    expect(rows).toHaveLength(1 + 4);
    expect(rows.every((r) => r.length === HEADER.split(",").length)).toBe(true);

    const byId = new Map(rows.slice(1).map((r) => [r[0]!, r]));
    const paid = byId.get(ids.paid)!;
    // RFC 4180: a cell with a comma and a quote is wrapped in quotes with the quote doubled - in the raw bytes ...
    expect(body).toContain(`"${PURPOSE_QUOTES.replace(/"/g, '""')}"`);
    // ... and reads back whole.
    expect(paid[column("purpose")]).toBe(PURPOSE_QUOTES);
    // The formula guard: every free-text cell that begins = + - or @ is prefixed with a quote (payee and purpose both).
    expect(paid[column("payee")]).toBe(`'${VENDOR_FORMULA}`);
    expect(byId.get(ids.approved)![column("purpose")]).toBe("'+SUM(1,2) of tape");
    expect(byId.get(ids.submitted)![column("purpose")]).toBe("'-5 off the sale");
    expect(byId.get(ids.worship)![column("purpose")]).toBe("'@cmd line");
    // Amounts are bare decimal dollars: a spreadsheet reads a number, not text.
    expect(paid[column("amount")]).toBe("125.50");
    expect(byId.get(ids.approved)![column("amount")]).toBe("41.00");
    expect(byId.get(ids.worship)![column("amount")]).toBe("7.00");
    // The paid row: what was paid, how, by whom, approved by whom.
    expect(paid[column("status")]).toBe("paid");
    expect(paid[column("kind")]).toBe("vendor");
    expect(paid[column("charged_to")]).toBe(NAMES.property);
    expect(paid[column("category")]).toBe(NAMES.supplies);
    expect(paid[column("payment_method")]).toBe("check");
    expect(paid[column("payment_reference")]).toBe("1042");
    expect(paid[column("paid_on")]).toBe(await orgToday(sql));
    expect(paid[column("requested_by")]).toBe(NAMES.requester);
    expect(paid[column("paid_by")]).toBe(NAMES.treasurer);
    expect(paid[column("approval_path")]).toBe("seat");
    expect(paid[column("self_paid")]).toBe("false");
    // An unpaid request's payment cells are empty, not invented.
    const submitted = byId.get(ids.submitted)!;
    for (const name of ["approved_on", "approval_path", "paid_on", "payment_method", "payment_reference", "approved_by", "paid_by"]) {
      expect(submitted[column(name)], name).toBe("");
    }
    // No email address, phone number or bank detail is a column of this file.
    expect(body).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.invalid/);
    expect(body.toLowerCase()).not.toMatch(/routing|account number|iban/);

    // The audit row for THIS file: the count and the filters.
    const after = await exportedAudit();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.metadata).toEqual({ organizationId: fx.orgId, rowCount: 4, from: null, to: null, status: null });
    expect(after.at(-1)!.actor_user_id).toBe(fx.treasurerUser);
  });

  test("the filters: a status, a date range, a range that matches nothing, and junk that is ignored; each file is audited with its filters", async () => {
    const today = await orgToday(sql);
    const cases: Array<[string, string[], { from: string | null; to: string | null; status: string | null }]> = [
      ["?status=approved", [ids.approved], { from: null, to: null, status: "approved" }],
      ["?status=paid", [ids.paid], { from: null, to: null, status: "paid" }],
      [`?from=${today}&to=${today}`, [ids.paid, ids.approved, ids.submitted, ids.worship], { from: today, to: today, status: null }],
      ["?from=2001-01-01&to=2001-01-31", [], { from: "2001-01-01", to: "2001-01-31", status: null }],
      // Not a status the file can filter by, and a date that is not one: both ignored, so it is the whole file.
      ["?status=draft&from=nonsense&limit=1&organizationId=evil", [ids.paid, ids.approved, ids.submitted, ids.worship], { from: null, to: null, status: null }],
    ];
    for (const [query, expected, filters] of cases) {
      const before = (await exportedAudit()).length;
      const { res, rows } = await fetchCsv(query);
      expect(res.status(), query).toBe(200);
      expect(rows[0], query).toEqual(HEADER.split(","));
      expect(rows.slice(1).map((r) => r[0]).sort(), query).toEqual([...expected].sort());
      const audit = await exportedAudit();
      expect(audit, query).toHaveLength(before + 1);
      expect(audit.at(-1)!.metadata, query).toEqual({ organizationId: fx.orgId, rowCount: expected.length, ...filters });
    }
  });

  // -------------------------------------------------------------------------
  test("T4: with a group chosen on screen, Export CSV still downloads every group (and the page says so)", async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`${base()}?tab=all`);
    await page.getByLabel("Charged to").selectOption({ label: NAMES.property });
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByTestId("queue-row")).toHaveCount(3);
    await expect(page.getByTestId("export-note")).toHaveText("The file covers every group, not only the one chosen under Charged to.");
    // The link carries no group: the file is the same one the route serves with no filter.
    await expect(page.getByTestId("export-csv")).toHaveAttribute("href", exportUrl());

    const before = (await exportedAudit()).length;
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
    expect(download.suggestedFilename()).toBe(`reimbursements-${fx.slug}-${new Date().toISOString().slice(0, 10)}.csv`);
    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const rows = parseCsv(readFileSync(path, "utf8"));
    const ids_ = rows.slice(1).map((r) => r[0]);
    // The Worship request is NOT on screen and IS in the file.
    expect(ids_).toContain(ids.worship);
    expect(rows.slice(1).map((r) => r[column("charged_to")])).toContain(NAMES.worship);
    expect(rows).toHaveLength(1 + 4);
    expect(await exportedAudit()).toHaveLength(before + 1);
    await page.close();
  });

  test("the audit rows hold ids, counts and filters only: no amount, no purpose, no payee, no name", async () => {
    const all = await exportedAudit();
    expect(all.length).toBeGreaterThanOrEqual(7);
    for (const row of all) {
      expect(Object.keys(row.metadata).sort()).toEqual(["from", "organizationId", "rowCount", "status", "to"]);
      expect(row.actor_user_id).toBe(fx.treasurerUser);
    }
    const text = JSON.stringify(all);
    for (const secret of ["Chairs", "folding", "HYPERLINK", "SUM(1,2)", "tape", "sale", "cmd line", "Brightwater", "Vance", "Harbor", "125.50", NAMES.property, NAMES.worship]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  // -------------------------------------------------------------------------
  test("the gate: signed out is sent to /signin keeping the URL; a holder of pay without view is a 403 and no file is written", async ({ browser }) => {
    const anonymous = await browser.newContext();
    const res = await anonymous.request.get(exportUrl("?status=paid"), { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers()["location"]!, "http://localhost").pathname).toBe("/signin");
    // The proxy sends a signed-out visitor to /signin with the PATH (it drops the query string, F3a), so the way back is the unfiltered file.
    expect(new URL(res.headers()["location"]!, "http://localhost").searchParams.get("callbackUrl")).toBe(exportUrl());
    await anonymous.close();

    // Permissions are read live: swap the treasurer's role for the pay-only one, ask, swap back.
    const before = (await exportedAudit()).length;
    await withDbRetry("swap to the pay-only role", async () => {
      await sql`delete from role_grants where organization_id = ${fx.orgId}::uuid and person_id = ${fx.treasurerPerson}::uuid`;
      await sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
        values (${fx.orgId}::uuid, ${fx.payerRole}::uuid, ${fx.treasurerPerson}::uuid, date '2020-01-01', ${fx.treasurerUser}::uuid)`;
    });
    try {
      const refused = await context.request.get(exportUrl(), { maxRedirects: 0 });
      expect(refused.status()).toBe(403);
      expect(await refused.text()).toBe("You don't have permission to do that.");
      expect(refused.headers()["content-type"]).toContain("text/plain");
      expect(await exportedAudit()).toHaveLength(before);
    } finally {
      await withDbRetry("swap back to the treasurer role", async () => {
        await sql`delete from role_grants where organization_id = ${fx.orgId}::uuid and person_id = ${fx.treasurerPerson}::uuid`;
        await sql`
          insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
          values (${fx.orgId}::uuid, ${fx.treasurerRole}::uuid, ${fx.treasurerPerson}::uuid, date '2020-01-01', ${fx.treasurerUser}::uuid)`;
      });
    }
    expect((await context.request.get(exportUrl("?status=paid"), { maxRedirects: 0 })).status()).toBe(200);
  });

  // -------------------------------------------------------------------------
  test("over 20,000 requests the export is a 413 with the Copy sentence, no file and no audit row; narrowing gets under the cap", async () => {
    test.setTimeout(600_000);
    const inserted = await seedImportedPaid(sql, { orgId: fx.orgId, groupId: fx.groupProperty, beneficiaryPersonId: fx.requesterPerson, count: 20_001 });
    expect(inserted).toBe(20_001);

    const before = (await exportedAudit()).length;
    for (const query of ["", "?status=paid"]) {
      const res = await context.request.get(exportUrl(query), { maxRedirects: 0, timeout: 120_000 });
      expect(res.status(), query).toBe(413);
      expect(res.headers()["content-type"], query).toContain("text/plain");
      expect(res.headers()["content-disposition"] ?? "", query).toBe("");
      expect(await res.text(), query).toBe("Narrow the date range: that export is more than 20,000 requests.");
    }
    expect(await exportedAudit(), "a refused export writes no audit row").toHaveLength(before);

    // Narrowing by status or by date gets under the cap: a whole file, not a truncated one.
    const narrowed = await context.request.get(exportUrl("?status=approved"), { maxRedirects: 0, timeout: 120_000 });
    expect(narrowed.status()).toBe(200);
    expect(parseCsv(await narrowed.text())).toHaveLength(2);
    const dated = await context.request.get(exportUrl("?from=2001-01-01&to=2001-01-31"), { maxRedirects: 0, timeout: 120_000 });
    expect(dated.status()).toBe(200);
    expect(parseCsv(await dated.text())).toHaveLength(1);
    expect(await exportedAudit()).toHaveLength(before + 2);
  });
});
