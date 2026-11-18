/**
 * The six export routes, one table-driven file (docs/work-log/2026-11-15-
 * presbytery-reports.md, Phase 3 Test Plan). The REAL gate runs (session, org
 * resolver and flag mocked); the six `export*` readers are mocked so this file
 * pins what each route does with what they return: the status, the headers, the
 * BOM, the filename, the 400/409/503 bodies and that a refused organization-level
 * gate wins over a bad year. The readers' own behaviour is `readers.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  FakeOrgAccessError: class FakeOrgAccessError extends Error {},
  auth: vi.fn(),
  resolveOrgContext: vi.fn(),
  assertOrgAccess: vi.fn(),
  isFlagEnabled: vi.fn(),
  exportVacantPulpits: vi.fn(),
  exportMembershipTrend: vi.fn(),
  exportViability: vi.fn(),
  exportPerCapita: vi.fn(),
  exportBuildingsReport: vi.fn(),
  exportInsuranceLoans: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  OrgAccessError: mocks.FakeOrgAccessError,
  resolveOrgContext: mocks.resolveOrgContext,
  assertOrgAccess: mocks.assertOrgAccess,
}));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: mocks.isFlagEnabled }));
vi.mock("./vacant-pulpits", () => ({ exportVacantPulpits: mocks.exportVacantPulpits }));
vi.mock("./membership-trend", () => ({ exportMembershipTrend: mocks.exportMembershipTrend }));
vi.mock("./viability", () => ({ exportViability: mocks.exportViability }));
vi.mock("./per-capita", () => ({ exportPerCapita: mocks.exportPerCapita }));
vi.mock("./buildings", () => ({ exportBuildingsReport: mocks.exportBuildingsReport }));
vi.mock("./insurance-loans", () => ({ exportInsuranceLoans: mocks.exportInsuranceLoans }));

import { GET as vacantGET } from "@/app/(org)/o/[slug]/admin/reports/vacant-pulpits/export/route";
import { GET as trendGET } from "@/app/(org)/o/[slug]/admin/reports/membership-trend/export/route";
import { GET as viabilityGET } from "@/app/(org)/o/[slug]/admin/reports/viability/export/route";
import { GET as perCapitaGET } from "@/app/(org)/o/[slug]/admin/reports/per-capita/export/route";
import { GET as buildingsGET } from "@/app/(org)/o/[slug]/admin/reports/buildings/export/route";
import { GET as insuranceLoansGET } from "@/app/(org)/o/[slug]/admin/reports/insurance-and-loans/export/route";
import { ROUTE_COPY } from "./copy";

const ORG = { organizationId: "org-1", personId: "person-1", name: "Northern Reach", organizationType: "presbytery", slug: "northern" };
const signedIn = { user: { id: "user-1", email: "clerk@example.invalid" } };
const stale2fa = { user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } };

interface Case {
  name: string;
  segment: string;
  get: (r: Request, c: { params: Promise<{ slug: string }> }) => Promise<Response>;
  mock: ReturnType<typeof vi.fn>;
  base: string;
  query: string;
}
const CASES: Case[] = [
  { name: "vacant pulpits", segment: "vacant-pulpits", get: vacantGET, mock: mocks.exportVacantPulpits, base: "vacant-pulpits", query: "" },
  { name: "membership trend", segment: "membership-trend", get: trendGET, mock: mocks.exportMembershipTrend, base: "membership-trend", query: "?from=2022&to=2025" },
  { name: "viability", segment: "viability", get: viabilityGET, mock: mocks.exportViability, base: "viability", query: "" },
  { name: "per capita", segment: "per-capita", get: perCapitaGET, mock: mocks.exportPerCapita, base: "per-capita", query: "?billingYear=2025" },
  { name: "buildings", segment: "buildings", get: buildingsGET, mock: mocks.exportBuildingsReport, base: "buildings", query: "" },
  {
    name: "insurance and loans",
    segment: "insurance-and-loans",
    get: insuranceLoansGET,
    mock: mocks.exportInsuranceLoans,
    base: "insurance-and-loans",
    query: "",
  },
];

const call = (c: Case, query = c.query, slug = "northern") =>
  c.get(new Request(`https://app.example.invalid/o/${slug}/admin/reports/${c.segment}/export${query}`), {
    params: Promise.resolve({ slug }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(signedIn);
  mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
  mocks.assertOrgAccess.mockResolvedValue(undefined);
  mocks.isFlagEnabled.mockResolvedValue(true);
  for (const c of CASES) c.mock.mockResolvedValue({ kind: "ok", csv: "﻿header\r\nrow\r\n", rowCount: 1, filenameBase: c.base });
});

describe.each(CASES)("the $name export route", (c) => {
  it("signed out: 307 to /signin with its own path and query as the callback, never a supplied one", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await call(c, `${c.query}${c.query ? "&" : "?"}callbackUrl=https://evil.example&next=/x`);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/signin");
    const callback = location.searchParams.get("callbackUrl")!;
    expect(callback.startsWith(`/o/northern/admin/reports/${c.segment}/export`)).toBe(true);
    expect(location.origin).toBe("https://app.example.invalid");
    expect(c.mock).not.toHaveBeenCalled();
  });

  it("a required, unverified second factor: 307 to /totp with its own path as the callback", async () => {
    mocks.auth.mockResolvedValue(stale2fa);
    const res = await call(c);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/totp");
    expect(c.mock).not.toHaveBeenCalled();
  });

  it("no such organization: 404", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    const res = await call(c);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("no relationship, ended, flag off and wrong organization type are one identical 403 body", async () => {
    const bodies: string[] = [];
    const arrange: Array<() => void> = [
      () => mocks.resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "x", organizationType: "presbytery" }),
      () => mocks.resolveOrgContext.mockResolvedValue({ kind: "ended", name: "x", endedOn: "2026-01-01" }),
      () => {
        mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
        mocks.isFlagEnabled.mockResolvedValue(false);
      },
      () => {
        mocks.isFlagEnabled.mockResolvedValue(true);
        mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "synod" } });
      },
      // the key is missing: the reader says forbidden
      () => {
        mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
        c.mock.mockResolvedValue({ kind: "forbidden" });
      },
    ];
    for (const a of arrange) {
      a();
      const res = await call(c);
      expect(res.status).toBe(403);
      bodies.push(await res.text());
    }
    expect(new Set(bodies)).toEqual(new Set([ROUTE_COPY.forbidden]));
  });

  it("a failure reading the gate is 503; a throw from the export (including a failed audit insert) is 503 with no file", async () => {
    mocks.resolveOrgContext.mockRejectedValueOnce(new Error("db down"));
    const gateDown = await call(c);
    expect(gateDown.status).toBe(503);
    expect(await gateDown.text()).toBe(ROUTE_COPY.gateFailed);

    c.mock.mockRejectedValue(new Error("audit insert failed"));
    const exportDown = await call(c);
    expect(exportDown.status).toBe(503);
    expect(await exportDown.text()).toBe(ROUTE_COPY.exportFailed);
    expect(exportDown.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("200: csv, attachment named <base>-<slug>-<date>.csv, no-store, nosniff, and the BOM is the first three bytes", async () => {
    const res = await call(c);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="${c.base}-northern-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await res.arrayBuffer())).slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("passes the gate's identity to the export, never anything from the query", async () => {
    await call(c);
    expect(c.mock.mock.calls[0][0]).toMatchObject({ userId: "user-1", personId: "person-1", organizationId: "org-1" });
  });
});

describe("the two oversight exports take no query value (DECISION-348)", () => {
  it.each([CASES[4], CASES[5]])("$name ignores every parameter: the export is called with the gate's identity alone", async (c) => {
    const res = await call(c, "?year=2020&billingYear=abc&callbackUrl=https://evil.example&organizationId=other");
    expect(res.status).toBe(200);
    expect(c.mock.mock.calls[0]).toHaveLength(1);
    expect(c.mock.mock.calls[0][0]).toMatchObject({ organizationId: "org-1", personId: "person-1" });
  });
});

describe("the vacant pulpits export refuses an honest nothing", () => {
  it("409 with the contracted body", async () => {
    mocks.exportVacantPulpits.mockResolvedValue({ kind: "nothing_to_export" });
    const res = await call(CASES[0]);
    expect(res.status).toBe(409);
    expect(await res.text()).toBe("There is nothing to export yet. No pastoral appointments are recorded.");
  });
});

describe("year and window parameters are strict, and answered only after the organization-level gate", () => {
  const trend = CASES[1];
  const perCapita = CASES[3];

  it.each(["?from=", "?from=abc", "?to=2020.0", "?from=2022&to=2020", "?from=2010&to=2025", "?from=1899", "?from=2022&from=2023"])(
    "trend %s is 400 with the year message and no export",
    async (query) => {
      const res = await call(trend, query);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(ROUTE_COPY.invalidYear);
      expect(trend.mock).not.toHaveBeenCalled();
    },
  );

  it.each(["?billingYear=", "?billingYear=1e3", "?billingYear=2101", "?billingYear= 2025", "?billingYear=2025&billingYear=2026"])(
    "per capita %s is 400",
    async (query) => {
      const res = await call(perCapita, query);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(ROUTE_COPY.invalidYear);
      expect(perCapita.mock).not.toHaveBeenCalled();
    },
  );

  it.each(["?allYears=0", "?allYears=true", "?allYears=1&billingYear=2025", "?allYears="])("per capita %s is 400 with the link message", async (query) => {
    const res = await call(perCapita, query);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(ROUTE_COPY.invalidLink);
    expect(perCapita.mock).not.toHaveBeenCalled();
  });

  it("allYears=1 asks for the long form; no query asks for the current year", async () => {
    await call(perCapita, "?allYears=1");
    expect(perCapita.mock.mock.calls[0][1]).toEqual({ kind: "all" });
    await call(perCapita, "");
    expect(perCapita.mock.mock.calls[1][1]).toEqual({ kind: "year", billingYear: new Date().getUTCFullYear() });
  });

  it("an organization-level refusal wins over a bad year (a probe learns nothing from the 400)", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "x", organizationType: "presbytery" });
    expect((await call(trend, "?from=abc")).status).toBe(403);
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    expect((await call(perCapita, "?billingYear=abc")).status).toBe(404);
  });

  it("unknown parameters are ignored", async () => {
    const res = await call(trend, "?from=2022&to=2025&format=xlsx&callbackUrl=https://evil.example");
    expect(res.status).toBe(200);
    expect(trend.mock.mock.calls[0][1]).toEqual({ from: 2022, to: 2025 });
  });
});
