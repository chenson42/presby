// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/statements` (docs/work-log/2026-10-15-online-giving.md,
 * Batch 5b): the four designed states (the gate's, a load error, empty,
 * populated), the year picker's default (last calendar year), what a viewer
 * versus a manager is offered, and the blockers / issuing-disabled notices.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const gate = vi.fn();
vi.mock("../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const previewStatementRun = vi.fn();
const listStatements = vi.fn();
vi.mock("@/lib/giving/statements", () => ({
  previewStatementRun: (...a: unknown[]) => previewStatementRun(...a),
  listStatements: (...a: unknown[]) => listStatements(...a),
  STATEMENT_FILTERS: ["all", "stale", "not_delivered", "earlier"],
}));
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ refresh: vi.fn() }) }));
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
vi.mock("./actions", () => ({
  issueStatementBatchAction: vi.fn(),
  sendStatementNoticesAction: vi.fn(),
  reissueStatementAction: vi.fn(),
  recordDeliveryAction: vi.fn(),
}));

import GivingStatementsPage from "./page";

const org = { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" };
const manager = { ok: true, userId: "u1", org, has: { view: true, record: true, manage: true } };
const viewer = { ok: true, userId: "u1", org, has: { view: true, record: false, manage: false } };
const LAST_YEAR = new Date().getUTCFullYear() - 1;

const preview = (over: Record<string, unknown> = {}) => ({
  year: LAST_YEAR, eligibleDonors: 4, alreadyIssued: 1, toIssue: 3, excludedPending: 0, undeliverable: 0, undeliverableDonors: [],
  nonCash: 0, plateCashExcluded: 0, stale: 0, possibleDuplicates: 0, noticeCandidates: 0, blockers: [], issuingEnabled: true, ...over,
});
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, donorId: `d-${id}`, donorName: `Donor ${id}`, taxYear: LAST_YEAR, version: 1, issuedAt: "2028-01-15T14:03:09Z", cashTotalCents: 12_550,
  giftCount: 2, nonCashCount: 0, hasEmail: true, hasAddress: true, isLatest: true, isStale: false, printMailedAt: null, noticeSentAt: null, noticeBounced: false, ...over,
});
const props = (search: Record<string, string> = {}) => ({ params: Promise.resolve({ slug: "alder-creek" }), searchParams: Promise.resolve(search) });

function arrange(opts: { gateResult?: unknown; preview?: unknown; statements?: unknown[]; nextCursor?: string | null } = {}) {
  gate.mockResolvedValue(opts.gateResult ?? manager);
  previewStatementRun.mockResolvedValue({ kind: "ok", preview: opts.preview ?? preview() });
  listStatements.mockResolvedValue({ kind: "ok", statements: opts.statements ?? [row("s1")], nextCursor: opts.nextCursor ?? null });
}

afterEach(() => {
  cleanup();
  for (const fn of [gate, previewStatementRun, listStatements, redirect]) fn.mockReset();
  redirect.mockImplementation((to: string) => { throw new Error(`REDIRECT:${to}`); });
});

describe("the gate and the year", () => {
  it("opens to giving.view and returns the gate's own node (toggle-off, forbidden) untouched", async () => {
    gate.mockResolvedValue({ ok: false, node: <p>Giving isn&apos;t turned on</p> });
    render(await GivingStatementsPage(props()));
    expect(gate).toHaveBeenCalledWith(expect.objectContaining({ anyOf: ["view"], path: "/o/alder-creek/admin/giving/statements", section: "Statements" }));
    expect(screen.getByText(/isn.t turned on/)).toBeTruthy();
    expect(previewStatementRun).not.toHaveBeenCalled();
  });

  it("defaults the year picker to LAST calendar year and reads the URL's year, filter and cursor", async () => {
    arrange();
    render(await GivingStatementsPage(props()));
    expect(previewStatementRun).toHaveBeenCalledWith("p1", "o1", LAST_YEAR);
    expect(listStatements).toHaveBeenCalledWith("p1", "o1", { year: LAST_YEAR, filter: "all", cursor: undefined });
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(LAST_YEAR));

    arrange();
    await GivingStatementsPage(props({ year: String(LAST_YEAR - 1), filter: "stale", cursor: "abc" }));
    expect(listStatements).toHaveBeenLastCalledWith("p1", "o1", { year: LAST_YEAR - 1, filter: "stale", cursor: "abc" });
  });

  it("ignores a junk filter and year, and redirects a year the library refuses", async () => {
    arrange();
    await GivingStatementsPage(props({ year: "20x7", filter: "'; drop" }));
    expect(listStatements).toHaveBeenLastCalledWith("p1", "o1", { year: LAST_YEAR, filter: "all", cursor: undefined });
    gate.mockResolvedValue(manager);
    previewStatementRun.mockResolvedValue({ kind: "invalid_year" });
    listStatements.mockResolvedValue({ kind: "invalid_year" });
    await expect(GivingStatementsPage(props({ year: "2099" }))).rejects.toThrow("REDIRECT:/o/alder-creek/admin/giving/statements");
  });
});

