// @vitest-environment jsdom
/**
 * The three organization pages used to say "You don't have permission to
 * manage organization branding." to a viewer who lacks ADMIN_ORGANIZATIONS: a
 * sentence that under-described the key. They now render AdminForbidden (Copy
 * group G) and, for the list, the corrected description (group H). A viewer
 * without the key reads nothing from the database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FEATURES } from "@/lib/permissions";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("server-only", () => ({}));
const getPlatformDb = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", async () => {
  await import("@/lib/db/schema");
  return { getPlatformDb, db: {} };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

import OrganizationsListPage from "./page";
import NewOrganizationPage from "./new/page";
import OrganizationDetailPage from "./[id]/page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  getPlatformDb.mockReset();
});

const noKey = () =>
  mockAuth.mockResolvedValue({ user: { features: [FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TICKETS] } });

describe("organization pages without ADMIN_ORGANIZATIONS", () => {
  it.each([
    ["list", "Organizations", () => OrganizationsListPage({ searchParams: Promise.resolve({}) })],
    ["new", "New organization", () => NewOrganizationPage()],
    ["detail", "Organization", () => OrganizationDetailPage({ params: Promise.resolve({ id: "x" }) })],
  ] as const)("%s renders AdminForbidden and touches no database", async (_n, title, page) => {
    noKey();
    render(await page());
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(
      screen.getByText(
        "Your account doesn't include managing organizations. Ask a platform administrator if you need it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/organization branding/i)).toBeNull();
    expect(getPlatformDb).not.toHaveBeenCalled();
  });
});
