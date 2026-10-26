// @vitest-environment jsdom
/**
 * /account/2fa (the server page), rendered with its data scripted.
 *
 * F344: an enrolled person whose session has not passed the second factor sees
 * a "Confirm it's you" step in place of the Regenerate button. The page is UX
 * only; the refusal itself lives in regenerateRecoveryCodes (actions.test.ts and
 * actions.db.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

const dbh = vi.hoisted(() => ({
  totp: undefined as unknown,
  recoveryRows: [] as { usedAt: Date | null }[],
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      userTotp: { findFirst: vi.fn(async () => dbh.totp) },
      userTotpRecoveryCodes: { findMany: vi.fn(async () => dbh.recoveryRows) },
    },
  },
}));
vi.mock("@/lib/db/schema", () => ({
  userTotp: { userId: "user_totp.user_id" },
  userTotpRecoveryCodes: { userId: "user_totp_recovery_codes.user_id" },
}));

vi.mock("@/lib/two-factor", () => ({
  FRESH_RECOVERY_CODES_COOKIE: "claudecode_fresh_recovery_codes",
  isTotpConfigured: () => true,
}));
vi.mock("@/lib/totp-pending", () => ({
  PENDING_TTL_MINUTES: 10,
  getOrCreatePendingEnrollment: vi.fn(async () => ({ uri: "otpauth://totp/x", secret: "SECRET" })),
}));

vi.mock("./actions", () => ({
  completeEnrollment: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  clearFreshCodesCookieAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("qrcode", () => ({ toDataURL: async () => "data:image/png;base64,AAAA" }));

import AccountTwoFactorPage from "./page";

const USER_ID = "00000000-0000-4000-8000-0000000000f4";

function session(over: { twoFactorVerified?: boolean; twoFactorRequired?: boolean } = {}) {
  return {
    user: { id: USER_ID, email: "t@example.invalid", twoFactorRequired: true, twoFactorVerified: false, ...over },
  };
}

async function renderPage(searchParams: { callbackUrl?: string } = {}) {
  const el = (await AccountTwoFactorPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement;
  return { el, ...render(el) };
}

beforeEach(() => {
  mockAuth.mockResolvedValue(session());
  dbh.totp = { enrolledAt: new Date("2026-10-01T12:00:00Z"), lastUsedAt: null };
  dbh.recoveryRows = Array.from({ length: 10 }, () => ({ usedAt: null }));
});
afterEach(cleanup);

describe("/account/2fa management view — F344 notice", () => {
  it("P5: enrolled and unverified -> the notice and the exact /totp link back to this page; no Regenerate button", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: false }));
    await renderPage();
    expect(
      screen.getByText(
        "To make new recovery codes, first confirm it's you with your authenticator app or a recovery code.",
      ),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: "Confirm it's you" });
    expect(link.getAttribute("href")).toBe("/totp?callbackUrl=%2Faccount%2F2fa");
    expect(screen.queryByRole("button", { name: /regenerate recovery codes/i })).toBeNull();
  });

  it("P5b: with a callbackUrl the link returns to this page WITH the sanitized callbackUrl", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: false }));
    await renderPage({ callbackUrl: "/admin" });
    expect(screen.getByRole("link", { name: "Confirm it's you" }).getAttribute("href")).toBe(
      "/totp?callbackUrl=%2Faccount%2F2fa%3FcallbackUrl%3D%252Fadmin",
    );
  });

  it("P5c: a hostile callbackUrl is replaced by /launch inside the link", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: false }));
    await renderPage({ callbackUrl: "//evil.example" });
    const href = screen.getByRole("link", { name: "Confirm it's you" }).getAttribute("href") ?? "";
    expect(href).toBe("/totp?callbackUrl=%2Faccount%2F2fa%3FcallbackUrl%3D%252Flaunch");
    expect(href).not.toContain("evil");
  });

  it("P5d: not required but unverified is still refused on the page (same predicate as the action)", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorRequired: false, twoFactorVerified: false }));
    await renderPage();
    expect(screen.getByRole("link", { name: "Confirm it's you" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /regenerate recovery codes/i })).toBeNull();
  });

  it("P6: enrolled and verified -> the Regenerate button and no notice", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: true }));
    await renderPage();
    expect(screen.getByRole("button", { name: /regenerate recovery codes/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Confirm it's you" })).toBeNull();
    expect(screen.queryByText(/first confirm it's you/i)).toBeNull();
  });

  it("the unused-code count and enrolment date still render in both states", async () => {
    dbh.recoveryRows = [{ usedAt: null }, { usedAt: new Date() }, { usedAt: null }];
    await renderPage();
    expect(screen.getByText(/2 unused codes remaining \(of 3 total\)/)).toBeTruthy();
    expect(screen.getByText(/you enrolled on/i)).toBeTruthy();
  });
});
