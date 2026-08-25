// @vitest-environment jsdom
/**
 * Tests for the signed-in header's read-guarding.
 *
 * A HEADER IS NOT WORTH A 500. It runs on every signed-in page and reads two
 * things that can fail independently — the organization list and
 * `users.is_platform_admin` — so what is pinned here is that each failure
 * degrades on its own and neither takes the page down.
 *
 * The component is an async Server Component, which @testing-library cannot
 * render directly. Awaiting it yields a plain element tree, and rendering THAT
 * exercises the client leaves for real: the assertions below go through the
 * actual Radix menus, not through a shallow render.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/auth/sign-out-action", () => ({
  signOutAction: vi.fn(async () => {}),
}));

const cachedAvailableOrganizations = vi.fn();
const cachedIsPlatformAdmin = vi.fn();
const publicOrgSummary = vi.fn();

vi.mock("@/lib/nav-data", () => ({
  cachedAvailableOrganizations: (userId: string) =>
    cachedAvailableOrganizations(userId),
  cachedIsPlatformAdmin: (userId: string) => cachedIsPlatformAdmin(userId),
  cachedUserOrganizations: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  publicOrgSummary: (slug: string) => publicOrgSummary(slug),
}));

import {
  describe,
  expect,
  it,
  afterEach,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { Session } from "next-auth";
import { ADMIN_ROLE } from "@/lib/permissions";
import { GlobalNav } from "./global-nav";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(cleanup);

beforeEach(() => {
  cachedAvailableOrganizations.mockReset();
  cachedIsPlatformAdmin.mockReset();
  publicOrgSummary.mockReset();
});

const WRENFIELD = {
  organizationId: "org-1",
  personId: "person-1",
  membershipId: "membership-1",
  name: "Wrenfield Presbyterian Church",
  organizationType: "congregation",
  slug: "e2e-alpha",
  platformStatus: "managed",
  endedOn: null,
  membershipCreatedAt: "2026-01-01T00:00:00.000Z",
};

const FELLS = {
  ...WRENFIELD,
  organizationId: "org-2",
  membershipId: "membership-2",
  name: "Presbytery of the Eastern Fells",
  organizationType: "presbytery",
  slug: "e2e-presbytery",
};

function session(overrides: Record<string, unknown> = {}): Session {
  return {
    user: {
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@presby.invalid",
      roles: [],
      features: [],
      ...overrides,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session;
}

async function renderNav(props: Parameters<typeof GlobalNav>[0]) {
  const tree = await GlobalNav(props);
  return render(tree);
}

describe("GlobalNav — the healthy path", () => {
  it("names the current organization and offers the others", async () => {
    cachedAvailableOrganizations.mockResolvedValue([WRENFIELD, FELLS]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({ session: session(), currentOrgSlug: WRENFIELD.slug });

    const trigger = screen.getByTestId("org-switcher-trigger");
    expect(trigger.textContent).toContain(WRENFIELD.name);
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    expect(
      screen.getByRole("menuitem", { name: new RegExp(FELLS.name) }),
    ).toBeTruthy();
  });

  it("renders the avatar alongside it", async () => {
    cachedAvailableOrganizations.mockResolvedValue([WRENFIELD]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({ session: session() });

    expect(screen.getByTestId("avatar-menu-trigger").textContent).toBe("AL");
  });

  it("reads is_platform_admin live rather than from a session claim", async () => {
    // The session below carries no roles and no features. The Developer item
    // still appears, because the column is what gates it — and revoking that
    // column has to take effect now, not at the next token refresh.
    cachedAvailableOrganizations.mockResolvedValue([]);
    cachedIsPlatformAdmin.mockResolvedValue(true);

    await renderNav({ session: session() });

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("avatar-menu-trigger"), {
        key: "Enter",
      });
    });

    expect(cachedIsPlatformAdmin).toHaveBeenCalledWith("user-1");
    expect(screen.getByRole("menuitem", { name: "Developer" })).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Platform admin" }),
    ).toBeNull();
  });

  it("derives the /admin item from the session claim the Edge enforces", async () => {
    cachedAvailableOrganizations.mockResolvedValue([]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({ session: session({ roles: [ADMIN_ROLE] }) });

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("avatar-menu-trigger"), {
        key: "Enter",
      });
    });

    expect(
      screen.getByRole("menuitem", { name: "Platform admin" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Developer" })).toBeNull();
  });

  it("gives a user with no organizations no context control at all", async () => {
    cachedAvailableOrganizations.mockResolvedValue([]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({ session: session() });

    expect(screen.queryByTestId("org-switcher-trigger")).toBeNull();
    expect(screen.queryByTestId("org-switcher-static")).toBeNull();
    // …but still an avatar. A zero-organization platform admin has to be able
    // to sign out.
    expect(screen.getByTestId("avatar-menu-trigger")).toBeTruthy();
  });

  it("does not label a slug the user holds no relationship with as current", async () => {
    // The access-denied page renders inside the org shell with the slug in the
    // URL. It is not in the list, so it is not "current".
    cachedAvailableOrganizations.mockResolvedValue([WRENFIELD, FELLS]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({ session: session(), currentOrgSlug: "e2e-gamma" });

    expect(screen.getByTestId("org-switcher-trigger").textContent).toContain(
      "Organizations",
    );
    expect(publicOrgSummary).not.toHaveBeenCalled();
  });
});

describe("GlobalNav — orgMark prop (portal-chrome, docs/work-log/2026-08-25-portal-chrome.md)", () => {
  it("renders the platform 'presby' wordmark, linking to /, when orgMark is absent — byte-identical to today", async () => {
    cachedAvailableOrganizations.mockResolvedValue([WRENFIELD]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({ session: session(), currentOrgSlug: WRENFIELD.slug });

    const wordmark = screen.getByRole("link", { name: "presby" });
    expect(wordmark.getAttribute("href")).toBe("/");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("swaps to OrgMark, linking to /o/<slug>, when orgMark and currentOrgSlug are both present", async () => {
    cachedAvailableOrganizations.mockResolvedValue([WRENFIELD]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({
      session: session(),
      currentOrgSlug: WRENFIELD.slug,
      orgMark: { name: "Fixture Congregation", markSrc: "data:image/png;base64,xyz" },
    });

    expect(screen.queryByRole("link", { name: "presby" })).toBeNull();
    const image = screen.getByRole("img", { name: "Fixture Congregation logo" });
    expect(image.getAttribute("src")).toBe("data:image/png;base64,xyz");
    const wordmarkLink = screen.getByRole("link", {
      name: "Fixture Congregation home",
    });
    expect(wordmarkLink.getAttribute("href")).toBe(`/o/${WRENFIELD.slug}`);
  });

  it("falls back to initials when orgMark carries no markSrc — no logo, never a crash", async () => {
    cachedAvailableOrganizations.mockResolvedValue([WRENFIELD]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({
      session: session(),
      currentOrgSlug: WRENFIELD.slug,
      orgMark: { name: "Fixture Congregation", markSrc: null },
    });

    expect(screen.queryByRole("img")).toBeNull();
    const wordmarkLink = screen.getByRole("link", {
      name: "Fixture Congregation home",
    });
    expect(wordmarkLink.textContent).toBe("FC");
  });

  it("falls back to the platform wordmark when orgMark is present but currentOrgSlug is not (defensive — the caller never actually does this)", async () => {
    cachedAvailableOrganizations.mockResolvedValue([]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({
      session: session(),
      orgMark: { name: "Fixture Congregation", markSrc: null },
    });

    const wordmark = screen.getByRole("link", { name: "presby" });
    expect(wordmark.getAttribute("href")).toBe("/");
  });

  it("keeps the truncate mechanism wired for a name long enough to need it, even after the OrgMark swap frees width in the row", async () => {
    // Phase 5 FIRST PASS finding (docs/work-log/2026-08-25-portal-chrome.md):
    // swapping the "presby" TEXT wordmark for OrgMark (a small square
    // logo/initials, no restated name) frees enough width that
    // "Presbytery of the Eastern Fells" — the longest name any e2e fixture
    // org carries — now fits at 360px WITHOUT clipping. That's the correct
    // behavior (a name that fits should show in full), so
    // e2e/header-controls.spec.ts no longer asserts real pixel clipping for
    // it, and no current e2e fixture name is long enough to force real
    // clipping in the new, wider-fitting layout.
    //
    // This test exists to pin the OTHER half of that contract: the safety
    // valve itself — the `truncate` class on the org-name span — has to stay
    // wired for the day a name IS too long, regardless of how much width the
    // OrgMark swap frees. jsdom does no real layout (scrollWidth/clientWidth
    // are always 0 here), so this can't measure actual pixel clipping — that
    // proof is e2e's job, gated on a name long enough to need it. What this
    // pins is structural: given a name well past anything a real 360px
    // header could fit, the CSS mechanism that would clip it is still
    // present in the DOM GlobalNav renders with orgMark set.
    const LONG_NAME =
      "Presbytery of the Eastern Fells and the Western Territorial " +
      "Council of Consolidated Congregations";
    const longFixture = { ...FELLS, name: LONG_NAME };
    cachedAvailableOrganizations.mockResolvedValue([WRENFIELD, longFixture]);
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({
      session: session(),
      currentOrgSlug: longFixture.slug,
      orgMark: { name: LONG_NAME, markSrc: null },
    });

    const trigger = screen.getByTestId("org-switcher-trigger");
    const nameSpan = trigger.querySelector("span.truncate");
    expect(nameSpan).not.toBeNull();
    expect(nameSpan!.textContent).toBe(LONG_NAME);
    expect(nameSpan!.className).toContain("truncate");
  });
});

describe("GlobalNav — the organization list cannot be read", () => {
  it("falls back to the public org tree for the name, and renders it as plain text", async () => {
    // Flow 1's failure case. The two reads hit different tables — the list goes
    // through the SECURITY DEFINER membership function, this one is a bare
    // select on the public `organizations` table — so one can survive the other.
    cachedAvailableOrganizations.mockRejectedValue(new Error("pool timeout"));
    cachedIsPlatformAdmin.mockResolvedValue(false);
    publicOrgSummary.mockResolvedValue({
      name: WRENFIELD.name,
      organizationType: "congregation",
    });

    await renderNav({ session: session(), currentOrgSlug: WRENFIELD.slug });

    expect(publicOrgSummary).toHaveBeenCalledWith(WRENFIELD.slug);
    expect(screen.getByTestId("org-switcher-static").textContent).toContain(
      WRENFIELD.name,
    );
    // NEVER an empty dropdown: to a user that reads as "my access was revoked".
    expect(screen.queryByTestId("org-switcher-trigger")).toBeNull();
  });

  it("renders no context control when the fallback read fails too", async () => {
    cachedAvailableOrganizations.mockRejectedValue(new Error("pool timeout"));
    cachedIsPlatformAdmin.mockResolvedValue(false);
    publicOrgSummary.mockRejectedValue(new Error("pool timeout"));

    await renderNav({ session: session(), currentOrgSlug: WRENFIELD.slug });

    expect(screen.queryByTestId("org-switcher-trigger")).toBeNull();
    expect(screen.queryByTestId("org-switcher-static")).toBeNull();
    expect(screen.getByTestId("avatar-menu-trigger")).toBeTruthy();
  });

  it("renders no context control on a page with no organization in the URL", async () => {
    // /home during an outage: there is no slug, so there is nothing to name and
    // nothing to look up.
    cachedAvailableOrganizations.mockRejectedValue(new Error("pool timeout"));
    cachedIsPlatformAdmin.mockResolvedValue(false);

    await renderNav({ session: session() });

    expect(publicOrgSummary).not.toHaveBeenCalled();
    expect(screen.queryByTestId("org-switcher-trigger")).toBeNull();
    expect(screen.queryByTestId("org-switcher-static")).toBeNull();
  });

  it("survives an unknown slug returning nothing from the public tree", async () => {
    cachedAvailableOrganizations.mockRejectedValue(new Error("pool timeout"));
    cachedIsPlatformAdmin.mockResolvedValue(false);
    publicOrgSummary.mockResolvedValue(null);

    await renderNav({ session: session(), currentOrgSlug: "no-such-org" });

    expect(screen.queryByTestId("org-switcher-static")).toBeNull();
    expect(screen.getByTestId("avatar-menu-trigger")).toBeTruthy();
  });
});

describe("GlobalNav — is_platform_admin cannot be read", () => {
  it("drops the Developer item and keeps the rest of the header", async () => {
    // Failing closed is right here: the column decides which PAGES are
    // reachable, and an unreadable column is not a grant.
    cachedAvailableOrganizations.mockResolvedValue([WRENFIELD]);
    cachedIsPlatformAdmin.mockRejectedValue(new Error("pool timeout"));

    await renderNav({ session: session({ roles: [ADMIN_ROLE] }) });

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("avatar-menu-trigger"), {
        key: "Enter",
      });
    });

    expect(screen.queryByRole("menuitem", { name: "Developer" })).toBeNull();
    // The session claim is independent, so /admin is unaffected.
    expect(
      screen.getByRole("menuitem", { name: "Platform admin" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });
});
