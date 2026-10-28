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

const cfg = vi.hoisted(() => ({ configured: true }));
vi.mock("@/lib/two-factor", () => ({
  isTotpConfigured: () => cfg.configured,
}));
vi.mock("@/lib/totp-pending", () => ({
  PENDING_TTL_MINUTES: 10,
  getOrCreatePendingEnrollment: vi.fn(async () => ({ uri: "otpauth://totp/x", secret: "SECRET" })),
}));

vi.mock("./actions", () => ({
  completeEnrollment: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("qrcode", () => ({ toDataURL: async () => "data:image/png;base64,AAAA" }));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AccountTwoFactorPage from "./page";
import { EnrolmentHandoff } from "./enrolment-handoff";

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
  cfg.configured = true;
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

// ---------------------------------------------------------------------------
// F166 - the holder is the root of EVERY branch (DECISION-292, R2)
//
// completeEnrollment marks the session verified, which writes the session
// cookie, which makes Next re-render this route. The recovery codes live in
// EnrolmentHandoff's state; React keeps that state only if the component at the
// root has the same type, position and key before and after. These tests are
// the pin: a fourth branch added without the holder, or a `key` on it, fails
// here and not in a browser a month later.
// ---------------------------------------------------------------------------

async function rootOf(searchParams: { callbackUrl?: string } = {}) {
  return (await AccountTwoFactorPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement<{
    callbackUrl: string;
  }>;
}

describe("/account/2fa roots - F166", () => {
  it("P1: the enrolled, not-configured and enrol-form branches all return EnrolmentHandoff at the root, with the sanitized callbackUrl and no key", async () => {
    const enrolled = await rootOf({ callbackUrl: "/admin" });

    cfg.configured = false;
    dbh.totp = undefined;
    const notConfigured = await rootOf({ callbackUrl: "/admin" });

    cfg.configured = true;
    dbh.totp = undefined;
    const enrolForm = await rootOf({ callbackUrl: "/admin" });

    for (const root of [enrolled, notConfigured, enrolForm]) {
      expect(root.type).toBe(EnrolmentHandoff);
      expect(root.props.callbackUrl).toBe("/admin");
      expect(root.key).toBeNull();
    }
  });

  it("P2: a hostile callbackUrl becomes /launch on the holder and on the management Continue", async () => {
    for (const hostile of ["//evil.example", "/\\evil.example", "/.//evil.example", "/\t/evil.example", "https://evil.example/x"]) {
      cleanup();
      mockAuth.mockResolvedValue(session({ twoFactorVerified: true }));
      dbh.totp = { enrolledAt: new Date("2026-10-01T12:00:00Z"), lastUsedAt: null };
      const root = await rootOf({ callbackUrl: hostile });
      expect(root.props.callbackUrl, hostile).toBe("/launch");
      render(root);
      expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href"), hostile).toBe("/launch");
    }
  });

  it("P3: the management view shows a full-width 44px Continue iff the request carried a callbackUrl, to the sanitized value", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: true }));
    await renderPage({ callbackUrl: "/o/example-church" });
    const cont = screen.getByRole("link", { name: "Continue" });
    expect(cont.getAttribute("href")).toBe("/o/example-church");
    expect(cont.className).toContain("min-h-11");
    expect(cont.className).toContain("w-full");
    cleanup();

    await renderPage({});
    expect(screen.queryByRole("link", { name: "Continue" })).toBeNull();
    cleanup();

    await renderPage({ callbackUrl: "" });
    expect(screen.queryByRole("link", { name: "Continue" })).toBeNull();
  });

  it("P3b: the Continue sits directly under the 'You enrolled on' line, above the recovery-code controls (visible without scrolling at 360px)", async () => {
    mockAuth.mockResolvedValue(session({ twoFactorVerified: true }));
    await renderPage({ callbackUrl: "/launch" });
    const cont = screen.getByRole("link", { name: "Continue" });
    const enrolledLine = screen.getByText(/you enrolled on/i);
    const regenerate = screen.getByRole("button", { name: /regenerate recovery codes/i });
    expect(enrolledLine.compareDocumentPosition(cont) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cont.compareDocumentPosition(regenerate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("P4: source scan - every `return (` in page.tsx opens with <EnrolmentHandoff callbackUrl={callbackUrl}>, and there are three", () => {
    const src = readFileSync(resolve(__dirname, "page.tsx"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const returns = [...src.matchAll(/return \(\s*(<[^>]*>)/g)].map((m) => m[1]);
    expect(returns).toHaveLength(3);
    for (const opening of returns) expect(opening).toBe("<EnrolmentHandoff callbackUrl={callbackUrl}>");
    expect(src).not.toMatch(/<EnrolmentHandoff[^>]*\bkey=/);
  });
});
