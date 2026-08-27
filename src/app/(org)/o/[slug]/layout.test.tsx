// @vitest-environment jsdom
/**
 * Orchestration tests for `OrgSlugLayout`'s portal-chrome wiring
 * (docs/work-log/2026-08-25-portal-chrome.md, Phase 3, Implementation Order
 * step 6; extended by docs/work-log/2026-08-26-portal-fpcw-directory-ux.md
 * Phase 3/4 for the `org_portal.chrome_v3` footer wiring). Every
 * collaborator is mocked — `GlobalNav`, `PortalNav`, and `PortalFooter` are
 * stubbed to record the props/render they receive rather than exercise
 * their own internals, which is what global-nav.test.tsx, portal-nav's own
 * tests, and portal-footer.test.tsx already do. What THIS file pins is the
 * wiring contract from the design:
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
 *   5. `org_portal.chrome_v3` OFF -> no `PortalFooter` renders and
 *      `getOrgProfileForFooter` is never called, regardless of `resolved.kind`
 *      or `chrome_v2`'s own state — the two flags are independent.
 *   6. `org_portal.chrome_v3` ON + `resolved.kind === "ok"` -> `PortalFooter`
 *      renders with the resolved org's name/slug and whatever
 *      `getOrgProfileForFooter` resolved.
 *   7. `org_portal.chrome_v3` ON + any non-"ok" resolution, or no session ->
 *      no `PortalFooter`, and `getOrgProfileForFooter` is never called
 *      (DECISION-040 gate discipline, same as `orgMark`/`PortalNav`).
 *
 * `isFlagEnabled` is now a KEY-AWARE mock (`mockImplementation`, keyed on the
 * flag string) rather than one blanket `mockResolvedValue` — the layout now
 * makes THREE independent flag calls (`org_portal.chrome_v2`,
 * `org_portal.chrome_v3`, and indirectly none else), and a single blanket
 * value would silently resolve both chrome flags identically.
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

// Key-aware: each test sets whichever flags it needs via
// `flagValues`; any key not set defaults to `false` (both new flags are
// seeded off, so this matches the real, un-configured default).
const flagValues = new Map<string, boolean>();
const isFlagEnabled = vi.fn((key: string) => Promise.resolve(flagValues.get(key) ?? false));
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (key: string) => isFlagEnabled(key),
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

const getOrgProfileForFooter = vi.fn();
vi.mock("@/lib/sites", () => ({
  getOrgProfileForFooter: (...args: unknown[]) => getOrgProfileForFooter(...args),
}));

const portalFooterSpy = vi.fn();
vi.mock("@/components/org-portal/portal-footer", () => ({
  PortalFooter: (props: unknown) => {
    portalFooterSpy(props);
    return <div data-testid="portal-footer-stub" />;
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
  isFlagEnabled.mockClear();
  flagValues.clear();
  getOrgProfileForFooter.mockReset().mockResolvedValue(null);
  globalNavSpy.mockReset();
  portalNavSpy.mockReset();
  portalFooterSpy.mockReset();
});

describe("OrgSlugLayout — org_portal.chrome_v2 OFF", () => {
  it("passes orgMark: null to GlobalNav and renders no PortalNav, even with an active relationship", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.chrome_v2", false);

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

describe("OrgSlugLayout — feedbackHref (commit 2, docs/work-log/2026-08-27-product-ia-scaffold.md §6a, DECISION-117)", () => {
  it("passes feedbackHref to GlobalNav only when org_portal.feedback is ON with an active relationship", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.feedback", true);

    await renderLayout();

    expect(globalNavSpy.mock.calls[0][0].feedbackHref).toBe(
      "/o/fixture/feedback",
    );
  });

  it("passes feedbackHref: undefined when org_portal.feedback is OFF, even with an active relationship", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.feedback", false);

    await renderLayout();

    expect(globalNavSpy.mock.calls[0][0].feedbackHref).toBeUndefined();
  });

  it.each([
    ["forbidden", { kind: "forbidden", name: "Denied Org", organizationType: "congregation" }],
    ["ended", { kind: "ended", name: "Ended Org", endedOn: "2020-01-01" }],
    ["not-found", { kind: "not-found" }],
  ])(
    "passes feedbackHref: undefined for a %s resolution, even with org_portal.feedback ON",
    async (_label, resolution) => {
      cachedAuth.mockResolvedValue(session());
      resolveOrgContext.mockResolvedValue(resolution);
      flagValues.set("org_portal.feedback", true);

      await renderLayout();

      expect(globalNavSpy.mock.calls[0][0].feedbackHref).toBeUndefined();
    },
  );

  it("passes no feedbackHref at all with no session (GlobalNav never even renders)", async () => {
    cachedAuth.mockResolvedValue(null);

    await renderLayout();

    expect(globalNavSpy).not.toHaveBeenCalled();
  });
});

describe("OrgSlugLayout — org_portal.chrome_v2 ON, active relationship", () => {
  it("passes the resolved org's name/mark to GlobalNav and renders PortalNav", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.chrome_v2", true);
    getOrgMarkForLayout.mockResolvedValue({ markSrc: "data:image/png;base64,xyz" });

    await renderLayout();

    expect(globalNavSpy).toHaveBeenCalledTimes(1);
    expect(globalNavSpy.mock.calls[0][0].orgMark).toEqual({
      name: "Fixture Congregation",
      markSrc: "data:image/png;base64,xyz",
    });
    expect(screen.getByTestId("portal-nav-stub")).toBeTruthy();
    // organizationType (bug fix, docs/work-log/
    // 2026-08-27-credentials-tile-org-type.md): threaded from the SAME
    // resolved.kind === "ok" branch orgMark already uses.
    expect(portalNavSpy).toHaveBeenCalledWith({
      slug: "fixture",
      organizationType: "congregation",
    });
    expect(getOrgMarkForLayout).toHaveBeenCalledWith("org-1", "person-1");
  });

  it("falls back to initials-only rendering (markSrc: null) when the org has no logo", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.chrome_v2", true);
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
    flagValues.set("org_portal.chrome_v2", true);
    flagValues.set("org_portal.chrome_v3", true);

    await renderLayout();

    expect(globalNavSpy.mock.calls[0][0].orgMark).toBeNull();
    expect(screen.queryByTestId("portal-nav-stub")).toBeNull();
    expect(getOrgMarkForLayout).not.toHaveBeenCalled();
    expect(getOrgBrandForLayout).not.toHaveBeenCalled();
    // org_portal.chrome_v3 gate discipline, same DECISION-040 posture.
    expect(screen.queryByTestId("portal-footer-stub")).toBeNull();
    expect(getOrgProfileForFooter).not.toHaveBeenCalled();
  });
});

describe("OrgSlugLayout — no session", () => {
  it("renders the unreachable-in-practice fallback header, no GlobalNav, no PortalNav, no PortalFooter", async () => {
    cachedAuth.mockResolvedValue(null);

    await renderLayout();

    expect(globalNavSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("portal-nav-stub")).toBeNull();
    expect(screen.queryByTestId("portal-footer-stub")).toBeNull();
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(getOrgProfileForFooter).not.toHaveBeenCalled();
    expect(screen.getByText("presby")).toBeTruthy();
  });
});

describe("OrgSlugLayout — org_portal.chrome_v3 OFF", () => {
  it("renders no PortalFooter and never calls getOrgProfileForFooter, even with an active relationship and chrome_v2 ON", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.chrome_v2", true);
    flagValues.set("org_portal.chrome_v3", false);

    await renderLayout();

    expect(screen.queryByTestId("portal-footer-stub")).toBeNull();
    expect(getOrgProfileForFooter).not.toHaveBeenCalled();
    // chrome_v2's own chrome is unaffected by chrome_v3's state — the two
    // flags are independent rollback units.
    expect(screen.getByTestId("portal-nav-stub")).toBeTruthy();
  });
});

describe("OrgSlugLayout — org_portal.chrome_v3 ON, active relationship", () => {
  it("renders PortalFooter with the resolved org's slug/name and the profile getOrgProfileForFooter resolved", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.chrome_v3", true);
    getOrgProfileForFooter.mockResolvedValue({
      address: "1 Fixture Way",
      phone: "555-0100",
    });

    await renderLayout();

    expect(screen.getByTestId("portal-footer-stub")).toBeTruthy();
    // organizationType (bug fix, docs/work-log/
    // 2026-08-27-credentials-tile-org-type.md): threaded to PortalFooter too
    // — the fourth visiblePortalTiles() caller this bug fix's initial pass
    // missed, caught by tsc.
    expect(portalFooterSpy).toHaveBeenCalledWith({
      slug: "fixture",
      organizationName: "Fixture Congregation",
      organizationType: "congregation",
      profile: { address: "1 Fixture Way", phone: "555-0100" },
    });
    expect(getOrgProfileForFooter).toHaveBeenCalledWith("org-1", "person-1");
  });

  it("renders PortalFooter with a null profile — the empty-state degrade — when getOrgProfileForFooter resolves null", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.chrome_v3", true);
    getOrgProfileForFooter.mockResolvedValue(null);

    await renderLayout();

    expect(screen.getByTestId("portal-footer-stub")).toBeTruthy();
    expect(portalFooterSpy.mock.calls[0][0].profile).toBeNull();
  });

  it("chrome_v3 is independent of chrome_v2 — the footer renders even with chrome_v2 OFF", async () => {
    cachedAuth.mockResolvedValue(session());
    resolveOrgContext.mockResolvedValue(RESOLVED_OK);
    flagValues.set("org_portal.chrome_v2", false);
    flagValues.set("org_portal.chrome_v3", true);

    await renderLayout();

    expect(screen.queryByTestId("portal-nav-stub")).toBeNull();
    expect(screen.getByTestId("portal-footer-stub")).toBeTruthy();
  });
});
