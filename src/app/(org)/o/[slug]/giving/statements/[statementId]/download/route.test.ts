/**
 * The MEMBER statement download route (docs/work-log/2026-10-15-online-giving.md,
 * Batch 6). check:audit scans only actions.ts, so THIS test holds the
 * hand-audited properties: the gate order and its response shapes, that NO
 * giving key and NO 2FA are demanded, the PDF headers, the audit event written
 * inside the handler (only on success, ids only, marked `self`), and the
 * PARITY RULE - an absent, malformed, someone-else's or giving-off statement is
 * ONE 404: same status, same body, same headers, the same as "no such
 * organization".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a), OrgAccessError }));
const findMyStatementForDownload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/self", () => ({ findMyStatementForDownload: (...a: unknown[]) => findMyStatementForDownload(...a) }));
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
const STATEMENT = { id: SID, taxYear: 2027, version: 2, blobAssetId: "blob-1" };
const PDF = Buffer.from("%PDF-1.3 fixture bytes");
const url = (statementId: string) => `https://example.invalid/o/alder-creek/giving/statements/${statementId}/download`;
const get = (statementId = SID) => GET(new Request(url(statementId)), { params: Promise.resolve({ slug: "alder-creek", statementId }) });
const headersOf = (r: Response) => [...r.headers.entries()].sort();

function signedIn(session: Record<string, unknown> = {}) {
  mockAuth.mockResolvedValue({ user: { id: "user-1", ...session } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
}

afterEach(() => {
  for (const fn of [mockAuth, resolveOrgContext, findMyStatementForDownload, resolveBlob]) fn.mockReset();
  recordAudit.mockClear();
});

describe("the gate, in order, with its response shapes", () => {
  it("signed out: 307 to /signin keeping this URL; nothing is resolved", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://example.invalid/signin?callbackUrl=" + encodeURIComponent(`/o/alder-creek/giving/statements/${SID}/download`),
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(findMyStatementForDownload).not.toHaveBeenCalled();
  });

  it("demands NO giving key and forces NO 2FA: a 'required but unverified' member with no key is served", async () => {
    signedIn({ twoFactorRequired: true, twoFactorVerified: false });
    findMyStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue({ bytes: PDF });
    const res = await get();
    expect(res.status).toBe(200);
  });

  it("no such organization: 404; no relationship or an ended one: 403 with ONE body; neither reaches the lookup", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    expect((await get()).status).toBe(404);
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder", organizationType: "congregation" });
    const denied = await get();
    resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Alder", endedOn: "2026-01-01" });
    const ended = await get();
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe(await ended.text());
    expect(findMyStatementForDownload).not.toHaveBeenCalled();
  });

  it("a membership that ended mid-request is the same 403", async () => {
    signedIn();
    findMyStatementForDownload.mockRejectedValue(new OrgAccessError("ended"));
    const res = await get();
    expect(res.status).toBe(403);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a database failure is a 503, never a 404 that would read as 'not yours'", async () => {
    signedIn();
    findMyStatementForDownload.mockRejectedValue(new Error("reset"));
    expect((await get()).status).toBe(503);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("the lookup is the viewer's own, with no target parameter", () => {
  it("is called with the server-resolved person and organization and the id from the URL - nothing from the request body or query", async () => {
    signedIn();
    findMyStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue({ bytes: PDF });
    await GET(new Request(`${url(SID)}?personId=someone-else&donorId=d2`), { params: Promise.resolve({ slug: "alder-creek", statementId: SID }) });
    expect(findMyStatementForDownload).toHaveBeenCalledTimes(1);
    expect(findMyStatementForDownload).toHaveBeenCalledWith("person-1", "org-1", SID);
  });
});

describe("the 404 parity", () => {
  it("absent, malformed, someone else's and giving-off statements answer the SAME 404, and that is the same as 'no such organization'", async () => {
    signedIn();
    findMyStatementForDownload.mockResolvedValue({ kind: "not_found" });
    const a = await get("00000000-0000-4000-8000-0000000000ee");
    const b = await get("../../etc/passwd");
    const c = await get(SID);
    for (const r of [a, b, c]) expect(r.status).toBe(404);
    const aText = await a.text();
    expect(aText).toBe("Not found");
    expect([await b.text(), await c.text()]).toEqual([aText, aText]);
    expect(headersOf(b)).toEqual(headersOf(a));
    expect(headersOf(c)).toEqual(headersOf(a));

    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    const noOrg = await get();
    expect(noOrg.status).toBe(404);
    expect(await noOrg.text()).toBe("Not found");
    expect(headersOf(noOrg)).toEqual(headersOf(a));
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a blob that has gone missing is the same 404 and is not audited", async () => {
    signedIn();
    findMyStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("is the SAME shape the treasurer's routes give: one definition in pdf-response, imported by both", async () => {
    signedIn();
    findMyStatementForDownload.mockResolvedValue({ kind: "not_found" });
    const { notFound } = await import("@/lib/giving/pdf-response");
    const member = await get();
    expect(await member.text()).toBe(await notFound().text());
    expect(headersOf(member)).toEqual(headersOf(notFound()));
    // the admin gate re-exports the very same functions; neither route defines its own
    const { readFileSync } = await import("node:fs");
    const gate = readFileSync("src/app/(org)/o/[slug]/admin/giving/statements/route-gate.ts", "utf8");
    expect(gate).toMatch(/from "@\/lib\/giving\/pdf-response"/);
    expect(gate).not.toMatch(/export function (plain|notFound|pdfHeaders)/);
    const route = readFileSync(__dirname + "/route.ts", "utf8");
    expect(route).toMatch(/from "@\/lib\/giving\/pdf-response"/);
    expect(route).not.toMatch(/from "[^"]*route-gate"/);
  });
});

describe("a served statement", () => {
  it("streams the stored bytes as a private, uncacheable, non-sniffable attachment", async () => {
    signedIn();
    findMyStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue({ bytes: PDF });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="statement-2027-v2-${SID.slice(0, 8)}.pdf"`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(PDF.byteLength));
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    // read through the storage adapter, scoped to this organization
    expect(resolveBlob).toHaveBeenCalledWith({ organizationId: "org-1", key: "blob-1", audience: "private" });
  });

  it("is audited once inside the handler: ids and the year only, marked self - never a name, address or amount", async () => {
    signedIn();
    findMyStatementForDownload.mockResolvedValue({ kind: "ok", statement: STATEMENT });
    resolveBlob.mockResolvedValue({ bytes: PDF });
    await get();
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_statement.downloaded",
      resourceType: "giving_statement",
      resourceId: SID,
      metadata: { organizationId: "org-1", statementId: SID, taxYear: 2027, version: 2, self: true },
    });
  });
});
