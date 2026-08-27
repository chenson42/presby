// @vitest-environment jsdom
/**
 * Orchestration tests for `/home`'s page.tsx — the merged post-chooser
 * landing surface (docs/work-log/2026-08-27-platform-home-and-portal.md,
 * Phase 3, DECISION-124).
 *
 * What this pins:
 *
 *   1. `platform.merged_home` OFF renders exactly the pre-merge shape
 *      (greeting, Account settings + Admin dashboard quick links, what's-new,
 *      feedback) and never calls `cachedUserOrganizations()` /
 *      `cachedIsPlatformAdmin()` — the flag's whole job is a content-only
 *      rollback that costs nothing beyond the toggle check.
 *   2. ON, a multi-org member with no platform access sees "Your
 *      organizations" (both cards) and no "Platform" section.
 *   3. ON, `canAccessAdmin` alone renders the Admin card but not the
 *      Developer card — DECISION-044's two-predicates-not-one rule.
 *   4. ON, `isPlatformAdmin` alone (zero organizations) renders the
 *      Developer card but not the Admin card, and no "Your organizations"
 *      heading — the Developer-card-independence invariant this pipeline's
 *      architect ruling named.
 *   5. ON, a pending (`invited`) relationship renders "Still being set up".
 *   6. ON, the org-list read failing degrades to `<OrganizationsUnavailable>`
 *      ALONE — no greeting, no what's-new, no feedback prompt — the
 *      all-or-nothing contract carried over verbatim from `/orgs`.
 *
 * Every collaborator is mocked; this file makes no DB connection.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const cachedUserOrganizations = vi.fn();
const cachedIsPlatformAdmin = vi.fn();
vi.mock("@/lib/nav-data", () => ({
  cachedUserOrganizations: (...args: unknown[]) => cachedUserOrganizations(...args),
  cachedIsPlatformAdmin: (...args: unknown[]) => cachedIsPlatformAdmin(...args),
}));

const sessionCanAccessAdmin = vi.fn();
vi.mock("@/lib/platform-admin", () => ({
  sessionCanAccessAdmin: (...args: unknown[]) => sessionCanAccessAdmin(...args),
}));

// A real, simplified stand-in for the pure predicate — not a mock of
// behavior we need to assert calls against, just enough of the real
// contract (endedOn === null && platformStatus === "managed") to filter
// fixtures the same way the real function does.
vi.mock("@/lib/authz", () => ({
  isEnterableOrganization: (org: { endedOn: string | null; platformStatus: string }) =>
    org.endedOn === null && org.platformStatus === "managed",
}));

const getFeedbackPromptState = vi.fn();
const shouldShowFeedbackPrompt = vi.fn();
vi.mock("@/lib/feedback-prompt", () => ({
  getFeedbackPromptState: (...args: unknown[]) => getFeedbackPromptState(...args),
  shouldShowFeedbackPrompt: (...args: unknown[]) => shouldShowFeedbackPrompt(...args),
}));

vi.mock("@/components/shared/feedback-prompt-card", () => ({
  FeedbackPromptCard: () => <div data-testid="feedback-prompt-card-stub" />,
}));

const rowsRef = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const dbMock = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  } as Record<string, ReturnType<typeof vi.fn>>;
  selectChain.from.mockReturnValue(selectChain);
  selectChain.orderBy.mockReturnValue(selectChain);
  selectChain.limit.mockImplementation(() => Promise.resolve(rowsRef.current));
  const select = vi.fn(() => selectChain);
  return { select, db: { select } };
});
vi.mock("@/lib/db", async () => {
  // Circular-import-avoidance shape (admin/tickets/page.test.tsx's own
  // precedent): force the real schema module to load before the mock
  // factory returns, since page.tsx imports `whatsNewEntries` from it
  // directly rather than through this mocked module.
  await import("@/lib/db/schema");
  return { db: dbMock.db };
});

import HomePage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  isFlagEnabled.mockReset();
  cachedUserOrganizations.mockReset();
  cachedIsPlatformAdmin.mockReset();
  sessionCanAccessAdmin.mockReset();
  getFeedbackPromptState.mockReset().mockResolvedValue(null);
  shouldShowFeedbackPrompt.mockReset().mockReturnValue(false);
  rowsRef.current = [];
});

const ALPHA = {
  organizationId: "org-alpha",
  personId: "person-1",
  membershipId: "m-1",
  name: "Alder Creek Presbyterian Church",
  organizationType: "congregation" as const,
  slug: "alder-creek",
  platformStatus: "managed" as const,
  endedOn: null,
  membershipCreatedAt: "2024-01-01T00:00:00Z",
};

const FERNWOOD = {
  ...ALPHA,
  organizationId: "org-fernwood",
  name: "Fernwood Presbytery",
  organizationType: "presbytery" as const,
  slug: "fernwood",
};

const PENDING_ORG = {
  ...ALPHA,
  organizationId: "org-pending",
  name: "Quillhaven Presbyterian Church",
  slug: "quillhaven",
  platformStatus: "invited" as const,
};

function sessionUser(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Sam",
    email: "sam@example.invalid",
    features: [],
    ...over,
  };
}

describe("HomePage — platform.merged_home OFF (the regression floor)", () => {
  it("renders exactly the pre-merge shape and never reads the organization list", async () => {
    cachedAuth.mockResolvedValue({ user: sessionUser({ features: ["admin.dashboard"] }) });
    isFlagEnabled.mockResolvedValue(false);

    const el = await HomePage();
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("platform.merged_home");
    expect(cachedUserOrganizations).not.toHaveBeenCalled();
    expect(cachedIsPlatformAdmin).not.toHaveBeenCalled();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Sam\.$/);
    expect(screen.getByRole("link", { name: "Account settings" })).toBeTruthy();
    // isAdmin quick link restored when the merged sections don't render.
    expect(screen.getByRole("link", { name: "Admin dashboard" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your organizations" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Platform" })).toBeNull();
  });

  it("omits the Admin dashboard quick link for a non-admin user", async () => {
    cachedAuth.mockResolvedValue({ user: sessionUser() });
    isFlagEnabled.mockResolvedValue(false);

    const el = await HomePage();
    render(el);

    expect(screen.queryByRole("link", { name: "Admin dashboard" })).toBeNull();
  });
});

describe("HomePage — platform.merged_home ON", () => {
  it("a multi-org member with no platform access sees both cards and no Platform section", async () => {
    cachedAuth.mockResolvedValue({ user: sessionUser() });
    isFlagEnabled.mockResolvedValue(true);
    cachedUserOrganizations.mockResolvedValue([ALPHA, FERNWOOD]);
    cachedIsPlatformAdmin.mockResolvedValue(false);
    sessionCanAccessAdmin.mockReturnValue(false);

    const el = await HomePage();
    render(el);

    expect(screen.getByRole("heading", { name: "Your organizations" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: ALPHA.name })).toBeTruthy();
    expect(screen.getByRole("heading", { name: FERNWOOD.name })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Platform" })).toBeNull();
    // The Platform section covers /admin now — the quick link is dropped
    // entirely when the merged sections render, regardless of admin status.
    expect(screen.queryByRole("link", { name: "Admin dashboard" })).toBeNull();

    // DECISION-039: no membership language anywhere on the page.
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\bmember\b/i);
  });

  it("canAccessAdmin alone renders the Admin card but not the Developer card", async () => {
    cachedAuth.mockResolvedValue({
      user: sessionUser({ features: ["admin.dashboard"] }),
    });
    isFlagEnabled.mockResolvedValue(true);
    cachedUserOrganizations.mockResolvedValue([ALPHA]);
    cachedIsPlatformAdmin.mockResolvedValue(false);
    sessionCanAccessAdmin.mockReturnValue(true);

    const el = await HomePage();
    render(el);

    expect(screen.getByRole("heading", { name: "Platform" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Admin\b/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Developer\b/ })).toBeNull();
  });

  it("isPlatformAdmin alone (zero organizations) renders the Developer card but not Admin, and no org section — Developer-card independence (DECISION-044)", async () => {
    cachedAuth.mockResolvedValue({ user: sessionUser() });
    isFlagEnabled.mockResolvedValue(true);
    cachedUserOrganizations.mockResolvedValue([]);
    cachedIsPlatformAdmin.mockResolvedValue(true);
    sessionCanAccessAdmin.mockReturnValue(false);

    const el = await HomePage();
    render(el);

    expect(screen.queryByRole("heading", { name: "Your organizations" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Platform" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Developer\b/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Admin\b/ })).toBeNull();
  });

  it("holding both platform predicates renders both cards", async () => {
    cachedAuth.mockResolvedValue({
      user: sessionUser({ features: ["admin.dashboard"] }),
    });
    isFlagEnabled.mockResolvedValue(true);
    cachedUserOrganizations.mockResolvedValue([]);
    cachedIsPlatformAdmin.mockResolvedValue(true);
    sessionCanAccessAdmin.mockReturnValue(true);

    const el = await HomePage();
    render(el);

    expect(screen.getByRole("link", { name: /^Admin\b/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Developer\b/ })).toBeTruthy();
  });

  it("a pending relationship renders 'Still being set up' with no link", async () => {
    cachedAuth.mockResolvedValue({ user: sessionUser() });
    isFlagEnabled.mockResolvedValue(true);
    cachedUserOrganizations.mockResolvedValue([ALPHA, PENDING_ORG]);
    cachedIsPlatformAdmin.mockResolvedValue(false);
    sessionCanAccessAdmin.mockReturnValue(false);

    const el = await HomePage();
    render(el);

    expect(screen.getByRole("heading", { name: "Still being set up" })).toBeTruthy();
    expect(screen.getByText(new RegExp(PENDING_ORG.name))).toBeTruthy();
    expect(screen.queryByRole("link", { name: PENDING_ORG.name })).toBeNull();
  });

  it("no nothingToShow empty state — the flag's own section design has none", async () => {
    // enterable + platform both empty is provably unreachable at /home via
    // the chooser reason (Phase 3's Edge Cases), but the page itself makes no
    // assumption about how it got here — this pins that no empty-state block
    // was carried over from /orgs regardless.
    cachedAuth.mockResolvedValue({ user: sessionUser() });
    isFlagEnabled.mockResolvedValue(true);
    cachedUserOrganizations.mockResolvedValue([]);
    cachedIsPlatformAdmin.mockResolvedValue(false);
    sessionCanAccessAdmin.mockReturnValue(false);

    const el = await HomePage();
    render(el);

    expect(
      screen.queryByText(/not connected to a congregation yet/i),
    ).toBeNull();
    // The greeting still renders — this is not the org-list-failure degrade.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Sam\.$/);
  });

  it("degrades to OrganizationsUnavailable ALONE when the organization list fails to load", async () => {
    cachedAuth.mockResolvedValue({ user: sessionUser() });
    isFlagEnabled.mockResolvedValue(true);
    cachedUserOrganizations.mockRejectedValue(new Error("pool timeout"));
    cachedIsPlatformAdmin.mockResolvedValue(false);

    const el = await HomePage();
    render(el);

    expect(
      screen.getByText(/can't reach your congregations/i),
    ).toBeTruthy();
    // No greeting, no what's-new, no feedback prompt — the all-or-nothing
    // contract carried over verbatim from /orgs. (The unavailable state's OWN
    // <h1> is expected — asserted above — this checks the page's greeting
    // never renders alongside it.)
    expect(screen.queryByText(/Welcome, Sam\./)).toBeNull();
    expect(screen.queryByTestId("feedback-prompt-card-stub")).toBeNull();
    expect(getFeedbackPromptState).not.toHaveBeenCalled();
  });
});
