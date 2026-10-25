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