describe("populated", () => {
  it("states the run in words and offers a manager the issue action, the print run and the list", async () => {
    arrange({ preview: preview({ noticeCandidates: 2 }) });
    render(await GivingStatementsPage(props()));
    expect(screen.getByTestId("run-counts").textContent).toMatch(/4 donors have gifts in .*1 already has a statement; 3 are still to issue/);
    expect(screen.getByRole("button", { name: "Issue 3 statements" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email a notice (2)" })).toBeTruthy();
    expect(screen.getByTestId("print-run-link").getAttribute("href")).toBe(`/o/alder-creek/admin/giving/statements/print?year=${LAST_YEAR}`);
    expect(screen.getAllByTestId("statement-row")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /download pdf/i }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/statements/s1/download");
  });

  it("a view-only holder sees the run and the list but no issue, notice or per-row action", async () => {
    arrange({ gateResult: viewer, preview: preview({ noticeCandidates: 2 }), statements: [row("s1", { isStale: true })] });
    render(await GivingStatementsPage(props()));
    expect(screen.queryByRole("button", { name: /issue/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /email a notice/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark as mailed/i })).toBeNull();
    expect(screen.getByText(/ask your treasurer to issue these/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /download pdf/i })).toBeTruthy();
  });

  it("badges are words: Corrected, Out of date, Replaced, Mailed, Notice emailed/bounced, No email or address", async () => {
    arrange({
      statements: [
        row("a", { version: 2, isStale: true }),
        row("b", { isLatest: false }),
        row("c", { printMailedAt: "2028-02-01T00:00:00Z", noticeSentAt: "2028-02-01T00:00:00Z" }),
        row("d", { noticeSentAt: "2028-02-01T00:00:00Z", noticeBounced: true }),
        row("e", { hasEmail: false, hasAddress: false }),
      ],
    });
    render(await GivingStatementsPage(props()));
    for (const word of ["Corrected", "Out of date", "Replaced by a newer version", "Mailed", "Notice emailed", "Notice bounced", "No email or address"]) {
      expect(screen.getAllByText(word).length, word).toBeGreaterThan(0);
    }
    // Only a stale latest statement offers the correction; only an unmailed one offers 'mark as mailed'.
    expect(screen.getAllByRole("button", { name: "Issue corrected statement" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Mark as mailed" }).length).toBeGreaterThan(0);
  });

  it("the filters are links that keep the year; a cursor becomes 'Show more'", async () => {
    arrange({ nextCursor: "next-token", preview: preview({ stale: 2 }) });
    render(await GivingStatementsPage(props({ filter: "stale" })));
    const nav = screen.getByRole("navigation", { name: "Filter statements" });
    expect(within(nav).getByRole("link", { name: "Out of date (2)" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Earlier versions" }).getAttribute("href")).toBe(`/o/alder-creek/admin/giving/statements?year=${LAST_YEAR}&filter=earlier`);
    expect(screen.getByRole("link", { name: "Show more" }).getAttribute("href")).toBe(`/o/alder-creek/admin/giving/statements?year=${LAST_YEAR}&filter=stale&cursor=next-token`);
  });
});

describe("notices the page must give", () => {
  it("blockers name what is missing and link a manager to the settings page; no issue button", async () => {
    arrange({ preview: preview({ blockers: ["donee_name", "donee_address"] }) });
    render(await GivingStatementsPage(props()));
    const box = screen.getByTestId("statement-blockers");
    expect(box.textContent).toMatch(/legal name of the church/);
    expect(box.textContent).toMatch(/mailing address/);
    expect(within(box).getByRole("link", { name: "Open statement details" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/settings");
    expect(screen.queryByRole("button", { name: /^issue \d/i })).toBeNull();
  });

  it("when issuing is switched off (production, Operator Q6) it says so and offers no issue button or correction", async () => {
    arrange({ preview: preview({ issuingEnabled: false }), statements: [row("s1", { isStale: true })] });
    render(await GivingStatementsPage(props()));
    expect(screen.getByTestId("issuing-disabled").textContent).toMatch(/switched off on this site/);
    expect(screen.queryByRole("button", { name: /^issue \d/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Issue corrected statement" })).toBeNull();
  });
});

describe("empty and error", () => {
  it("a year with no gifts to count says so and points to the gifts page", async () => {
    arrange({ preview: preview({ eligibleDonors: 0, alreadyIssued: 0, toIssue: 0 }), statements: [] });
    render(await GivingStatementsPage(props()));
    expect(screen.getByText(`No gifts to count for ${LAST_YEAR}`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to gifts" })).toBeTruthy();
    expect(screen.queryByTestId("print-run-link")).toBeNull();
  });

  it("no statements yet (unfiltered) and nothing in a filter are different sentences, each with a way forward", async () => {
    arrange({ statements: [] });
    render(await GivingStatementsPage(props()));
    expect(screen.getByTestId("statements-empty").textContent).toContain(`No ${LAST_YEAR} statements issued yet`);
    cleanup();
    arrange({ statements: [] });
    render(await GivingStatementsPage(props({ filter: "stale" })));
    expect(screen.getByTestId("statements-empty").textContent).toMatch(/Nothing in .Out of date. for/);
    expect(screen.getByTestId("statements-empty").textContent).toContain("Try another view above.");
  });

  it("a database failure is the load-error state, never an empty list", async () => {
    gate.mockResolvedValue(manager);
    previewStatementRun.mockRejectedValue(new Error("reset"));
    listStatements.mockResolvedValue({ kind: "ok", statements: [], nextCursor: null });
    render(await GivingStatementsPage(props()));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.queryByTestId("statements-empty")).toBeNull();
  });

  it("rethrows an OrgAccessError and treats a library 'forbidden' as a load error", async () => {
    gate.mockResolvedValue(manager);
    previewStatementRun.mockRejectedValue(new OrgAccessError("x"));
    listStatements.mockResolvedValue({ kind: "ok", statements: [], nextCursor: null });
    await expect(GivingStatementsPage(props())).rejects.toBeInstanceOf(OrgAccessError);
    previewStatementRun.mockResolvedValue({ kind: "forbidden" });
    render(await GivingStatementsPage(props()));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
  });
});

describe("exceptions", () => {
  it("lists each exception in a sentence with its one place to act, and names undeliverable donors as links", async () => {
    arrange({
      preview: preview({
        stale: 2, excludedPending: 3, undeliverable: 2, undeliverableDonors: [{ id: "d1", name: "Nowhere Noor" }, { id: "d2", name: "Gone Gil" }],
        possibleDuplicates: 1, nonCash: 1, plateCashExcluded: 4,
      }),
    });
    render(await GivingStatementsPage(props()));
    const panel = screen.getByTestId("exceptions-panel");
    expect(within(panel).getByTestId("exception-stale").textContent).toMatch(/2 statements are out of date/);
    expect(within(panel).getByTestId("exception-pending").textContent).toMatch(/3 gifts are still pending/);
    expect(within(panel).getByTestId("exception-undeliverable").textContent).toMatch(/2 donors have no email and no mailing address/);
    expect(within(panel).getByRole("link", { name: "Nowhere Noor" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/donors/d1");
    expect(within(panel).getByTestId("exception-duplicates").textContent).toMatch(/1 possible duplicate donor/);
    expect(within(panel).getByTestId("exception-noncash").textContent).toMatch(/1 non-cash gift/);
    expect(within(panel).getByTestId("exception-plate").textContent).toMatch(/4 cash gifts were recorded without a donor/);
  });

  it("says plainly when nothing needs a look", async () => {
    arrange();
    render(await GivingStatementsPage(props()));
    expect(screen.getByTestId("exceptions-panel").textContent).toContain(`Nothing needs attention for ${LAST_YEAR}.`);
  });
});
