// @vitest-environment jsdom
/**
 * The 2FA policy page's "Required, but not enrolled" list is capped. When the
 * cap hides accounts the page says so, with the true total from the same
 * predicate the dashboard card counts with (src/lib/admin/two-factor-stranded.ts),
 * so the list and the card cannot silently disagree. The DB test pins `total`;
 * this pins what the page says about it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FEATURES } from "@/lib/permissions";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => {
  await import("@/lib/db/schema");
  return { getPlatformDb: () => ({ execute: async () => ({ rows: [] }) }), db: {} };
});
const listStranded = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/two-factor-stranded", () => ({ listStranded }));
vi.mock("./policy-toggle", () => ({ TwoFactorPolicyToggle: () => null }));

import TwoFactorPolicyPage from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  listStranded.mockReset();
});

const holder = () =>
  mockAuth.mockResolvedValue({ user: { features: [FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TWO_FACTOR] } });

const account = (n: number) => ({ id: `u${n}`, email: `person${n}@example.invalid`, name: null, source: "organization" });

describe("two-factor policy page, truncation note", () => {
  it("says how many of the total are shown when the list is capped", async () => {
    holder();
    listStranded.mockResolvedValue({ rows: [account(1), account(2)], total: 7 });
    render(await TwoFactorPolicyPage());
    expect(screen.getByText("Showing the first 2 of 7 accounts.")).toBeTruthy();
    expect(screen.getAllByText("Manage")).toHaveLength(2);
  });

  it("says nothing about a cap when every account is listed", async () => {
    holder();
    listStranded.mockResolvedValue({ rows: [account(1), account(2)], total: 2 });
    render(await TwoFactorPolicyPage());
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("shows the empty line, and no cap note, when nobody is stranded", async () => {
    holder();
    listStranded.mockResolvedValue({ rows: [], total: 0 });
    render(await TwoFactorPolicyPage());
    expect(screen.getByText("Nobody is required without being enrolled.")).toBeTruthy();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });
});

// F343 (DECISION-291), Copy S1 to S3: the page says the three sources of a
// requirement, hedges on enforcement, and labels each row by why it is there.
const text = (container: HTMLElement) => (container.textContent ?? "").replace(/\s+/g, " ");

describe("two-factor policy page, copy (F343)", () => {
  it("S1: the intro names the three sources and the platform-administrator sentence, and no longer says 'opt-in per congregation'", async () => {
    holder();
    listStranded.mockResolvedValue({ rows: [], total: 0 });
    const { container } = render(await TwoFactorPolicyPage());
    const t = text(container);
    expect(t).not.toMatch(/opt-in per congregation/);
    expect(t).toContain(
      "When two-factor enforcement is on for the installation, a person is required to use two-factor sign-in if any one of these is true: their own account setting requires it, they hold a role that requires it (giving, creating and granting roles, or website domains), or a congregation they belong to requires it. The stricter setting wins, because the requirement is resolved at sign-in, before anyone has chosen an organization.",
    );
    expect(t).toContain(
      "A platform administrator's own setting is switched on when the role is granted through the application. It can be switched off on their user page; a role or a congregation's policy cannot be switched off there.",
    );
    expect(t).toContain("Enrolling in two-factor for your own account is at Account → Two-factor. Resetting someone else's is on their user page.");
  });

  it("S2: the blurb is conditional on enforcement, says what happens, and does not claim release or a code they cannot produce", async () => {
    holder();
    listStranded.mockResolvedValue({ rows: [account(1)], total: 1 });
    const { container } = render(await TwoFactorPolicyPage());
    const t = text(container);
    expect(t).toContain(
      "These accounts are required to use two-factor but have not set it up yet. While enforcement is on, they are taken to set it up before they can open the admin area or a congregation's portal. Open an account to see or change its own setting; a role or a congregation's policy still applies when its own setting is off.",
    );
    expect(t).not.toMatch(/code they cannot produce/);
    expect(t).not.toMatch(/exempt them/);
  });

  it("S3: 'Required by' shows Own setting, Congregation policy and A role, and any other value as is", async () => {
    holder();
    const row = (n: number, source: string) => ({ ...account(n), source });
    listStranded.mockResolvedValue({
      rows: [row(1, "this user"), row(2, "congregation"), row(3, "role"), row(4, "organization")],
      total: 4,
    });
    render(await TwoFactorPolicyPage());
    expect(screen.getByText("Own setting")).toBeTruthy();
    expect(screen.getByText("Congregation policy")).toBeTruthy();
    expect(screen.getByText("A role")).toBeTruthy();
    expect(screen.getByText("organization")).toBeTruthy();
  });
});
