// @vitest-environment jsdom
/**
 * The holder branch of the organizations list. `forbidden.test.tsx` covers a
 * viewer WITHOUT ADMIN_ORGANIZATIONS; nothing there fails if the stale
 * description (it still described the page as a brand-colour setter and an
 * abuse-neutralising tool) came back for a viewer who does have the key. The
 * page was rewritten as a council-tree finder in Increment 1 (Copy group H).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FEATURES } from "@/lib/permissions";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("server-only", () => ({}));
const rows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/lib/db", async () => {
  await import("@/lib/db/schema");
  // select().from().leftJoin() resolves to the rows; the page maps them itself.
  const chain = { select: () => chain, from: () => chain, leftJoin: async () => rows.value };
  return { getPlatformDb: () => chain, db: {} };
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

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  rows.value = [];
});

const holder = () =>
  mockAuth.mockResolvedValue({ user: { features: [FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_ORGANIZATIONS] } });

describe("organizations list, ADMIN_ORGANIZATIONS holder", () => {
  it("describes the page as finding and managing an organization, not as a brand-colour tool — regression for the stale list description", async () => {
    holder();
    const { container } = render(await OrganizationsListPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1, name: "Organizations" })).toBeTruthy();
    const description = screen.getByText(/^Find an organization,/);
    expect(description.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Find an organization, see how it is set up, and open it to manage its administrators, brand, public site and domains.",
    );
    expect(container.textContent).not.toMatch(/brand colour|neutralis|abusive tenant/i);
  });
});
