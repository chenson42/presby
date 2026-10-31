/**
 * The requests CSV route (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * Layer 4, P3-16, EC37). `check:audit` scans only `actions.ts`, so THIS test holds
 * the hand-audited properties: the gate order and its response shapes, the file's
 * headers, the 413, and that the read and its audit row are one call
 * (`exportRequests`, tested against a real database in `csv-export.db.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a), OrgAccessError }));
const loadContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reimbursement/access", () => ({ loadReimbursementContext: (...a: unknown[]) => loadContext(...a) }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mockAuth }));
const exportRequests = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reimbursement/csv-export", () => ({ exportRequests: (...a: unknown[]) => exportRequests(...a) }));

import { GET } from "./route";

const OK_ORG = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" as const, name: "Alder", slug: "alder-creek" },
};
const ROW = {
  id: "11111111-1111-4111-8111-111111111111", status: "paid", kind: "reimburse", submittedOn: "2026-10-02", expenseDate: "2026-09-30",
  groupName: "Property Committee", categoryName: "Supplies", payeeName: "=Imogen", purpose: "Paint", amountCents: 12_550,
  approvedOn: "2026-10-03", approvalPath: "seat", paidOn: "2026-10-05", paymentMethod: "check", paymentReference: "1042",
  creatorName: "Imogen", approverName: "Tobias", payerName: "Marguerite", selfPaid: false,
};
const get = (query = "") =>
  GET(new Request(`https://example.invalid/o/alder-creek/admin/reimbursements/export${query}`), { params: Promise.resolve({ slug: "alder-creek" }) });
const has = (over: Record<string, boolean> = {}) => ({ requestForOthers: false, view: true, pay: false, manage: false, ...over });

function allowed() {
  mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: true } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  loadContext.mockResolvedValue({ kind: "ok", has: has() });
}

afterEach(() => {
  mockAuth.mockReset();
  resolveOrgContext.mockReset();
  loadContext.mockReset();
  exportRequests.mockReset();
});

describe("the gate, in order, with its response shapes", () => {
  it("signed out: 307 to /signin keeping this URL as the callback; nothing is resolved", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get("?status=paid");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://example.invalid/signin?callbackUrl=" + encodeURIComponent("/o/alder-creek/admin/reimbursements/export?status=paid"),
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("2FA required and unverified: 307 to /totp - before any org read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    const res = await get();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/totp?callbackUrl=");
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(exportRequests).not.toHaveBeenCalled();
  });

  it("no such organization: 404; no relationship or an ended one: 403 with ONE body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    expect((await get()).status).toBe(404);
    const bodies = new Set<string>();
    for (const kind of ["forbidden", "ended"]) {
      resolveOrgContext.mockResolvedValue({ kind });
      const res = await get();
      expect(res.status).toBe(403);
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("toggle off or not applicable: 404 (a route has no honest page); no key or only pay/manage/requestForOthers: 403; and no query either way", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    for (const ctx of [{ kind: "toggle_off", canManageFeatures: true }, { kind: "not_applicable" }]) {
      loadContext.mockResolvedValue(ctx);
      expect((await get()).status).toBe(404);
    }
    for (const h of [has({ view: false }), has({ view: false, pay: true, manage: true, requestForOthers: true })]) {
      loadContext.mockResolvedValue({ kind: "ok", has: h });
      expect((await get()).status).toBe(403);
    }
    expect(exportRequests).not.toHaveBeenCalled();
  });

  it("a database failure reading the gate is 503, never a 403 that reads as revoked", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadContext.mockRejectedValue(new Error("connection reset"));
    expect((await get()).status).toBe(503);
    loadContext.mockRejectedValue(new OrgAccessError("gone"));
    expect((await get()).status).toBe(403);
  });
});

describe("the export", () => {
  it("answers text/csv, as an attachment, never cached, with the header row and a formula-safe cell", async () => {
    allowed();
    exportRequests.mockResolvedValue({ kind: "ok", rows: [ROW] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="reimbursements-alder-creek-\d{4}-\d{2}-\d{2}\.csv"$/);
    const body = await res.text();
    const lines = body.split("\r\n");
    expect(lines[0]).toBe(
      "request_id,status,kind,submitted_on,expense_date,charged_to,category,payee,purpose,amount,approved_on,approval_path,paid_on,payment_method,payment_reference,requested_by,approved_by,paid_by,self_paid",
    );
    expect(lines[1]).toContain(",'=Imogen,");
    expect(lines[1]).toContain(",125.50,");
    expect(body.endsWith("\r\n")).toBe(true);
  });

  it("passes the actor from the gate (never the query) and ONLY the filters it can parse", async () => {
    allowed();
    exportRequests.mockResolvedValue({ kind: "ok", rows: [] });
    await get("?from=2026-01-01&to=2026-12-31&status=paid&organizationId=org-evil&actor=x&limit=9");
    const [actor, filters] = exportRequests.mock.calls[0]!;
    expect(actor).toMatchObject({ userId: "user-1", personId: "person-1", organizationId: "org-1" });
    expect(filters).toEqual({ from: "2026-01-01", to: "2026-12-31", status: "paid" });
    await get("?from=nonsense&status=draft");
    expect(exportRequests.mock.calls[1]![1]).toEqual({});
  });

  it("over the cap: 413 with the Copy sentence and no file", async () => {
    allowed();
    exportRequests.mockResolvedValue({ kind: "too_many" });
    const res = await get();
    expect(res.status).toBe(413);
    expect(await res.text()).toBe("Narrow the date range: that export is more than 20,000 requests.");
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("an identity refusal from the database is a 403; a database failure propagates (a 500), never an empty file", async () => {
    allowed();
    exportRequests.mockResolvedValue({ kind: "denied" });
    expect((await get()).status).toBe(403);
    exportRequests.mockRejectedValue(new Error("audit insert failed"));
    await expect(get()).rejects.toThrow("audit insert failed");
  });

  it("writes no audit row itself - the audit is inside exportRequests, in the read's transaction", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/recordAudit|insertAuditRow|auditReimbursement/);
  });
});
