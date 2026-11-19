/**
 * gate.ts - the page skin and the route skin, with the session, the org resolver
 * and the flag mocked (docs/work-log/2026-11-15-presbytery-reports.md, Phase 3
 * "API Contract"). The order is the property under test: the Node-side
 * second-factor recheck runs before anything reads the organization; a route
 * answers one 403 body for every refusal after the 404; and a database blip is
 * a 503 or a load error, never an "off" or "not allowed".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  FakeOrgAccessError: class FakeOrgAccessError extends Error {},
  auth: vi.fn(),
  cachedAuth: vi.fn(),
  resolveOrgContext: vi.fn(),
  assertOrgAccess: vi.fn(),
  isFlagEnabled: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mocks.cachedAuth }));
vi.mock("@/lib/authz", () => ({
  OrgAccessError: mocks.FakeOrgAccessError,
  resolveOrgContext: mocks.resolveOrgContext,
  assertOrgAccess: mocks.assertOrgAccess,
}));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: mocks.isFlagEnabled }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import {
  csvResponse,
  respondWithExport,
  gateCommitteesPage,
  gateInsightsPage,
  gateOversightPage,
  gateReportPage,
  gateReportRoute,
  runReportRead,
} from "./gate";
import { ROUTE_COPY } from "./copy";

const ORG = {
  organizationId: "org-1",
  personId: "person-1",
  name: "Northern Reach",
  organizationType: "presbytery",
  slug: "northern",
  platformStatus: "managed",
};
const signedIn = { user: { id: "user-1", email: "clerk@example.invalid" } };
const stale2fa = { user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } };
const PATH = "/o/northern/admin/reports/per-capita?billingYear=2025";
const req = (path = PATH) => new Request(`https://app.example.invalid${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(signedIn);
  mocks.cachedAuth.mockResolvedValue(signedIn);
  mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
  mocks.assertOrgAccess.mockResolvedValue(undefined);
  mocks.isFlagEnabled.mockResolvedValue(true);
});

describe("gateReportPage", () => {
  it("passes a signed-in presbytery member with the flag on, naming who passed", async () => {
    const gate = await gateReportPage({ slug: "northern", path: PATH });
    expect(gate).toMatchObject({
      ok: true,
      identity: { userId: "user-1", email: "clerk@example.invalid", personId: "person-1", organizationId: "org-1", slug: "northern" },
    });
    expect(mocks.isFlagEnabled).toHaveBeenCalledWith("org_portal.reports");
  });

  it("signed out redirects to /signin with the page's own path and query as the callback", async () => {
    mocks.cachedAuth.mockResolvedValue(null);
    await expect(gateReportPage({ slug: "northern", path: PATH })).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent(PATH)}`,
    );
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("a stale second-factor claim redirects to /totp BEFORE the organization is read", async () => {
    mocks.cachedAuth.mockResolvedValue(stale2fa);
    await expect(gateReportPage({ slug: "northern", path: PATH })).rejects.toThrow(
      `REDIRECT:/totp?callbackUrl=${encodeURIComponent(PATH)}`,
    );
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
    expect(mocks.isFlagEnabled).not.toHaveBeenCalled();
  });

  it("no such organization is a 404", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(gateReportPage({ slug: "nope", path: PATH })).rejects.toThrow("NOT_FOUND");
  });

  it("no relationship and an ended relationship are states, not data", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Northern Reach", organizationType: "presbytery" });
    expect(await gateReportPage({ slug: "northern", path: PATH })).toEqual({
      ok: false,
      state: { kind: "org_forbidden", name: "Northern Reach", organizationType: "presbytery" },
    });
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Northern Reach", endedOn: "2026-03-31" });
    expect(await gateReportPage({ slug: "northern", path: PATH })).toEqual({
      ok: false,
      state: { kind: "org_ended", name: "Northern Reach", endedOn: "2026-03-31" },
    });
  });

  it("flag off and a non-presbytery are states; the flag is checked before the type", async () => {
    mocks.isFlagEnabled.mockResolvedValue(false);
    expect(await gateReportPage({ slug: "northern", path: PATH })).toEqual({ ok: false, state: { kind: "flag_off", name: "Northern Reach" } });
    mocks.isFlagEnabled.mockResolvedValue(true);
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    expect(await gateReportPage({ slug: "northern", path: PATH })).toEqual({ ok: false, state: { kind: "not_applicable", name: "Northern Reach" } });
  });

  it("an OrgAccessError (membership ended mid-request) is rethrown to the error boundary", async () => {
    mocks.assertOrgAccess.mockRejectedValue(new mocks.FakeOrgAccessError("ended"));
    await expect(gateReportPage({ slug: "northern", path: PATH })).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);
  });
});

describe("gateInsightsPage (DECISION-342)", () => {
  const INSIGHTS_PATH = "/o/northern/admin/insights";

  it("gateInsightsPage checks org_portal.insights and never org_portal.reports", async () => {
    const gate = await gateInsightsPage({ slug: "northern", path: INSIGHTS_PATH });
    expect(gate.ok).toBe(true);
    expect(mocks.isFlagEnabled).toHaveBeenCalledWith("org_portal.insights");
    expect(mocks.isFlagEnabled).not.toHaveBeenCalledWith("org_portal.reports");
  });

  it("gateReportPage checks org_portal.reports and never org_portal.insights", async () => {
    await gateReportPage({ slug: "northern", path: PATH });
    expect(mocks.isFlagEnabled).toHaveBeenCalledWith("org_portal.reports");
    expect(mocks.isFlagEnabled).not.toHaveBeenCalledWith("org_portal.insights");
  });

  it("gateInsightsPage: flag off is flag_off, even with the reports flag on", async () => {
    mocks.isFlagEnabled.mockImplementation(async (key: string) => key !== "org_portal.insights");
    expect(await gateInsightsPage({ slug: "northern", path: INSIGHTS_PATH })).toEqual({
      ok: false,
      state: { kind: "flag_off", name: "Northern Reach" },
    });
  });

  it("gateInsightsPage: a congregation with the flag on is not_applicable", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    expect(await gateInsightsPage({ slug: "northern", path: INSIGHTS_PATH })).toEqual({
      ok: false,
      state: { kind: "not_applicable", name: "Northern Reach" },
    });
  });

  it("a stale second factor redirects to /totp with the page's own path, for any organization type", async () => {
    mocks.cachedAuth.mockResolvedValue(stale2fa);
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    await expect(gateInsightsPage({ slug: "northern", path: INSIGHTS_PATH })).rejects.toThrow(
      `REDIRECT:/totp?callbackUrl=${encodeURIComponent(INSIGHTS_PATH)}`,
    );
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("signed out redirects to /signin with the dashboard's own path", async () => {
    mocks.cachedAuth.mockResolvedValue(null);
    await expect(gateInsightsPage({ slug: "northern", path: INSIGHTS_PATH })).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent(INSIGHTS_PATH)}`,
    );
  });

  it("an OrgAccessError is rethrown to the error boundary", async () => {
    mocks.assertOrgAccess.mockRejectedValue(new mocks.FakeOrgAccessError("ended"));
    await expect(gateInsightsPage({ slug: "northern", path: INSIGHTS_PATH })).rejects.toBeInstanceOf(
      mocks.FakeOrgAccessError,
    );
  });
});

describe("gateOversightPage (DECISION-347, F452)", () => {
  const OVERSIGHT_PATH = "/o/northern/admin/oversight/00000000-0000-4000-8000-000000000001";

  /** Records the order the gate's collaborators run in. */
  function trackOrder() {
    const order: string[] = [];
    mocks.cachedAuth.mockImplementation(async () => (order.push("session"), signedIn));
    mocks.resolveOrgContext.mockImplementation(async () => (order.push("resolve"), { kind: "ok", org: ORG }));
    mocks.assertOrgAccess.mockImplementation(async () => void order.push("access"));
    mocks.isFlagEnabled.mockImplementation(async () => (order.push("flag"), true));
    return order;
  }

  it("runs signed-in, then the Node-side second-factor check, then the org miss, access, the flag, the type, in that order", async () => {
    const order = trackOrder();
    const gate = await gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH });
    expect(gate).toMatchObject({ ok: true, identity: { organizationId: "org-1", personId: "person-1", slug: "northern" } });
    expect(order).toEqual(["session", "resolve", "access", "flag"]);
  });

  it("checks org_portal.oversight and never the reports or insights flag", async () => {
    await gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH });
    expect(mocks.isFlagEnabled).toHaveBeenCalledWith("org_portal.oversight");
    expect(mocks.isFlagEnabled).not.toHaveBeenCalledWith("org_portal.reports");
    expect(mocks.isFlagEnabled).not.toHaveBeenCalledWith("org_portal.insights");
  });

  it("signed out redirects to /signin with the page's own path", async () => {
    mocks.cachedAuth.mockResolvedValue(null);
    await expect(gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH })).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent(OVERSIGHT_PATH)}`,
    );
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("a stale second-factor claim redirects to /totp BEFORE the organization is read (the F452 recheck)", async () => {
    mocks.cachedAuth.mockResolvedValue(stale2fa);
    await expect(gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH })).rejects.toThrow(
      `REDIRECT:/totp?callbackUrl=${encodeURIComponent(OVERSIGHT_PATH)}`,
    );
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
    expect(mocks.isFlagEnabled).not.toHaveBeenCalled();
  });

  it("the four-way org miss: not found is a 404, no relationship and ended are states", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(gateOversightPage({ slug: "nope", path: OVERSIGHT_PATH })).rejects.toThrow("NOT_FOUND");
    mocks.resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Northern Reach", organizationType: "presbytery" });
    expect(await gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH })).toEqual({
      ok: false,
      state: { kind: "org_forbidden", name: "Northern Reach", organizationType: "presbytery" },
    });
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Northern Reach", endedOn: "2026-03-31" });
    expect(await gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH })).toEqual({
      ok: false,
      state: { kind: "org_ended", name: "Northern Reach", endedOn: "2026-03-31" },
    });
  });

  it("flag off is flag_off (and the flag is checked before the type)", async () => {
    mocks.isFlagEnabled.mockResolvedValue(false);
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    expect(await gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH })).toEqual({
      ok: false,
      state: { kind: "flag_off", name: "Northern Reach" },
    });
  });

  it("a congregation with the flag on is not_applicable", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    expect(await gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH })).toEqual({
      ok: false,
      state: { kind: "not_applicable", name: "Northern Reach" },
    });
  });

  it("an OrgAccessError is rethrown to the error boundary", async () => {
    mocks.assertOrgAccess.mockRejectedValue(new mocks.FakeOrgAccessError("ended"));
    await expect(gateOversightPage({ slug: "northern", path: OVERSIGHT_PATH })).rejects.toBeInstanceOf(
      mocks.FakeOrgAccessError,
    );
  });
});

describe("runReportRead", () => {
  it("returns ok and forbidden as the reader gave them", async () => {
    expect(await runReportRead(async () => ({ kind: "ok", data: 1 }))).toEqual({ kind: "ok", data: 1 });
    expect(await runReportRead(async () => ({ kind: "forbidden" }))).toEqual({ kind: "forbidden" });
  });
  it("turns a thrown failure into error, but rethrows an OrgAccessError", async () => {
    expect(await runReportRead(async () => { throw new Error("db down"); })).toEqual({ kind: "error" });
    await expect(runReportRead(async () => { throw new mocks.FakeOrgAccessError("ended"); })).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);
  });
});

describe("gateReportRoute", () => {
  const run = () => gateReportRoute({ request: req(), slug: "northern" });
  const refused = async () => {
    const result = await run();
    if (result.ok) throw new Error("expected a refusal");
    return result.response;
  };

  it("passes a signed-in presbytery member", async () => {
    expect(await run()).toMatchObject({ ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1" });
  });

  it("signed out: 307 to /signin carrying the request's own path and query, and no other target", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await refused();
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe(
      `/signin?callbackUrl=${encodeURIComponent(PATH)}`,
    );
  });

  it("a hostile callbackUrl or next parameter on the request is never read", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await gateReportRoute({
      request: req("/o/northern/admin/reports/per-capita/export?callbackUrl=https://evil.example&next=https://evil.example"),
      slug: "northern",
    });
    if (result.ok) throw new Error("expected a refusal");
    const location = decodeURIComponent(result.response.headers.get("location")!);
    expect(location).toContain("callbackUrl=/o/northern/admin/reports/per-capita/export?callbackUrl=https://evil.example");
    expect(new URL(result.response.headers.get("location")!).origin).toBe("https://app.example.invalid");
  });

  it("a stale second-factor claim: 307 to /totp with the own path, before the organization is read", async () => {
    mocks.auth.mockResolvedValue(stale2fa);
    const res = await refused();
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/totp");
    expect(decodeURIComponent(new URL(res.headers.get("location")!).searchParams.get("callbackUrl")!)).toBe(PATH);
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("no such organization is 404; every other refusal is the SAME 403 body", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    const notFound = await refused();
    expect(notFound.status).toBe(404);
    expect(await notFound.text()).toBe("Not found");

    const bodies: string[] = [];
    const cases: Array<() => void> = [
      () => mocks.resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "x", organizationType: "presbytery" }),
      () => mocks.resolveOrgContext.mockResolvedValue({ kind: "ended", name: "x", endedOn: "2026-01-01" }),
      () => {
        mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
        mocks.assertOrgAccess.mockRejectedValue(new mocks.FakeOrgAccessError("ended"));
      },
      () => {
        mocks.assertOrgAccess.mockResolvedValue(undefined);
        mocks.isFlagEnabled.mockResolvedValue(false);
      },
      () => {
        mocks.isFlagEnabled.mockResolvedValue(true);
        mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
      },
    ];
    for (const arrange of cases) {
      arrange();
      const res = await refused();
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
      bodies.push(await res.text());
    }
    expect(new Set(bodies)).toEqual(new Set([ROUTE_COPY.forbidden]));
    expect(bodies).toHaveLength(5);
  });

  it("a failure reading the gate is a 503 and never an off or not-allowed answer", async () => {
    mocks.resolveOrgContext.mockRejectedValue(new Error("db down"));
    const res = await refused();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(ROUTE_COPY.gateFailed);
  });
});

describe("respondWithExport and csvResponse", () => {
  it("maps forbidden to 403 and nothing_to_export to 409", async () => {
    const forbidden = respondWithExport({ kind: "forbidden" }, "northern");
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).toBe(ROUTE_COPY.forbidden);
    const nothing = respondWithExport({ kind: "nothing_to_export" }, "northern");
    expect(nothing.status).toBe(409);
    expect(await nothing.text()).toBe(ROUTE_COPY.nothingToExport);
    expect(nothing.headers.get("cache-control")).toBe("no-store");
  });

  it("the file: csv content type, attachment with <base>-<slug>-<date>.csv, no-store, nosniff", async () => {
    const res = csvResponse({ csv: "﻿a\r\n", filenameBase: "per-capita-all-years", slug: "northern", now: new Date("2026-11-15T23:59:59Z") });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="per-capita-all-years-northern-2026-11-15.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await res.arrayBuffer())).slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("gateCommitteesPage (DECISION-359, U7)", () => {
  const COMMITTEES_PATH = "/o/northern/admin/committees/00000000-0000-4000-8000-000000000002";

  function trackOrder() {
    const order: string[] = [];
    mocks.cachedAuth.mockImplementation(async () => (order.push("session"), signedIn));
    mocks.resolveOrgContext.mockImplementation(async () => (order.push("resolve"), { kind: "ok", org: ORG }));
    mocks.assertOrgAccess.mockImplementation(async () => void order.push("access"));
    mocks.isFlagEnabled.mockImplementation(async () => (order.push("flag"), true));
    return order;
  }

  it("runs signed-in, the Node-side second-factor check, the org miss, access, the flag, then the type, in that order", async () => {
    const order = trackOrder();
    const gate = await gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH });
    expect(gate).toMatchObject({ ok: true, identity: { organizationId: "org-1", personId: "person-1", slug: "northern" } });
    expect(order).toEqual(["session", "resolve", "access", "flag"]);
  });

  it("checks org_portal.committees and no other flag (never org_portal.groups)", async () => {
    await gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH });
    expect(mocks.isFlagEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.isFlagEnabled).toHaveBeenCalledWith("org_portal.committees");
  });

  it("signed out redirects to /signin with the page's own path", async () => {
    mocks.cachedAuth.mockResolvedValue(null);
    await expect(gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH })).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent(COMMITTEES_PATH)}`,
    );
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
  });

  it("a stale second-factor claim redirects to /totp BEFORE the organization is read", async () => {
    mocks.cachedAuth.mockResolvedValue(stale2fa);
    await expect(gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH })).rejects.toThrow(
      `REDIRECT:/totp?callbackUrl=${encodeURIComponent(COMMITTEES_PATH)}`,
    );
    expect(mocks.resolveOrgContext).not.toHaveBeenCalled();
    expect(mocks.isFlagEnabled).not.toHaveBeenCalled();
  });

  it("the four-way org miss: not found is a 404; no relationship and ended are states", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(gateCommitteesPage({ slug: "nope", path: COMMITTEES_PATH })).rejects.toThrow("NOT_FOUND");
    mocks.resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Northern Reach", organizationType: "presbytery" });
    expect(await gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH })).toEqual({
      ok: false,
      state: { kind: "org_forbidden", name: "Northern Reach", organizationType: "presbytery" },
    });
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Northern Reach", endedOn: "2026-03-31" });
    expect(await gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH })).toEqual({
      ok: false,
      state: { kind: "org_ended", name: "Northern Reach", endedOn: "2026-03-31" },
    });
  });

  it("flag off is flag_off, and the flag is checked before the organization type", async () => {
    mocks.isFlagEnabled.mockResolvedValue(false);
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    expect(await gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH })).toEqual({
      ok: false,
      state: { kind: "flag_off", name: "Northern Reach" },
    });
  });

  it("a congregation with the flag on is not_applicable", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    expect(await gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH })).toEqual({
      ok: false,
      state: { kind: "not_applicable", name: "Northern Reach" },
    });
  });

  it("an OrgAccessError (membership ended mid-request) is rethrown to the error boundary", async () => {
    mocks.assertOrgAccess.mockRejectedValue(new mocks.FakeOrgAccessError("ended"));
    await expect(gateCommitteesPage({ slug: "northern", path: COMMITTEES_PATH })).rejects.toBeInstanceOf(
      mocks.FakeOrgAccessError,
    );
  });
});
