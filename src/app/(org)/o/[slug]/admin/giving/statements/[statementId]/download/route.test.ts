/**
 * The statement download route (docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Statements (Batch 5)"). check:audit scans only actions.ts, so THIS
 * test holds the hand-audited properties: the gate order and its response
 * shapes, the PDF headers, the audit event written inside the handler (only on
 * success, ids only), and that "absent", "malformed" and "someone else's"
 * statement are ONE 404 - same status, same body, same headers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
const findStatementForDownload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/statements", () => ({ findStatementForDownload: (...a: unknown[]) => findStatementForDownload(...a) }));
const resolveBlob = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/blob-store", () => ({ getBlobStore: () => ({ resolve: (...a: unknown[]) => resolveBlob(...a) }) }));
const recordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { GIVING_STATEMENT_DOWNLOADED: "tenant.giving_statement.downloaded" },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

import { GET } from "./route";

const OK_ORG = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" as const, name: "Alder", slug: "alder-creek" },
};
const SID = "11111111-1111-4111-8111-111111111111";
const STATEMENT = { id: SID, donorId: "donor-1", taxYear: 2027, version: 2, blobAssetId: "blob-1" };
const PDF = Buffer.from("%PDF-1.3 fixture bytes");
const get = (statementId = SID) =>
  GET(new Request(`https://example.invalid/o/alder-creek/admin/giving/statements/${statementId}/download`), {
    params: Promise.resolve({ slug: "alder-creek", statementId }),
  });

function allowed(has = { view: true, record: false, manage: false }) {
  mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: true } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  loadGivingContext.mockResolvedValue({ kind: "ok", has });
}

afterEach(() => {
  for (const fn of [mockAuth, resolveOrgContext, loadGivingContext, findStatementForDownload, resolveBlob]) fn.mockReset();
  recordAudit.mockClear();
});

describe("the gate, in order, with its response shapes", () => {
  it("signed out: 307 to /signin keeping this URL; nothing is resolved", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://example.invalid/signin?callbackUrl=" + encodeURIComponent(`/o/alder-creek/admin/giving/statements/${SID}/download`),
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("2FA required and unverified: 307 to /totp before any org read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    const res = await get();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/totp?callbackUrl=");
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(findStatementForDownload).not.toHaveBeenCalled();
  });

  it("no such organization: 404; no relationship or an ended one: 403 with one body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    expect((await get()).status).toBe(404);
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder", organizationType: "congregation" });
    const denied = await get();
    resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Alder", endedOn: "2026-01-01" });
    const ended = await get();
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe(await ended.text());
    expect(findStatementForDownload).not.toHaveBeenCalled();
  });

  it("giving off, or no giving key: 403 and no statement is read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockResolvedValue({ kind: "toggle_off", canManageFeatures: false });
    expect((await get()).status).toBe(403);
    loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: false, record: true, manage: false } });
    expect((await get()).status).toBe(403);
    expect(findStatementForDownload).not.toHaveBeenCalled();
  });

  it("a database failure reading the gate is a 503, never an empty answer", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockRejectedValue(new Error("reset"));
    expect((await get()).status).toBe(503);
  });
});

describe("the lookup and the 404 parity", () => {
  it("absent, malformed and foreign statements answer the SAME 404", async () => {
    allowed();
    findStatementForDownload.mockResolvedValue({ kind: "not_found" });
    const a = await get("00000000-0000-4000-8000-0000000000ee");
    const b = await get("../../etc/passwd");
    const c = await get(SID);
    for (const r of [a, b, c]) expect(r.status).toBe(404);
    const [aText, bText, cText] = [await a.text(), await b.text(), await c.text()];
    expect(aText).toBe("Not found");
    expect([bText, cText]).toEqual([aText, aText]);
    expect([...a.headers.entries()].sort()).toEqual([...b.headers.entries()].sort());
    expect([...b.headers.entries()].sort()).toEqual([...c.headers.entries()].sort());
    // ...and it is the same shape as "no such organization".
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    const noOrg = await get();
    expect(noOrg.status).toBe(404);
    expect(await noOrg.text()).toBe("Not found");
    expect([...noOrg.headers.entries()].sort()).toEqual([...a.headers.entries()].sort());
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a blob that has gone missing is the same 404 and is not audited", async () => {
    allowed();
    findStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a library 'forbidden' (key lost mid-request) is a 403", async () => {
    allowed();
    findStatementForDownload.mockResolvedValue({ kind: "forbidden" });
    expect((await get()).status).toBe(403);
  });
});

describe("the response", () => {
  it("streams the stored bytes as a private, uncacheable, un-sniffable attachment, reading the lookup in the verified org", async () => {
    allowed();
    findStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue({ bytes: PDF, contentType: "application/pdf" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="statement-2027-v2-11111111.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(PDF.length));
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect(findStatementForDownload).toHaveBeenCalledWith("person-1", "org-1", SID);
    expect(resolveBlob).toHaveBeenCalledWith({ organizationId: "org-1", key: "blob-1" });
  });

  it("view OR manage may download", async () => {
    findStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue({ bytes: PDF, contentType: "application/pdf" });
    allowed({ view: false, record: false, manage: true });
    expect((await get()).status).toBe(200);
  });

  it("audits the download inside the handler with ids and the year - no name, no amount", async () => {
    allowed();
    findStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue({ bytes: PDF, contentType: "application/pdf" });
    await get();
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_statement.downloaded",
      resourceType: "giving_statement",
      resourceId: SID,
      metadata: { organizationId: "org-1", statementId: SID, donorId: "donor-1", taxYear: 2027, version: 2 },
    });
  });
});
