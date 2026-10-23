import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The admin sidebar's "← PresbyPortal" link is the way back out of the
 * platform admin shell. It must land on /home (the signed-in chooser), not the
 * public front page (operator report 2026-10-23,
 * docs/work-log/2026-10-23-admin-back-link.md).
 */

vi.mock("@/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: vi.fn(async () => ({
    user: { id: "u1", twoFactorRequired: false, twoFactorVerified: false },
  })),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("AdminLayout", () => {
  it("should link the sidebar's back link to /home, not the front page — regression for admin back link leaving to the public site", async () => {
    const { default: AdminLayout } = await import("./layout");

    const html = renderToStaticMarkup(await AdminLayout({ children: null }));

    expect(html).toMatch(/<a[^>]*href="\/home"[^>]*>← PresbyPortal<\/a>/);
    expect(html).not.toMatch(/<a[^>]*href="\/"[^>]*>← PresbyPortal<\/a>/);
  });
});
