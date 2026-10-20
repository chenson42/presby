// @vitest-environment jsdom
/**
 * `/o/<slug>/giving/give` - the member give page (docs/work-log/2026-10-15-online-
 * giving.md, Phase 3 "Member give"). Pins the `(org)` auth pattern in order, that NO
 * giving permission is needed, the honest not-applicable / toggle-off / error
 * states, and the live / unavailable split.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_RATES } from "@/lib/giving/money";

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
const loadGivingToggle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/access", () => ({ loadGivingToggle: (...a: unknown[]) => loadGivingToggle(...a) }));
const readPublicGivingConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readPublicGivingConfig: (...a: unknown[]) => readPublicGivingConfig(...a) }));
vi.mock("./actions", () => ({ createMemberGiveSessionAction: Object.assign(vi.fn(), { bind: vi.fn(() => vi.fn()) }) }));
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

import MemberGivePage, { dynamic } from "./page";

const ORG = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek Presbyterian Church", organizationType: "congregation" as const, slug: "alder-creek" },
};
const LIVE = {
  state: "live" as const,
  organizationName: "Alder Creek Presbyterian Church",
  livemode: true,
  contactPhone: null,
  funds: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "General Fund" }],
  cardEnabled: true,
  achEnabled: true,
  rates: DEFAULT_RATES,
  minAmountCents: 100,
  maxAmountCents: 2_500_000,
};
const params = Promise.resolve({ slug: "alder-creek" });

function arrange() {
  cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
  resolveOrgContext.mockResolvedValue(ORG);
  loadGivingToggle.mockResolvedValue("on");
  readPublicGivingConfig.mockResolvedValue(LIVE);
}

afterEach(() => {
  cleanup();
  for (const fn of [cachedAuth, resolveOrgContext, assertOrgAccess, loadGivingToggle, readPublicGivingConfig, redirectMock]) fn.mockReset();
  redirectMock.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("MemberGivePage", () => {
  it("is dynamic (a fresh single-attempt key per request)", () => expect(dynamic).toBe("force-dynamic"));

  it("a signed-out visitor is sent to sign in and keeps the deep link", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(MemberGivePage({ params })).rejects.toThrow("REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fgiving%2Fgive");
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("the four-way miss: a slug that is nothing is a 404, before any giving read", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(MemberGivePage({ params })).rejects.toThrow("NOT_FOUND");
    expect(loadGivingToggle).not.toHaveBeenCalled();
    expect(readPublicGivingConfig).not.toHaveBeenCalled();
  });

  it("a non-member gets the access-denied state naming the organization, before any giving read", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder Creek Presbyterian Church", organizationType: "congregation" });
    render(await MemberGivePage({ params }));
    expect(screen.getByText(/Alder Creek Presbyterian Church/)).toBeTruthy();
    expect(loadGivingToggle).not.toHaveBeenCalled();
  });

  it("an ended membership gets the ended state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Alder Creek Presbyterian Church", endedOn: "2026-01-31" });
    render(await MemberGivePage({ params }));
    expect(loadGivingToggle).not.toHaveBeenCalled();
  });

  it("renders the form for a plain member - the page checks the toggle, never a giving key", async () => {
    arrange();
    render(await MemberGivePage({ params }));
    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
    expect(loadGivingToggle).toHaveBeenCalledWith({ personId: "person-1", organizationId: "org-1", organizationType: "congregation" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Give to Alder Creek Presbyterian Church");
    expect(screen.getByTestId("give-form")).toBeTruthy();
    // a member is authenticated: no Turnstile frame or script on this page
    expect(document.querySelector("iframe, script")).toBeNull();
  });

  it("toggle off is an honest state at 200, with no Features link for a plain member", async () => {
    arrange();
    loadGivingToggle.mockResolvedValue("toggle_off");
    render(await MemberGivePage({ params }));
    expect(screen.getByText(/Giving isn.t turned on for Alder Creek/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Go to Features" })).toBeNull();
    expect(readPublicGivingConfig).not.toHaveBeenCalled();
  });

  it("an organization type giving does not apply to says so", async () => {
    arrange();
    loadGivingToggle.mockResolvedValue("not_applicable");
    render(await MemberGivePage({ params }));
    expect(screen.getByText(/Giving isn.t available for Alder Creek/)).toBeTruthy();
  });

  it("a database failure reading the toggle is a load error, never an empty or 'off' answer", async () => {
    arrange();
    loadGivingToggle.mockRejectedValue(new Error("db down"));
    render(await MemberGivePage({ params }));
    expect(screen.getByText(/can.t load Giving right now/)).toBeTruthy();
  });

  it("a membership that ended mid-request is rethrown to the segment's error boundary", async () => {
    arrange();
    loadGivingToggle.mockRejectedValue(new OrgAccessError("membership ended"));
    await expect(MemberGivePage({ params })).rejects.toBeInstanceOf(OrgAccessError);
  });

  it.each([
    ["unavailable", { state: "unavailable", organizationName: "x", contactPhone: "614-555-0123" }],
    ["absent", { state: "absent" }],
  ])("giving on but config %s: the unavailable notice with the member's own organization name, no form", async (_label, config) => {
    arrange();
    readPublicGivingConfig.mockResolvedValue(config);
    const { container } = render(await MemberGivePage({ params }));
    expect(screen.getByTestId("giving-unavailable")).toBeTruthy();
    expect(screen.getByText(/Alder Creek Presbyterian Church isn.t taking online gifts/)).toBeTruthy();
    expect(container.querySelector("form")).toBeNull();
  });
});
