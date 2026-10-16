/**
 * The gifts CSV route (docs/work-log/2026-10-15-online-giving.md, Phase 3 "CSV
 * export", G25). check:audit scans only actions.ts, so THIS test is what holds
 * the hand-audited properties: the gate order and its response shapes, the
 * export's headers, and that the audit event is written inside the handler -
 * only on success, with the row count and filters and no donor name.
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
const exportGifts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/gifts", () => ({ exportGifts: (...a: unknown[]) => exportGifts(...a) }));
const recordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { GIVING_GIFTS_EXPORTED: "tenant.giving_gifts.exported" },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

import { GET } from "./route";

const OK_ORG = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" as const, name: "Alder", slug: "alder-creek" },
};
const FUND = "11111111-1111-4111-8111-111111111111";
const ROW = {
  giftId: "g1", occurredOn: "2026-03-14", donorId: "d1", donorName: "=Imogen", fundName: "General Fund", source: "offline",
  method: "check", status: "succeeded", amountCents: 12_550, donorCoveredFeeCents: 0, feeCents: null, netCents: null,
  reversedCents: 0, checkNumber: "1042",
};
const get = (query = "") =>
  GET(new Request(`https://example.invalid/o/alder-creek/admin/giving/gifts/export${query}`), { params: Promise.resolve({ slug: "alder-creek" }) });

function allowed() {
  mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: true } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  loadGivingContext.mockResolvedValue({ kind: "ok", has: { view: true, record: false, manage: false } });
}

afterEach(() => {
  mockAuth.mockReset();
  resolveOrgContext.mockReset();
  loadGivingContext.mockReset();
  exportGifts.mockReset();
  recordAudit.mockClear();
});

describe("the gate, in order, with its response shapes", () => {
  it("signed out: 307 to /signin keeping this URL as the callback; nothing is resolved", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get("?status=failed");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://example.invalid/signin?callbackUrl=" + encodeURIComponent("/o/alder-creek/admin/giving/gifts/export?status=failed"),
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("2FA required and unverified: 307 to /totp (the Node-side R4 check) - before any org read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    const res = await get();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/totp?callbackUrl=");
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(exportGifts).not.toHaveBeenCalled();
  });

  it("no such organization: 404; no relationship or an ended one: 403 with one body", async () => {
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
    expect(loadGivingContext).not.toHaveBeenCalled();
  });

  it("toggle off, not applicable, no key, or only record/manage: 403 and no query", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    for (const ctx of [
      { kind: "toggle_off", canManageFeatures: true },
      { kind: "not_applicable" },
      { kind: "forbidden" },
      { kind: "ok", has: { view: false, record: true, manage: true } },
    ]) {
      loadGivingContext.mockResolvedValue(ctx);
      expect((await get()).status).toBe(403);
    }
    expect(exportGifts).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a database failure reading the gate is 503, never a 403 that reads as revoked", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadGivingContext.mockRejectedValue(new Error("connection reset"));
    expect((await get()).status).toBe(503);
    loadGivingContext.mockRejectedValue(new OrgAccessError("gone"));
    expect((await get()).status).toBe(403);
  });
});

describe("the export", () => {
  it("answers text/csv, as an attachment, never cached, with the header row and a formula-safe cell", async () => {
    allowed();
    exportGifts.mockResolvedValue({ kind: "ok", rows: [ROW] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="gifts-alder-creek-\d{4}-\d{2}-\d{2}\.csv"$/);
    const body = await res.text();
    const [header, line] = body.split("\r\n");
    expect(header).toBe("gift_id,date,donor_id,donor_name,fund,source,method,status,amount,donor_covered_fee,stripe_fee,net,reversed,check_number");
    expect(line).toContain("'=Imogen"); // formula-injection prefix
    expect(body).not.toMatch(/@/);
  });

  it("passes the session's own person and org (never client ids) and the parsed URL filters to the query", async () => {
    allowed();
    exportGifts.mockResolvedValue({ kind: "ok", rows: [] });
    await get(`?from=2026-01-01&to=2026-12-31&fund=${FUND}&status=failed&source=online&organizationId=evil&bogus=1`);
    expect(exportGifts).toHaveBeenCalledWith("person-1", "org-1", {
      from: "2026-01-01", to: "2026-12-31", fundId: FUND, status: "failed", source: "online",
    });
  });

  it("over 50,000 rows: 413 'Narrow the date range', and NO audit row", async () => {
    allowed();
    exportGifts.mockResolvedValue({ kind: "too_many" });
    const res = await get();
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/Narrow the date range/);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("is AUDITED inside the handler, after the query, with the row count and filters - and no donor name", async () => {
    allowed();
    exportGifts.mockResolvedValue({ kind: "ok", rows: [ROW, { ...ROW, giftId: "g2" }] });
    await get(`?fund=${FUND}`);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_gifts.exported",
      resourceType: "giving_gifts",
      resourceId: "org-1",
      metadata: { organizationId: "org-1", rowCount: 2, filters: { fundId: FUND } },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Imogen");
  });

  it("a library 'forbidden' (key lost mid-request) is 403 with no audit", async () => {
    allowed();
    exportGifts.mockResolvedValue({ kind: "forbidden" });
    expect((await get()).status).toBe(403);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
