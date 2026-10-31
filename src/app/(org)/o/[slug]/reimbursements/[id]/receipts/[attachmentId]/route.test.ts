/**
 * `GET /o/<slug>/reimbursements/<id>/receipts/<attachmentId>` (docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 API Contract Layer 4; Copy C4; EC24). The route's own
 * properties with the gate's collaborators and the receipt library mocked: the gate's
 * order and response shapes, ONE 404 for every kind of miss, the bytes asked for by
 * the organization the GATE resolved and the key the DATABASE returned, and the
 * response headers (nosniff, no-store, the sandbox CSP, image inline and PDF as a
 * download under a server-chosen name).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mockAuth }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a), OrgAccessError }));
const loadContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reimbursement/access", () => ({ loadReimbursementContext: (...a: unknown[]) => loadContext(...a) }));
const receipts = vi.hoisted(() => ({ lookupReceipt: vi.fn(), readReceiptBytes: vi.fn() }));
vi.mock("@/lib/reimbursement/receipts", () => receipts);

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const ATT = "55555555-5555-4555-8555-555555555555";
const BLOB = "77777777-7777-4777-8777-777777777777";
const OK_ORG = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" as const, name: "Alder Creek Church", slug: "alder-creek" },
};
const has = { requestForOthers: false, view: false, pay: false, manage: false };
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const get = (id = ID, attachmentId = ATT) =>
  GET(new Request(`https://example.invalid/o/alder-creek/reimbursements/${id}/receipts/${attachmentId}`), {
    params: Promise.resolve({ slug: "alder-creek", id, attachmentId }),
  });

function allowed() {
  mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: false } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  loadContext.mockResolvedValue({ kind: "ok", has });
}

function served(contentType: "image/jpeg" | "application/pdf" = "image/jpeg", bytes: Buffer = JPEG_BYTES) {
  receipts.lookupReceipt.mockResolvedValue({ kind: "ok", blobKey: BLOB, contentType, displayName: "Kitchen.jpg" });
  receipts.readReceiptBytes.mockResolvedValue({ bytes, contentType });
}

afterEach(() => {
  for (const mock of [mockAuth, resolveOrgContext, loadContext, ...Object.values(receipts)]) mock.mockReset();
});

describe("the gate, in order, with its response shapes", () => {
  it("signed out: 307 to /signin keeping this URL as the callback; nothing is resolved or read", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `https://example.invalid/signin?callbackUrl=${encodeURIComponent(`/o/alder-creek/reimbursements/${ID}/receipts/${ATT}`)}`,
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(receipts.lookupReceipt).not.toHaveBeenCalled();
  });

  it("2FA required and unverified: 307 to /totp before any org read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    const res = await get();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/totp?callbackUrl=");
    expect(resolveOrgContext).not.toHaveBeenCalled();
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
    expect(receipts.lookupReceipt).not.toHaveBeenCalled();
  });

  it("toggle off or not applicable: 404, and nothing is looked up", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    for (const ctx of [{ kind: "toggle_off", canManageFeatures: true }, { kind: "not_applicable" }]) {
      loadContext.mockResolvedValue(ctx);
      expect((await get()).status).toBe(404);
    }
    expect(receipts.lookupReceipt).not.toHaveBeenCalled();
  });

  it("holds no key requirement: a plain member (no money key) may open a receipt the database lets them see", async () => {
    allowed();
    served();
    expect((await get()).status).toBe(200);
  });

  it("a failure to read is 503 (the gate, the lookup or the bytes), never a 404 that reads as gone; a lost membership is 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadContext.mockRejectedValue(new Error("connection reset"));
    expect((await get()).status).toBe(503);
    allowed();
    receipts.lookupReceipt.mockRejectedValue(new Error("connection reset"));
    expect((await get()).status).toBe(503);
    served();
    receipts.readReceiptBytes.mockRejectedValue(new Error("connection reset"));
    expect((await get()).status).toBe(503);
    receipts.lookupReceipt.mockRejectedValue(new OrgAccessError("gone"));
    expect((await get()).status).toBe(403);
  });
});

describe("every miss is ONE 404", () => {
  it("a missing or forbidden or detached receipt, a gone blob and malformed ids answer the same status, body and headers", async () => {
    allowed();
    const seen: Array<[number, string, string | null, string | null]> = [];
    const record = async (res: Response) =>
      seen.push([res.status, await res.text(), res.headers.get("cache-control"), res.headers.get("content-type")]);

    receipts.lookupReceipt.mockResolvedValue({ kind: "not_found" });
    await record(await get());
    receipts.lookupReceipt.mockResolvedValue({ kind: "ok", blobKey: BLOB, contentType: "image/jpeg", displayName: "x.jpg" });
    receipts.readReceiptBytes.mockResolvedValue(null);
    await record(await get());
    await record(await get("not-a-uuid"));
    await record(await get(ID, "not-a-uuid"));
    await record(await get("../../etc/passwd", ATT));

    expect(new Set(seen.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(seen[0]).toEqual([404, "Not found", "no-store", "text/plain; charset=utf-8"]);
  });

  it("a malformed id never reaches the database", async () => {
    allowed();
    await get("nope");
    await get(ID, "nope");
    expect(receipts.lookupReceipt).not.toHaveBeenCalled();
    expect(receipts.readReceiptBytes).not.toHaveBeenCalled();
  });

  it("the bytes are not read when the lookup misses", async () => {
    allowed();
    receipts.lookupReceipt.mockResolvedValue({ kind: "not_found" });
    await get();
    expect(receipts.readReceiptBytes).not.toHaveBeenCalled();
  });
});

describe("what is asked of the library", () => {
  it("looks up as the gate's identity for the path's ids, then reads from the GATE's organization with the key the database returned", async () => {
    allowed();
    served();
    await get();
    const [actor, ask] = receipts.lookupReceipt.mock.calls[0]!;
    expect(actor).toMatchObject({ userId: "user-1", personId: "person-1", organizationId: "org-1" });
    expect(ask).toEqual({ requestId: ID, attachmentId: ATT });
    expect(receipts.readReceiptBytes).toHaveBeenCalledWith("org-1", BLOB);
  });
});

describe("the response", () => {
  it("an image is shown inline, uncacheable, unsniffable, under a sandbox CSP that loads nothing, with a name chosen here", async () => {
    allowed();
    served("image/jpeg");
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="receipt-55555555.jpg"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(JPEG_BYTES)).toBe(true);
    expect(res.headers.get("content-length")).toBe(String(body.byteLength));
  });

  it("a PDF is always a download, never shown inline", async () => {
    allowed();
    const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");
    served("application/pdf", pdf);
    const res = await get();
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="receipt-55555555.pdf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(Buffer.from(await res.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it("the file name comes from the attachment id, never from the uploaded name", async () => {
    allowed();
    receipts.lookupReceipt.mockResolvedValue({ kind: "ok", blobKey: BLOB, contentType: "image/jpeg", displayName: '"; filename="evil.html' });
    receipts.readReceiptBytes.mockResolvedValue({ bytes: JPEG_BYTES, contentType: "image/jpeg" });
    const res = await get();
    expect(res.headers.get("content-disposition")).not.toContain("evil");
  });
});
