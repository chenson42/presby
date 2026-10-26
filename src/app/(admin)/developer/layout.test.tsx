import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The portal's frame (E5, E8, E9): chrome only. It never redirects and never
 * throws on a failed read; it renders bare children when there is no usable
 * session, the header always otherwise, and the nav only when the live
 * entitlement read says so.
 */

const mockAuth = vi.fn();
const mockEntitled = vi.fn();
const mockCanAccessAdmin = vi.fn();

vi.mock("@/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => mockAuth() }));
vi.mock("./guard", () => ({ readEntitled: (id: string) => mockEntitled(id) }));
vi.mock("@/lib/platform-admin", () => ({
  sessionCanAccessAdmin: (u: unknown) => mockCanAccessAdmin(u),
}));
vi.mock("@/lib/auth/sign-out-action", () => ({ signOutAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/developer" }));
vi.mock("@/components/shared/avatar-menu", () => ({
  AvatarMenu: (p: { canAccessAdmin: boolean; isPlatformAdmin: boolean }) => (
    <span
      data-testid="avatar"
      data-admin={String(p.canAccessAdmin)}
      data-developer={String(p.isPlatformAdmin)}
    />
  ),
}));

const session = (extra: Record<string, unknown> = {}) => ({
  user: {
    id: "u1",
    name: "Sam Dev",
    email: "sam@example.invalid",
    features: [],
    twoFactorRequired: false,
    twoFactorVerified: false,
    ...extra,
  },
});

async function render() {
  const { default: DeveloperLayout } = await import("./layout");
  return renderToStaticMarkup(
    await DeveloperLayout({ children: <p>page body</p> }),
  );
}

beforeEach(() => {
  mockAuth.mockReset();
  mockEntitled.mockReset();
  mockCanAccessAdmin.mockReset();
  mockEntitled.mockResolvedValue(true);
  mockCanAccessAdmin.mockReturnValue(false);
});

describe("DeveloperLayout", () => {
  it("renders the header, the nav, the skip link and <main id=developer-main> for an entitled viewer", async () => {
    mockAuth.mockResolvedValue(session());

    const html = await render();

    expect(html).toContain('<nav aria-label="Developer portal"');
    expect(html).toContain('<nav aria-label="Account"');
    expect(html).toMatch(/<a[^>]*href="#developer-main"[^>]*>Skip to main content<\/a>/);
    expect(html).toMatch(/<main[^>]*id="developer-main"[^>]*>/);
    expect(html).toMatch(/<a[^>]*href="\/home"[^>]*>← PresbyPortal<\/a>/);
    for (const label of [">Home<", ">Data model<", ">Documentation<", ">Reference<", ">Guides<"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("page body");
    expect(html).toContain("Version ");
  });

  it("pads <main> p-4 on a phone and p-8 from sm, with min-w-0 so a wide table cannot push the page sideways", async () => {
    mockAuth.mockResolvedValue(session());
    const html = await render();
    const main = html.match(/<main[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(main).toContain("p-4");
    expect(main).toContain("sm:p-8");
    expect(main).toContain("min-w-0");
  });

  it("a non-entitled viewer gets the header and the page but no nav and no Menu button (E5)", async () => {
    mockAuth.mockResolvedValue(session());
    mockEntitled.mockResolvedValue(false);

    const html = await render();

    expect(html).toContain('<nav aria-label="Account"');
    expect(html).toContain("page body");
    expect(html).not.toContain('<nav aria-label="Developer portal"');
    expect(html).not.toContain("Menu");
    expect(html).not.toContain(">Data model<");
  });

  it("a failing live read still renders the header and the page, without the nav (E8)", async () => {
    mockAuth.mockResolvedValue(session());
    mockEntitled.mockRejectedValue(new Error("pool timeout"));

    const html = await render();

    expect(html).toContain('<nav aria-label="Account"');
    expect(html).toContain("page body");
    expect(html).not.toContain('<nav aria-label="Developer portal"');
  });

  it("renders only the children when there is no session, and reads nothing (E9)", async () => {
    mockAuth.mockResolvedValue(null);

    const html = await render();

    expect(html).toBe("<p>page body</p>");
    expect(mockEntitled).not.toHaveBeenCalled();
  });

  it("renders only the children for a required, unverified second factor (E9)", async () => {
    mockAuth.mockResolvedValue(
      session({ twoFactorRequired: true, twoFactorVerified: false }),
    );

    const html = await render();

    expect(html).toBe("<p>page body</p>");
    expect(html).not.toContain("Account");
    expect(mockEntitled).not.toHaveBeenCalled();
  });

  it("passes the real admin claim, not true, so a developer-only viewer sees no Platform admin item (Ruling 4)", async () => {
    mockAuth.mockResolvedValue(session());
    mockCanAccessAdmin.mockReturnValue(false);
    let html = await render();
    expect(html).toContain('data-admin="false"');
    expect(html).toContain('data-developer="true"');

    mockCanAccessAdmin.mockReturnValue(true);
    html = await render();
    expect(html).toContain('data-admin="true"');
  });

  it("never redirects (the page gate decides)", async () => {
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(__dirname, "layout.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/redirect\(/);
  });
});
