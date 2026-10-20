/**
 * The print-run route (docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "Statements (Batch 5)"): giving.view, a year, one PDF of every latest
 * statement rendered by the SAME pure renderer, audited inside the handler as a
 * bulk download (a year and a count - no names).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPdfPages } from "@/lib/testing/pdf-text";
import { sampleSnapshot } from "@/lib/giving/statements/fixtures";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a), OrgAccessError }));
const loadGivingContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/access", async () => {
  const pure = await import("@/lib/giving/access-pure");
  return { ...pure, loadGivingContext: (...a: unknown[]) => loadGivingContext(...a) };
});
const loadPrintRun = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/statements", () => ({ loadPrintRun: (...a: unknown[]) => loadPrintRun(...a) }));
const recordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { GIVING_STATEMENTS_BULK_DOWNLOADED: "tenant.giving_statements.bulk_downloaded" },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

import { GET } from "./route";

const OK_ORG = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" as const, name: "Alder", slug: "alder-creek" },
};
const get = (query = "?year=2027") =>
  GET(new Request(`https://example.invalid/o/alder-creek/admin/giving/statements/print${query}`), { params: Promise.resolve({ slug: "alder-creek" }) });

function allowed(has = { view: true, record: false, manage: false }) {
  mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: true } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  loadGivingContext.mockResolvedValue({ kind: "ok", has });
}

afterEach(() => {
  for (const fn of [mockAuth, resolveOrgContext, loadGivingContext, loadPrintRun]) fn.mockReset();
  recordAudit.mockClear();
});

describe("the gate", () => {
  it("signed out: 307 to /signin keeping the year; 2FA unverified: 307 to /totp", async () => {
    mockAuth.mockResolvedValue(null);
    const out = await get("?year=2027");
    expect(out.status).toBe(307);
    expect(out.headers.get("location")).toBe(
      "https://example.invalid/signin?callbackUrl=" + encodeURIComponent("/o/alder-creek/admin/giving/statements/print?year=2027"),
    );
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    const totp = await get();
    expect(totp.status).toBe(307);
    expect(totp.headers.get("location")).toContain("/totp?callbackUrl=");
    expect(loadPrintRun).not.toHaveBeenCalled();
  });

  it("no such organization 404, no relationship 403, manage-only (no view) 403, giving off 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    expect((await get()).status).toBe(404);
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder", organizationType: "congregation" });
    expect((await get()).status).toBe(403);
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: false, manage: true } });
    expect((await get()).status).toBe(403);
    loadGivingContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: true });
    expect((await get()).status).toBe(403);
    expect(loadPrintRun).not.toHaveBeenCalled();
  });
});

describe("the run", () => {
  it("needs a four-digit year", async () => {
    allowed();
    for (const q of ["", "?year=", "?year=27", "?year=2027x", "?year=abc"]) {
      expect((await get(q)).status, q).toBe(400);
    }
    expect(loadPrintRun).not.toHaveBeenCalled();
  });

  it("maps the library's answers: invalid year 400, nothing issued 404, over the cap 413, forbidden 403", async () => {
    allowed();
    loadPrintRun.mockResolvedValueOnce({ kind: "invalid_year" });
    expect((await get()).status).toBe(400);
    loadPrintRun.mockResolvedValueOnce({ kind: "empty" });
    expect((await get()).status).toBe(404);
    loadPrintRun.mockResolvedValueOnce({ kind: "too_many" });
    expect((await get()).status).toBe(413);
    loadPrintRun.mockResolvedValueOnce({ kind: "forbidden" });
    expect((await get()).status).toBe(403);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("renders every statement into ONE PDF - one statement per page - with the private PDF headers, and audits a count", async () => {
    allowed();
    const statements = [
      { id: "s1", snapshot: sampleSnapshot({ donorName: "Abe Aldous" }) },
      { id: "s2", snapshot: sampleSnapshot({ donorName: "Zed Zimmer" }) },
    ];
    loadPrintRun.mockResolvedValue({ kind: "ok", statements });
    const res = await get("?year=2027");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="statements-2027-alder-creek.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const pages = extractPdfPages(bytes);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.join(" ")).toContain("Abe Aldous");
    expect(pages[1]!.join(" ")).toContain("Zed Zimmer");
    expect(loadPrintRun).toHaveBeenCalledWith("person-1", "org-1", 2027);
  });

  it("audits the bulk download inside the handler: year and count, no names", async () => {
    allowed();
    loadPrintRun.mockResolvedValue({ kind: "ok", statements: [{ id: "s1", snapshot: sampleSnapshot({ donorName: "Abe Aldous" }) }] });
    await get("?year=2027");
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_statements.bulk_downloaded",
      resourceType: "giving_statements",
      resourceId: "org-1",
      metadata: { organizationId: "org-1", taxYear: 2027, count: 1 },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Abe Aldous");
  });
});
