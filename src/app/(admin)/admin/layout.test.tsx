import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FEATURES } from "@/lib/permissions";

/**
 * The platform console shell.
 *
 *   - The "← PresbyPortal" link is the way back out and must land on /home (the
 *     signed-in chooser), not the public front page (operator report
 *     2026-10-23, docs/work-log/2026-10-23-admin-back-link.md).
 *   - The two redirects are UNCHANGED (R9, E10): no session goes to
 *     /signin?callbackUrl=/admin; a required-but-unverified second factor goes
 *     to /totp?callbackUrl=/admin; otherwise neither fires. The mocked
 *     `redirect` throws a sentinel so each test stops where the app would.
 *   - A failing live platform-admin read degrades the avatar menu and never
 *     crashes the shell (R1d, E11).
 *   - Landmarks, skip link, one sign-out path (E12).
 */

class Redirected extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

const mockAuth = vi.fn();
const mockIsPlatformAdmin = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Redirected(to);
});

vi.mock("@/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => mockAuth() }));
vi.mock("@/lib/nav-data", () => ({
  cachedIsPlatformAdmin: (id: string) => mockIsPlatformAdmin(id),
}));
vi.mock("@/lib/auth/sign-out-action", () => ({ signOutAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  usePathname: () => "/admin",
}));

function user(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: "u1",
      name: "Sam Operator",
      email: "sam@example.invalid",
      features: [FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TICKETS],
      twoFactorRequired: false,
      twoFactorVerified: false,
      ...overrides,
    },
  };
}

async function render() {
  const { default: AdminLayout } = await import("./layout");
  return renderToStaticMarkup(await AdminLayout({ children: <p>page body</p> }));
}

beforeEach(() => {
  mockAuth.mockReset();
  mockIsPlatformAdmin.mockReset();
  mockIsPlatformAdmin.mockResolvedValue(false);
  redirect.mockClear();
});

describe("AdminLayout", () => {
  it("should link the back link to /home, not the front page — regression for admin back link leaving to the public site", async () => {
    mockAuth.mockResolvedValue(user());

    const html = await render();

    expect(html).toMatch(/<a[^>]*href="\/home"[^>]*>← PresbyPortal<\/a>/);
    expect(html).not.toMatch(/<a[^>]*href="\/"[^>]*>← PresbyPortal<\/a>/);
  });

  it("redirects a visitor with no session to sign-in with the /admin callback (E10)", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(render()).rejects.toMatchObject({
      to: "/signin?callbackUrl=/admin",
    });
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("redirects a required-but-unverified second factor to /totp with the /admin callback (E10)", async () => {
    mockAuth.mockResolvedValue(
      user({ twoFactorRequired: true, twoFactorVerified: false }),
    );

    await expect(render()).rejects.toMatchObject({
      to: "/totp?callbackUrl=/admin",
    });
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("does not redirect a verified second factor or a user for whom it is not required (E10)", async () => {
    mockAuth.mockResolvedValue(
      user({ twoFactorRequired: true, twoFactorVerified: true }),
    );
    await render();

    mockAuth.mockResolvedValue(user());
    await render();

    expect(redirect).not.toHaveBeenCalled();
  });

  it("runs the session check before the platform-admin read, so a visitor never triggers a query (E10)", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(render()).rejects.toBeInstanceOf(Redirected);
    expect(mockIsPlatformAdmin).not.toHaveBeenCalled();
  });

  it("still renders the shell when the live platform-admin read fails (E11, R1d)", async () => {
    mockAuth.mockResolvedValue(user());
    mockIsPlatformAdmin.mockRejectedValue(new Error("pool timeout"));

    const html = await render();

    expect(html).toContain("page body");
    expect(html).toContain('aria-label="Account"');
  });

  it("renders the landmarks, a skip link to <main id=admin-main>, and the page (E12)", async () => {
    mockAuth.mockResolvedValue(user());

    const html = await render();

    expect(html).toContain('<nav aria-label="Platform admin"');
    expect(html).toContain('<nav aria-label="Account"');
    expect(html).toMatch(/<a[^>]*href="#admin-main"[^>]*>Skip to main content<\/a>/);
    expect(html).toMatch(/<main[^>]*id="admin-main"[^>]*>/);
    expect(html).toContain("page body");
  });

  it("filters the nav by the session's features", async () => {
    mockAuth.mockResolvedValue(user());

    const html = await render();

    expect(html).toContain(">Tickets<");
    expect(html).toContain(">Dashboard<");
    expect(html).not.toContain(">Feature flags<");
    expect(html).not.toContain(">Audit log<");
  });

  it("has no inline sign-out form: sign-out lives in the avatar menu only (E12)", async () => {
    mockAuth.mockResolvedValue(user());

    const html = await render();

    expect(html).not.toMatch(/Sign out \(/);
    expect(html).not.toContain("<form");
  });

  it("pads <main> p-4 on a phone and p-8 from sm, with min-w-0 so a wide table cannot push the page sideways (R6)", async () => {
    mockAuth.mockResolvedValue(user());

    const html = await render();
    const main = html.match(/<main[^>]*class="([^"]*)"/)?.[1] ?? "";

    expect(main).toContain("p-4");
    expect(main).toContain("sm:p-8");
    expect(main).toContain("min-w-0");
  });
});
