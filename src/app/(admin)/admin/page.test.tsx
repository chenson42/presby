// @vitest-environment jsdom
/**
 * Orchestration tests for `/admin`'s page.tsx — commit 1 of docs/work-log/
 * 2026-08-27-platform-home-and-portal.md (Phase 3, DECISION-123/125). Pins:
 *
 * The tile grid is retired (platform admin redesign, Increment 1); the
 * tile assertions that stood here are replaced, and Batch C re-pins the card
 * zones (E1-E4). What remains pinned:
 *
 *   1. A session holding tool keys does not get the door-only empty state.
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

describe("AdminDashboard — a session holding tool keys", () => {
  it("does not render the door-only empty state (Batch C adds the cards)", async () => {
    mockAuth.mockResolvedValue(
      session([FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TICKETS, FEATURES.ADMIN_FEEDBACK]),
    );

    render(await AdminDashboard());

    expect(
      screen.queryByText(/don.t have access to any admin tools/i),
    ).toBeNull();
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
