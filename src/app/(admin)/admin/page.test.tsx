// @vitest-environment jsdom
/**
 * Orchestration tests for `/admin`'s page.tsx — commit 1 of docs/work-log/
 * 2026-08-27-platform-home-and-portal.md (Phase 3, DECISION-123/125). Pins:
 *
 *   1. A support_operator-shaped session (post seed-fix, ADMIN_DASHBOARD +
 *      ADMIN_TICKETS + ADMIN_FEEDBACK) sees exactly 2 tiles, both under
 *      "Content & Communications" — the acceptance criterion this whole
 *      pipeline is built around.
 *   2. A full-admin-shaped session (every FEATURES.* value) sees all 10
 *      tiles across all 3 domains.
 *   3. An ADMIN_DASHBOARD-only session sees the honest empty state, not a
 *      blank grid.
 *   4. The GreetingBand renders in place of the old bare <h1> + roles
 *      paragraph.
 *   5. The retired demo.new_dashboard banner is gone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FEATURES } from "@/lib/permissions";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import AdminDashboard from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
});

function session(features: string[], name = "Sam") {
  return { user: { name, features } };
}

describe("AdminDashboard — support_operator-shaped session (the acceptance criterion)", () => {
  it("renders exactly 2 tiles, both under Content & Communications, and no empty state", async () => {
    mockAuth.mockResolvedValue(
      session([FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TICKETS, FEATURES.ADMIN_FEEDBACK]),
    );

    const el = await AdminDashboard();
    render(el);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(screen.getByRole("link", { name: /feedback/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /tickets/i })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Content & Communications" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "People & Access" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Platform Operations" })).toBeNull();
    expect(
      screen.queryByText(/don.t have access to any admin tools/i),
    ).toBeNull();
  });
});

describe("AdminDashboard — full admin session", () => {
  it("renders all 10 tiles across all 3 domains", async () => {
    mockAuth.mockResolvedValue(session(Object.values(FEATURES)));

    const el = await AdminDashboard();
    render(el);

    expect(screen.getAllByRole("link")).toHaveLength(10);
    expect(screen.getByRole("heading", { name: "People & Access" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Platform Operations" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Content & Communications" }),
    ).toBeTruthy();
  });
});

describe("AdminDashboard — ADMIN_DASHBOARD-only session (the reachable empty-state edge case)", () => {
  it("renders the honest empty state, not a blank grid", async () => {
    mockAuth.mockResolvedValue(session([FEATURES.ADMIN_DASHBOARD]));

    const el = await AdminDashboard();
    render(el);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(
      screen.getByText(/you don.t have access to any admin tools yet/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/contact a platform administrator/i),
    ).toBeTruthy();
  });
});

describe("AdminDashboard — GreetingBand replaces the old bare <h1>", () => {
  it("renders a level-1 heading greeting the signed-in user by name", async () => {
    mockAuth.mockResolvedValue(session([FEATURES.ADMIN_DASHBOARD], "Jamie"));

    const el = await AdminDashboard();
    render(el);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/Jamie\.$/);
  });

  it("degrades to a generic welcome when the session has no name", async () => {
    mockAuth.mockResolvedValue({ user: { features: [FEATURES.ADMIN_DASHBOARD] } });

    const el = await AdminDashboard();
    render(el);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Welcome.",
    );
  });
});

describe("AdminDashboard — demo.new_dashboard retirement", () => {
  it("never renders the retired 'New dashboard preview' banner", async () => {
    mockAuth.mockResolvedValue(session(Object.values(FEATURES)));

    const el = await AdminDashboard();
    render(el);

    expect(screen.queryByText(/new dashboard preview/i)).toBeNull();
  });
});
