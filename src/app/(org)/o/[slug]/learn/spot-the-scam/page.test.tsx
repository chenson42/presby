// @vitest-environment jsdom
/**
 * The (org) Spot the scam page, orchestration level (docs/work-log/2026-11-10-learn-inc1a.md,
 * Phase 3 T11; DECISION-334). The gate runs for real over a mocked session, authz and toggle read:
 * signed out -> sign-in with the SERVER-BUILT callback, the four-way org miss, off (manager and
 * non-manager), a database failure (the load error, never "off"), an `OrgAccessError` rethrown,
 * then the page with the practice and the leader panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const assertOrgAccess = vi.hoisted(() => vi.fn<(personId: string, organizationId: string) => Promise<void>>(async () => undefined));
vi.mock("@/lib/authz", () => {
  class OrgAccessError extends Error {}
  return { OrgAccessError, resolveOrgContext, assertOrgAccess };
});
const getLearnPageContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/learn/access", () => ({ getLearnPageContext: (...a: unknown[]) => getLearnPageContext(...a) }));
const readLeaderLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/learn/leader-link", () => ({ readLeaderLink: (...a: unknown[]) => readLeaderLink(...a) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { OrgAccessError } from "@/lib/authz";
import SpotTheScamPortalPage, { metadata } from "./page";

const OK_ORG = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek Church", organizationType: "congregation" as const, slug: "alder-creek", platformStatus: "managed" as const },
};
const LIVE = { kind: "live" as const, address: "presby.invalid/site/alder-creek/learn/spot-the-scam", href: "https://presby.invalid/site/alder-creek/learn/spot-the-scam" };

beforeEach(() => {
  for (const m of [cachedAuth, resolveOrgContext, getLearnPageContext, readLeaderLink]) m.mockReset();
  assertOrgAccess.mockClear();
  cachedAuth.mockResolvedValue({ user: { id: "user-1", email: "wren@example.invalid" } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  getLearnPageContext.mockResolvedValue({ kind: "on" });
  readLeaderLink.mockResolvedValue(LIVE);
});
afterEach(cleanup);

const page = (slug = "alder-creek") => SpotTheScamPortalPage({ params: Promise.resolve({ slug }) });

describe("the gate", () => {
  it("signed out: sign in, with a SERVER-BUILT callback (this page's own path), never a request value", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(page()).rejects.toThrow(`REDIRECT:/signin?callbackUrl=${encodeURIComponent("/o/alder-creek/learn/spot-the-scam")}`);
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("an unknown organization is the organization's 404, and nothing else is read", async () => {
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(page()).rejects.toThrow("NOT_FOUND");
    expect(getLearnPageContext).not.toHaveBeenCalled();
    expect(readLeaderLink).not.toHaveBeenCalled();
  });

  it("no relationship: the one access-denied answer, with no toggle read and no leader read", async () => {
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Other Church", organizationType: "congregation" });
    render(await page());
    expect(screen.getByText(/Other Church/)).toBeTruthy();
    expect(getLearnPageContext).not.toHaveBeenCalled();
    expect(readLeaderLink).not.toHaveBeenCalled();
    expect(screen.queryByTestId("trainer")).toBeNull();
  });

  it("an ended relationship: the dated answer, no toggle read", async () => {
    resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Alder Creek Church", endedOn: "2026-03-31" });
    render(await page());
    expect(getLearnPageContext).not.toHaveBeenCalled();
    expect(screen.queryByTestId("trainer")).toBeNull();
  });

  it("the toggle read gets the resolved person and organization, never the slug", async () => {
    render(await page());
    expect(getLearnPageContext).toHaveBeenCalledWith({ personId: "person-1", organizationId: "org-1" });
    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("off, error and on", () => {
  it("off for a manager: 'isn't turned on' naming the organization, with the Features link; no practice and no leader panel", async () => {
    getLearnPageContext.mockResolvedValue({ kind: "off", canManageFeatures: true });
    render(await page());
    expect(screen.getByTestId("learn-off").textContent).toContain("Spot the scam isn't turned on for Alder Creek Church yet.");
    expect(screen.getByRole("link", { name: "Turn it on under Features" }).getAttribute("href")).toBe("/o/alder-creek/admin/features");
    expect(screen.queryByTestId("trainer")).toBeNull();
    expect(readLeaderLink).not.toHaveBeenCalled();
  });

  it("off for a non-manager: who to ask, and NO Features link (an instruction they cannot follow)", async () => {
    getLearnPageContext.mockResolvedValue({ kind: "off", canManageFeatures: false });
    render(await page());
    expect(screen.getByTestId("learn-off").textContent).toContain("Ask someone who manages Alder Creek Church's features to turn it on.");
    expect(screen.queryByRole("link", { name: "Turn it on under Features" })).toBeNull();
  });

  it("a database failure reading the toggle is the load error, NEVER the off state", async () => {
    getLearnPageContext.mockRejectedValue(new Error("connection terminated"));
    render(await page());
    expect(screen.getByTestId("learn-load-error")).toBeTruthy();
    expect(screen.queryByTestId("learn-off")).toBeNull();
    expect(screen.queryByTestId("trainer")).toBeNull();
  });

  it("an OrgAccessError (the membership ended mid-request) is rethrown to the segment's error boundary", async () => {
    getLearnPageContext.mockRejectedValue(new OrgAccessError("person-1", "org-1"));
    await expect(page()).rejects.toBeInstanceOf(OrgAccessError);
  });

  it("on: the h1, the frame with the practice, the six rules and the leader panel", async () => {
    render(await page());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Spot the scam");
    expect(screen.getByTestId("spot-the-scam-frame")).toBeTruthy();
    expect(screen.getByTestId("trainer")).toBeTruthy();
    expect(screen.getByTestId("rules-card")).toBeTruthy();
    expect(screen.getByTestId("leader-panel")).toBeTruthy();
    expect(readLeaderLink).toHaveBeenCalledWith("alder-creek");
  });

  it("is permission-blind: it never asks for a permission beyond membership (the gate has no key)", async () => {
    render(await page());
    // resolveOrgContext/assertOrgAccess are the whole authority gate; the toggle read takes ids only.
    expect(Object.keys(getLearnPageContext.mock.calls[0]![0] as object).sort()).toEqual(["organizationId", "personId"]);
  });
});

describe("metadata", () => {
  it("the (org) page is noindex and does not auto-link phone, date, address or email shapes", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.formatDetection).toEqual({ telephone: false, date: false, address: false, email: false });
    expect(metadata.title).toBe("Spot the scam");
  });
});
