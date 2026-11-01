// @vitest-environment jsdom
/**
 * Orchestration tests for `/admin`'s page.tsx (platform admin redesign,
 * Increment 1, Batch C). The card components are replaced with synchronous
 * stubs (RTL cannot render an async server component inside Suspense), which
 * also lets the test prove that a card is MOUNTED ONLY for a holder of its key
 * (E4). Pins:
 *
 *   E1  a support operator sees exactly the Support cards, no find box, no
 *       "New organization"
 *   E2  a door-only viewer gets the honest empty state and no zones/cards
 *   E3  a full operator sees every zone and the recent-changes card
 *   E4  a non-holder's card component is never called
 *   plus the GreetingBand (testid kept) and the retired-banner regressions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { FEATURES } from "@/lib/permissions";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

const called = vi.hoisted(() => [] as string[]);
vi.mock("./_dashboard/cards", () => {
  const ids = [
    "organizations", "giving", "domains", "sites", "tickets",
    "feedback", "contact_messages", "email", "two_factor", "accounts", "recent_changes",
  ];
  return {
    DASHBOARD_CARD_VIEWS: Object.fromEntries(
      ids.map((id) => [
        id,
        () => {
          called.push(id);
          return <div data-testid={`card-${id}`}>stub {id}</div>;
        },
      ]),
    ),
  };
});

import AdminDashboard from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  called.length = 0;
});

function session(features: string[], name = "Sam") {
  return { user: { name, features } };
}

const SUPPORT = [FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TICKETS, FEATURES.ADMIN_FEEDBACK];

describe("AdminDashboard - a support operator (E1, E4)", () => {
  it("sees exactly the Support cards, under one Support heading", async () => {
    mockAuth.mockResolvedValue(session(SUPPORT));
    render(await AdminDashboard());

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Support"]);
    expect(screen.getAllByTestId(/^card-/).map((e) => e.dataset.testid)).toEqual([
      "card-tickets",
      "card-feedback",
      "card-contact_messages",
    ]);
    expect(screen.queryByText(/don.t have access to any admin tools/i)).toBeNull();
  });

  it("has no find box and no 'New organization' action", async () => {
    mockAuth.mockResolvedValue(session(SUPPORT));
    render(await AdminDashboard());
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("link", { name: "New organization" })).toBeNull();
    expect(screen.queryByLabelText("Find an organization")).toBeNull();
  });

  it("never calls a card component it does not hold the key for (E4)", async () => {
    mockAuth.mockResolvedValue(session(SUPPORT));
    render(await AdminDashboard());
    expect(called.sort()).toEqual(["contact_messages", "feedback", "tickets"]);
  });
});

describe("AdminDashboard - ADMIN_DASHBOARD-only session (E2)", () => {
  it("renders the honest empty state, no zones, no find box", async () => {
    mockAuth.mockResolvedValue(session([FEATURES.ADMIN_DASHBOARD]));
    render(await AdminDashboard());

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("You don't have access to any admin tools yet.")).toBeTruthy();
    expect(screen.getByText("Contact a platform administrator to request the features you need.")).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryAllByTestId(/^card-/)).toHaveLength(0);
    expect(called).toEqual([]);
  });
});

describe("AdminDashboard - a full operator (E3)", () => {
  it("sees every zone in order with four, four, two and one cards", async () => {
    mockAuth.mockResolvedValue(session(Object.values(FEATURES)));
    render(await AdminDashboard());

    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => within(s).getByRole("heading", { level: 2 }).textContent)).toEqual([
      "Organizations",
      "Support",
      "Access and settings",
      "Recent operator changes",
    ]);
    expect(sections.map((s) => within(s).getAllByTestId(/^card-/).length)).toEqual([4, 4, 2, 1]);
  });

  it("shows the action bar: New organization (a link to /new) and a find form", async () => {
    mockAuth.mockResolvedValue(session(Object.values(FEATURES)));
    render(await AdminDashboard());

    expect(screen.getByRole("link", { name: "New organization" }).getAttribute("href")).toBe(
      "/admin/organizations/new",
    );
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe("/admin/organizations");
    expect(form.getAttribute("method")).toBe("get");
    expect(screen.getByLabelText("Find an organization")).toBeTruthy();
    expect(screen.getByText(/^Updated/)).toBeTruthy();
  });

  it("links nowhere under /o/ (no tenant route from the console)", async () => {
    mockAuth.mockResolvedValue(session(Object.values(FEATURES)));
    const { container } = render(await AdminDashboard());
    expect(container.querySelectorAll('a[href^="/o/"]')).toHaveLength(0);
  });
});

describe("AdminDashboard - mixed keys", () => {
  it("an organizations-only holder gets the action bar and the four Organizations cards, no other zone", async () => {
    mockAuth.mockResolvedValue(session([FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_ORGANIZATIONS]));
    render(await AdminDashboard());
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Organizations"]);
    expect(called.sort()).toEqual(["domains", "giving", "organizations", "sites"]);
    expect(screen.getByRole("search")).toBeTruthy();
  });

  it("a flags-only holder has tools but no card: no false 'no access' message", async () => {
    mockAuth.mockResolvedValue(session([FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_FLAGS]));
    render(await AdminDashboard());
    expect(screen.queryByText(/don.t have access to any admin tools/i)).toBeNull();
    expect(screen.queryAllByTestId(/^card-/)).toHaveLength(0);
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
