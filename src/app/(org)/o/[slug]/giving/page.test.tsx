// @vitest-environment jsdom
/**
 * `/o/<slug>/giving` - the member's own giving page (docs/work-log/2026-10-15-
 * online-giving.md, Batch 6; Flow 12). Pins the `(org)` auth pattern in order,
 * that NO giving permission and NO 2FA force applies, the designed states
 * (not-applicable, toggle-off, a load error that is NOT an empty list, empty
 * sections, populated), the "Give online" entry, and the statements disclosure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const cachedAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const assertOrgAccess = vi.hoisted(() => vi.fn());
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a),
  assertOrgAccess: (...a: unknown[]) => assertOrgAccess(...a),
  OrgAccessError,
}));
const getMyGiving = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/self", () => ({ getMyGiving: (...a: unknown[]) => getMyGiving(...a) }));
const readPublicGivingConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readPublicGivingConfig: (...a: unknown[]) => readPublicGivingConfig(...a) }));
const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import MemberGivingPage from "./page";

const ORG = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek Presbyterian Church", organizationType: "congregation" as const, slug: "alder-creek" },
};
const LIVE = { state: "live" as const, organizationName: "Alder Creek Presbyterian Church", livemode: true, contactPhone: null, funds: [], cardEnabled: true, achEnabled: true, rates: {}, minAmountCents: 100, maxAmountCents: 2_500_000 };
const params = Promise.resolve({ slug: "alder-creek" });
const SID = "11111111-1111-4111-8111-111111111111";

const gift = (over: Record<string, unknown> = {}) => ({ id: "g1", occurredOn: "2027-03-03", fundName: "General Fund", amountCents: 5000, status: "succeeded", reversedCents: 0, ...over });
const statement = (over: Record<string, unknown> = {}) => ({ id: SID, taxYear: 2026, version: 1, issuedAt: "2027-01-12T15:00:00Z", superseded: false, mergedSource: false, ...over });
const ok = (over: Record<string, unknown> = {}) => ({ kind: "ok", gifts: [], giftsTruncated: false, statements: [], ...over });

function arrange(result: unknown = ok()) {
  cachedAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
  resolveOrgContext.mockResolvedValue(ORG);
  getMyGiving.mockResolvedValue(result);
  readPublicGivingConfig.mockResolvedValue(LIVE);
}

afterEach(() => {
  cleanup();
  for (const fn of [cachedAuth, resolveOrgContext, assertOrgAccess, getMyGiving, readPublicGivingConfig, redirectMock]) fn.mockReset();
  redirectMock.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("the (org) auth pattern", () => {
  it("a signed-out visitor is sent to sign in and keeps the deep link; nothing else is read", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(MemberGivingPage({ params })).rejects.toThrow("REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fgiving");
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(getMyGiving).not.toHaveBeenCalled();
  });

  it("a slug that is nothing is a 404 before any giving read", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(MemberGivingPage({ params })).rejects.toThrow("NOT_FOUND");
    expect(getMyGiving).not.toHaveBeenCalled();
  });

  it("a non-member gets the denied state naming the organization; an ended membership its own state; neither reads giving", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder Creek Presbyterian Church", organizationType: "congregation" });
    render(await MemberGivingPage({ params }));
    expect(screen.getByText(/Alder Creek Presbyterian Church/)).toBeTruthy();
    cleanup();
    resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Alder Creek Presbyterian Church", endedOn: "2026-01-31" });
    render(await MemberGivingPage({ params }));
    expect(getMyGiving).not.toHaveBeenCalled();
  });

  it("needs NO giving key and forces NO 2FA: a session that is 'required but unverified' is not redirected here", async () => {
    arrange();
    render(await MemberGivingPage({ params }));
    expect(redirectMock).not.toHaveBeenCalled();
    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
    // the only data read is the viewer's own, by the server-resolved person id and no other argument
    expect(getMyGiving).toHaveBeenCalledWith("person-1", "org-1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Giving");
  });

  it("a membership that ended mid-request is rethrown to the segment's error boundary", async () => {
    arrange();
    getMyGiving.mockRejectedValue(new OrgAccessError("ended"));
    await expect(MemberGivingPage({ params })).rejects.toBeInstanceOf(OrgAccessError);
  });
});

describe("the designed states", () => {
  it("toggle off is an honest page at 200 with no Features link and no data reads beyond the gate", async () => {
    arrange({ kind: "toggle_off" });
    render(await MemberGivingPage({ params }));
    expect(screen.getByText(/Giving isn.t turned on for Alder Creek/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Go to Features" })).toBeNull();
    expect(screen.queryByTestId("give-online")).toBeNull();
    expect(readPublicGivingConfig).not.toHaveBeenCalled();
  });

  it("an organization type giving does not apply to says so", async () => {
    arrange({ kind: "not_applicable" });
    render(await MemberGivingPage({ params }));
    expect(screen.getByText(/Giving isn.t available for Alder Creek/)).toBeTruthy();
  });

  it("a database failure is 'We can't load your giving history right now' - NOT an empty list, and it offers a retry", async () => {
    arrange();
    getMyGiving.mockRejectedValue(new Error("db down"));
    render(await MemberGivingPage({ params }));
    expect(screen.getByText("We can't load your giving history right now.")).toBeTruthy();
    expect(screen.queryByTestId("gifts-empty")).toBeNull();
    expect(screen.queryByText(/No gifts are linked to you yet/)).toBeNull();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/alder-creek/giving");
  });

  it("empty: both sections say what normally appears and why it is empty", async () => {
    arrange();
    render(await MemberGivingPage({ params }));
    expect(within(screen.getByTestId("gifts-empty")).getByText("No gifts are linked to you yet")).toBeTruthy();
    expect(screen.getByTestId("gifts-empty").textContent).toContain("Gifts you give while signed in, or that your church office links to you, will appear here.");
    expect(within(screen.getByTestId("statements-empty")).getByText("No statements yet")).toBeTruthy();
  });

  it("populated: gifts with date, fund, amount and words for the state; statements to download", async () => {
    arrange(
      ok({
        gifts: [
          gift({ id: "g1", amountCents: 7500, reversedCents: 2000 }),
          gift({ id: "g2", status: "pending", amountCents: 2500 }),
          gift({ id: "g3", amountCents: 1000, reversedCents: 1000 }),
          gift({ id: "g4", status: "failed", amountCents: 1200 }),
          gift({ id: "g5" }),
        ],
        statements: [statement()],
      }),
    );
    render(await MemberGivingPage({ params }));
    const rows = screen.getAllByTestId("gift-row");
    expect(rows).toHaveLength(5);
    expect(rows[0]!.textContent).toContain("$75.00");
    expect(rows[0]!.textContent).toContain("Partly refunded or reversed");
    expect(rows[0]!.textContent).toContain("$20.00 returned");
    expect(rows[1]!.textContent).toContain("Processing");
    expect(rows[2]!.textContent).toContain("Refunded or reversed");
    expect(rows[3]!.textContent).toContain("Didn't go through");
    expect(rows[4]!.textContent).toContain("Received");
    expect(screen.getByText(/not on a year-end statement until it completes/)).toBeTruthy();
    const link = within(screen.getByTestId("statement-row")).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/o/alder-creek/giving/statements/${SID}/download`);
    expect(screen.getByTestId("statement-row").textContent).toContain("2026 giving statement");
    expect(screen.queryByTestId("statements-empty")).toBeNull();
  });

  it("says plainly when only the newest gifts are shown", async () => {
    arrange(ok({ gifts: [gift()], giftsTruncated: true }));
    render(await MemberGivingPage({ params }));
    expect(screen.getByTestId("gifts-truncated").textContent).toMatch(/Showing your 1 most recent gifts/);
  });
});

describe("statements: newest first, previous versions under a disclosure, never silently hidden", () => {
  const V1 = "22222222-2222-4222-8222-222222222222";
  const SRC = "33333333-3333-4333-8333-333333333333";

  it("a corrected statement is current; the version it replaced and a merge-source statement sit under 'Earlier versions (2)'", async () => {
    arrange(
      ok({
        statements: [
          statement({ id: SID, taxYear: 2026, version: 2 }),
          statement({ id: V1, taxYear: 2026, version: 1, superseded: true }),
          statement({ id: SRC, taxYear: 2026, version: 1, mergedSource: true }),
        ],
      }),
    );
    render(await MemberGivingPage({ params }));
    const current = screen.getByTestId("statements-list");
    expect(within(current).getAllByTestId("statement-row")).toHaveLength(1);
    expect(current.textContent).toContain("Corrected statement");
    expect(current.textContent).toContain("version 2");

    const previous = screen.getByTestId("statements-previous");
    expect(previous.tagName).toBe("DETAILS");
    expect(previous.textContent).toContain("Earlier versions (2)");
    // the summary carries no display utility (iOS <details> bug)
    expect(previous.querySelector("summary")!.className).not.toMatch(/(^|\s)(flex|grid|block|inline-flex)(\s|$)/);
    const hrefs = within(screen.getByTestId("statements-previous-list")).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([`/o/alder-creek/giving/statements/${V1}/download`, `/o/alder-creek/giving/statements/${SRC}/download`]);
    expect(previous.textContent).toContain("Replaced by a newer version");
    expect(previous.textContent).toContain("Issued before your records were combined");
  });

  it("a merge-source statement is current when the root has no statement for that year (operator ruling, 2026-10-19)", async () => {
    arrange(
      ok({
        statements: [
          statement({ id: SID, taxYear: 2026, version: 1 }),
          statement({ id: SRC, taxYear: 2025, version: 1, mergedSource: true }),
          statement({ id: V1, taxYear: 2024, version: 1, mergedSource: true, superseded: true }),
        ],
      }),
    );
    render(await MemberGivingPage({ params }));
    const hrefs = within(screen.getByTestId("statements-list")).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([`/o/alder-creek/giving/statements/${SID}/download`, `/o/alder-creek/giving/statements/${SRC}/download`]);
    expect(screen.getByTestId("statements-list").textContent).toContain("Issued before your records were combined");
    // a superseded merge-source statement is still an earlier version
    const previous = within(screen.getByTestId("statements-previous-list")).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(previous).toEqual([`/o/alder-creek/giving/statements/${V1}/download`]);
  });

  it("with no earlier versions there is no disclosure", async () => {
    arrange(ok({ statements: [statement()] }));
    render(await MemberGivingPage({ params }));
    expect(screen.queryByTestId("statements-previous")).toBeNull();
  });

  it("never shows the treasurer's 'out of date' flag", async () => {
    arrange(ok({ statements: [statement({ stale: true })] }));
    const { container } = render(await MemberGivingPage({ params }));
    expect(container.textContent).not.toMatch(/out of date/i);
  });
});

describe("the Give online entry", () => {
  it("live: a button to the give page", async () => {
    arrange();
    render(await MemberGivingPage({ params }));
    const entry = screen.getByTestId("give-online");
    expect(within(entry).getByRole("link", { name: "Give online" }).getAttribute("href")).toBe("/o/alder-creek/giving/give");
  });

  it("live in Stripe test mode: the practice-only badge shows", async () => {
    arrange();
    readPublicGivingConfig.mockResolvedValue({ ...LIVE, livemode: false });
    render(await MemberGivingPage({ params }));
    expect(screen.getByTestId("giving-test-mode-badge")).toBeTruthy();
  });

  it.each([
    ["unavailable", { state: "unavailable", organizationName: "x", contactPhone: "614-555-0123" }],
    ["absent", { state: "absent" }],
  ])("not live (%s): the unavailable notice, no Give button", async (_label, config) => {
    arrange();
    readPublicGivingConfig.mockResolvedValue(config);
    render(await MemberGivingPage({ params }));
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Give online" })).toBeNull();
    // the history is still shown: giving being unavailable never hides what the member already gave
    expect(screen.getByTestId("gifts-empty")).toBeTruthy();
  });
});
