// @vitest-environment jsdom
/**
 * Orchestration tests for `OrgSlugLayout`'s portal-chrome wiring
 * (docs/work-log/2026-08-25-portal-chrome.md, Phase 3, Implementation Order
 * step 6). Every collaborator is mocked — `GlobalNav` and `PortalNav` are
 * stubbed to record the props/render they receive rather than exercise
 * their own internals, which is what global-nav.test.tsx and (once written)
 * portal-nav's own tests already do. What THIS file pins is the wiring
 * contract from the design:
 *
 *   1. `org_portal.chrome_v2` OFF -> `GlobalNav` gets `orgMark: null`, no
 *      `PortalNav` renders. Byte-identical to pre-pipeline behavior.
 *   2. Flag ON + `resolved.kind === "ok"` -> BOTH `orgMark` and `PortalNav`
 *      render.
 *   3. Flag ON + any non-"ok" resolution (forbidden/ended/not-found) ->
 *      NEITHER renders — DECISION-040's access-denied/ended/404 copy stays
 *      on the platform wordmark.
 *   4. No session -> neither renders (the unreachable-in-practice fallback
 *      header, unchanged).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
}));

const getOrgBrandForLayout = vi.fn();
const getOrgMarkForLayout = vi.fn();
vi.mock("@/lib/brand/read-org-brand", () => ({
  getOrgBrandForLayout: (...args: unknown[]) => getOrgBrandForLayout(...args),
  getOrgMarkForLayout: (...args: unknown[]) => getOrgMarkForLayout(...args),
}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

vi.mock("@/components/brand/brand-tokens", () => ({
  BrandTokens: () => null,
}));

const globalNavSpy = vi.fn();
vi.mock("@/components/shared/global-nav", () => ({
  GlobalNav: (props: unknown) => {
    globalNavSpy(props);
    return <div data-testid="global-nav-stub" />;
  },
}));

const portalNavSpy = vi.fn();
vi.mock("./portal-nav", () => ({
  PortalNav: (props: unknown) => {
    portalNavSpy(props);
    return <div data-testid="portal-nav-stub" />;
  },
}));

import OrgSlugLayout from "./layout";

function session() {
  return {
    user: { id: "user-1", name: "Ada Lovelace", email: "ada@presby.invalid" },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Fixture Congregation",
    organizationType: "congregation" as const,
    slug: "fixture",
    platformStatus: "managed" as const,
  },
};

async function renderLayout() {
  const tree = await OrgSlugLayout({
    children: <div>content</div>,
    params: Promise.resolve({ slug: "fixture" }),
  });
  return render(tree);
}

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  getOrgBrandForLayout.mockReset().mockResolvedValue(null);
  getOrgMarkForLayout.mockReset().mockResolvedValue(null);
  isFlagEnabled.mockReset();
  globalNavSpy.mockReset();
  portalNavSpy.mockReset();
});

describe("OrgSlugLayout — org_portal.chrome_v2 OFF", () => {
  it("passes orgMark: null to GlobalNav and renders no PortalNav, even with an active relationship", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    isFlagEnabled.mockResolvedValue(false);

    await renderLayout();

    expect(globalNavSpy).toHaveBeenCalledTimes(1);
    expect(globalNavSpy.mock.calls[0][0].orgMark).toBeNull();
    expect(screen.queryByTestId("portal-nav-stub")).toBeNull();
    // getOrgMarkForLayout is a live DB read — it must not even be called
    // when the flag is off.
    expect(getOrgMarkForLayout).not.toHaveBeenCalled();
    // getOrgBrandForLayout is unaffected by this flag — brand emission is
    // its own, independent switch (ui.brand_theming).
    expect(getOrgBrandForLayout).toHaveBeenCalledWith("org-1", "person-1");
  });
});

describe("OrgSlugLayout — org_portal.chrome_v2 ON, active relationship", () => {
  it("passes the resolved org's name/mark to GlobalNav and renders PortalNav", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    isFlagEnabled.mockResolvedValue(true);
    getOrgMarkForLayout.mockResolvedValue({ markSrc: "data:image/png;base64,xyz" });

    await renderLayout();

    expect(globalNavSpy).toHaveBeenCalledTimes(1);
    expect(globalNavSpy.mock.calls[0][0].orgMark).toEqual({
      name: "Fixture Congregation",
      markSrc: "data:image/png;base64,xyz",
    });
    expect(screen.getByTestId("portal-nav-stub")).toBeTruthy();
    expect(portalNavSpy).toHaveBeenCalledWith({ slug: "fixture" });
    expect(getOrgMarkForLayout).toHaveBeenCalledWith("org-1", "person-1");
  });

  it("falls back to initials-only rendering (markSrc: null) when the org has no logo", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    isFlagEnabled.mockResolvedValue(true);
    getOrgMarkForLayout.mockResolvedValue(null);

    await renderLayout();

    expect(globalNavSpy.mock.calls[0][0].orgMark).toEqual({
      name: "Fixture Congregation",
      markSrc: null,
    });
  });
});

describe("OrgSlugLayout — org_portal.chrome_v2 ON, non-'ok' resolution", () => {
  it.each([
    ["forbidden", { kind: "forbidden", name: "Denied Org", organizationType: "congregation" }],
    ["ended", { kind: "ended", name: "Ended Org", endedOn: "2020-01-01" }],
    ["not-found", { kind: "not-found" }],
  ])("renders neither orgMark nor PortalNav for a %s resolution", async (_label, resolution) => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(resolution);
    isFlagEnabled.mockResolvedValue(true);

    await renderLayout();

    expect(globalNavSpy.mock.calls[0][0].orgMark).toBeNull();
    expect(screen.queryByTestId("portal-nav-stub")).toBeNull();
    expect(getOrgMarkForLayout).not.toHaveBeenCalled();
    expect(getOrgBrandForLayout).not.toHaveBeenCalled();
  });
});

describe("OrgSlugLayout — no session", () => {
  it("renders the unreachable-in-practice fallback header, no GlobalNav, no PortalNav", async () => {
    cachedAuth.mockResolvedValue(null);

    await renderLayout();

    expect(globalNavSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("portal-nav-stub")).toBeNull();
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(screen.getByText("presby")).toBeTruthy();
  });
});
