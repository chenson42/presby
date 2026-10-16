// @vitest-environment jsdom
/**
 * `/o/<slug>/giving/give/return` - the member return page. Same panels as the public
 * one, behind the `(org)` auth pattern, and deliberately NOT behind the Giving
 * toggle (turning it off must not strand a donor mid-gift).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const assertOrgAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a),
  assertOrgAccess: (...a: unknown[]) => assertOrgAccess(...a),
}));
const readReturnState = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readReturnState: (...a: unknown[]) => readReturnState(...a) }));
vi.mock("@/lib/giving/access", () => {
  throw new Error("the return page must not read the Giving toggle");
});
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
  useRouter: () => ({ refresh: vi.fn() }),
}));

import MemberGiveReturnPage, { metadata } from "./page";

const call = (sp: Record<string, string | string[] | undefined>) =>
  MemberGiveReturnPage({ params: Promise.resolve({ slug: "alder-creek" }), searchParams: Promise.resolve(sp) });
const ORG = { kind: "ok" as const, org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek", organizationType: "congregation" } };

afterEach(() => {
  cleanup();
  for (const fn of [cachedAuth, resolveOrgContext, assertOrgAccess, readReturnState]) fn.mockReset();
});

describe("MemberGiveReturnPage", () => {
  it("is noindex and sends no referrer", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("signed out: sign in, then come back to this panel", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(call({ session_id: "cs_test_a1B2c3D4e5" })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=" + encodeURIComponent("/o/alder-creek/giving/give/return?session_id=cs_test_a1B2c3D4e5"),
    );
    expect(readReturnState).not.toHaveBeenCalled();
  });

  it("a slug that is nothing is a 404 and reads no gift", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(call({ session_id: "cs_test_a1B2c3D4e5" })).rejects.toThrow("NOT_FOUND");
    expect(readReturnState).not.toHaveBeenCalled();
  });

  it("a non-member reads no gift", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder Creek", organizationType: "congregation" });
    render(await call({ session_id: "cs_test_a1B2c3D4e5" }));
    expect(readReturnState).not.toHaveBeenCalled();
  });

  it("a member sees the panel for their organization's session, with links into the portal", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(ORG);
    readReturnState.mockResolvedValue({ state: "bank_pending", giftAmountCents: 5000, coveredCents: 0, fundName: "General Fund", frequency: "once", livemode: true });
    render(await call({ session_id: "cs_test_a1B2c3D4e5" }));
    expect(readReturnState).toHaveBeenCalledWith("alder-creek", "cs_test_a1B2c3D4e5");
    expect(screen.getByTestId("give-return-bank_pending")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the portal" }).getAttribute("href")).toBe("/o/alder-creek");
  });

  it("no session_id is the unknown panel with no database read", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(ORG);
    render(await call({}));
    expect(screen.getByTestId("give-return-unknown")).toBeTruthy();
    expect(readReturnState).not.toHaveBeenCalled();
  });
});
