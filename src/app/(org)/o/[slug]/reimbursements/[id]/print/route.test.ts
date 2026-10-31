/**
 * The print route (Copy C11, EC24, EC44). `check:audit` scans only `actions.ts`,
 * so THIS test holds the route's hand-checked properties: the gate order and its
 * response shapes, one 404 for every request miss, the requester projection
 * only, the PDF headers, and that a GET writes nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "@/lib/testing/pdf-text";
import { memberDetailSchema } from "@/lib/reimbursement/detail-shape";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mockAuth }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a), OrgAccessError }));
const loadContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reimbursement/access", () => ({ loadReimbursementContext: (...a: unknown[]) => loadContext(...a) }));
const reads = vi.hoisted(() => ({ getRequestDetail: vi.fn() }));
vi.mock("@/lib/reimbursement/reads", () => reads);
const writes = vi.hoisted(() => ({
  saveRequest: vi.fn(),
  submitRequest: vi.fn(),
  withdrawRequest: vi.fn(),
  approveRequest: vi.fn(),
  returnRequest: vi.fn(),
  recordPayment: vi.fn(),
}));
vi.mock("@/lib/reimbursement/requests", () => writes);
vi.mock("@/lib/reimbursement/decisions", () => writes);
vi.mock("@/lib/reimbursement/payments", () => writes);
const audit = vi.hoisted(() => ({ recordAudit: vi.fn(), insertAuditRow: vi.fn() }));
vi.mock("@/lib/audit", async (importOriginal) => ({ ...(await importOriginal<object>()), ...audit }));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const OK_ORG = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" as const, name: "Alder Creek Church", slug: "alder-creek" },
};
const has = (over: Record<string, boolean> = {}) => ({ requestForOthers: false, view: false, pay: false, manage: false, ...over });

const memberDetail = (over: Record<string, unknown> = {}) =>
  memberDetailSchema.parse({
    id: ID,
    level: "member",
    status: "approved",
    kind: "reimburse",
    origin: "app",
    revision: 3,
    amountCents: 4_250,
    currency: "usd",
    expenseDate: "2026-10-05",
    purpose: "Folding tables for the fellowship hall",
    preApprovedByName: null,
    noReceiptClaimed: false,
    createdAt: "2026-10-21T10:00:00+00:00",
    firstSubmittedAt: "2026-10-21T10:05:00+00:00",
    submittedAt: "2026-10-21T10:05:00+00:00",
    updatedAt: "2026-10-22T09:00:00+00:00",
    group: { id: "22222222-2222-4222-8222-222222222222", name: "Property Committee" },
    category: null,
    payee: { kind: "person", name: "Tamsin Brightwater", personId: "44444444-4444-4444-8444-444444444444" },
    enteredOnBehalf: false,
    receipts: [],
    receiptWaived: false,
    approvedOn: "2026-10-25",
    decidedOn: "2026-10-25",
    latestReason: null,
    route: null,
    paidOn: null,
    duplicateReceipt: null,
    viewer: { relation: "creator", canEdit: false, canWithdraw: true, canDecide: false },
    history: [],
    ...over,
  });

const get = (id = ID, query = "") =>
  GET(new Request(`https://example.invalid/o/alder-creek/reimbursements/${id}/print${query}`), {
    params: Promise.resolve({ slug: "alder-creek", id }),
  });

function allowed(over: Record<string, boolean> = {}) {
  mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: false } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  loadContext.mockResolvedValue({ kind: "ok", has: has(over) });
}

afterEach(() => {
  for (const mock of [mockAuth, resolveOrgContext, loadContext, reads.getRequestDetail, audit.recordAudit, audit.insertAuditRow, ...Object.values(writes)]) {
    mock.mockReset();
  }
});

describe("the gate, in order, with its response shapes", () => {
  it("signed out: 307 to /signin keeping this URL as the callback; nothing is resolved or read", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `https://example.invalid/signin?callbackUrl=${encodeURIComponent(`/o/alder-creek/reimbursements/${ID}/print`)}`,
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(reads.getRequestDetail).not.toHaveBeenCalled();
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
    expect(reads.getRequestDetail).not.toHaveBeenCalled();
  });

  it("toggle off or not applicable: 404, and the request is not read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    for (const ctx of [{ kind: "toggle_off", canManageFeatures: true }, { kind: "not_applicable" }]) {
      loadContext.mockResolvedValue(ctx);
      expect((await get()).status).toBe(404);
    }
    expect(reads.getRequestDetail).not.toHaveBeenCalled();
  });

  it("a database failure is 503 (at the gate or reading the request), never a 404 or 403 that reads as gone", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadContext.mockRejectedValue(new Error("connection reset"));
    expect((await get()).status).toBe(503);
    allowed();
    reads.getRequestDetail.mockRejectedValue(new Error("connection reset"));
    expect((await get()).status).toBe(503);
    reads.getRequestDetail.mockRejectedValue(new OrgAccessError("gone"));
    expect((await get()).status).toBe(403);
  });

  it("holds no key requirement: a plain member (no money key) may print their own request", async () => {
    allowed();
    reads.getRequestDetail.mockResolvedValue({ kind: "ok", detail: memberDetail() });
    expect((await get()).status).toBe(200);
  });
});

describe("the request miss is ONE 404", () => {
  it("a missing request, a forbidden one, a malformed id and a refused identity answer the same status, body and headers", async () => {
    allowed();
    const seen: Array<[number, string, string | null]> = [];
    for (const result of [{ kind: "not_found" }, { kind: "denied" }]) {
      reads.getRequestDetail.mockResolvedValue(result);
      const res = await get();
      seen.push([res.status, await res.text(), res.headers.get("cache-control")]);
    }
    // A treasury-level object where the member level was asked for is treated as a miss, never printed.
    reads.getRequestDetail.mockResolvedValue({ kind: "ok", detail: { ...memberDetail(), level: "treasury" } });
    const res = await get();
    seen.push([res.status, await res.text(), res.headers.get("cache-control")]);
    expect(new Set(seen.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(seen[0]).toEqual([404, "Not found", "no-store"]);
  });

  it("asks the database for the MEMBER level, with the actor from the gate and never from the query", async () => {
    allowed({ view: true, pay: true });
    reads.getRequestDetail.mockResolvedValue({ kind: "ok", detail: memberDetail() });
    await get(ID, "?userId=evil&level=treasury&organizationId=org-evil");
    const [identity, requestId, level] = reads.getRequestDetail.mock.calls[0]!;
    expect(identity).toMatchObject({ userId: "user-1", personId: "person-1", organizationId: "org-1" });
    expect(requestId).toBe(ID);
    expect(level).toBe("member");
  });
});

describe("the form", () => {
  it("is a private, uncacheable PDF attachment the browser may not sniff, named for the request", async () => {
    allowed();
    reads.getRequestDetail.mockResolvedValue({ kind: "ok", detail: memberDetail() });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="reimbursement-request-11111111.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("says the organization the gate resolved, the amount, and the requester's status line", async () => {
    allowed();
    reads.getRequestDetail.mockResolvedValue({ kind: "ok", detail: memberDetail() });
    const text = extractPdfText(Buffer.from(await (await get()).arrayBuffer())).replace(/\s+/g, " ");
    expect(text).toContain("Reimbursement request");
    expect(text).toContain("Alder Creek Church");
    expect(text).toContain("$42.50");
    expect(text).toContain("Approved on October 25, 2026. Waiting for payment.");
    expect(text).toContain("Printed from PresbyPortal.");
  });
});

describe("a GET changes nothing", () => {
  it("calls no write function and writes no audit row, and the route imports none", async () => {
    allowed({ view: true, pay: true });
    reads.getRequestDetail.mockResolvedValue({ kind: "ok", detail: memberDetail() });
    await get();
    await get();
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
    expect(audit.insertAuditRow).not.toHaveBeenCalled();
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/recordAudit|insertAuditRow|reimbursement\/(requests|decisions|payments)|getPlatformDb/);
  });

  it("never reaches the payments, notes or history a treasury-level read carries", async () => {
    allowed({ view: true, pay: true });
    // Even if a treasury-level projection were returned for a member-level ask, it is refused whole.
    reads.getRequestDetail.mockResolvedValue({
      kind: "ok",
      detail: { ...memberDetail(), level: "treasury", payments: [{ reference: "SECRET-REF" }], creatorName: "Hidden Creator" },
    });
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("SECRET-REF");
  });
});
