// @vitest-environment jsdom
/**
 * The async card wrappers, called directly (RTL cannot render an async server
 * component inside Suspense). Readers are mocked; the point is the wiring:
 * title, destination, and that a failed read renders the error state, never
 * a zero.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const readers = vi.hoisted(() => ({
  readTicketsCard: vi.fn(),
  readFeedbackCard: vi.fn(),
  readEmailCard: vi.fn(),
  readGivingCard: vi.fn(),
  readDomainsCard: vi.fn(),
  readSitesCard: vi.fn(),
  readTwoFactorCard: vi.fn(),
  readAccountsCard: vi.fn(),
  readOrganizationsCard: vi.fn(),
  readRecentChangesCard: vi.fn(),
}));
vi.mock("@/lib/admin-portal/dashboard/tickets", () => ({ readTicketsCard: readers.readTicketsCard }));
vi.mock("@/lib/admin-portal/dashboard/feedback", () => ({ readFeedbackCard: readers.readFeedbackCard }));
vi.mock("@/lib/admin-portal/dashboard/email", () => ({ readEmailCard: readers.readEmailCard }));
vi.mock("@/lib/admin-portal/dashboard/giving", () => ({ readGivingCard: readers.readGivingCard }));
vi.mock("@/lib/admin-portal/dashboard/domains", () => ({ readDomainsCard: readers.readDomainsCard }));
vi.mock("@/lib/admin-portal/dashboard/sites", () => ({ readSitesCard: readers.readSitesCard }));
vi.mock("@/lib/admin-portal/dashboard/two-factor", () => ({ readTwoFactorCard: readers.readTwoFactorCard }));
vi.mock("@/lib/admin-portal/dashboard/accounts", () => ({ readAccountsCard: readers.readAccountsCard }));
vi.mock("@/lib/admin-portal/dashboard/organizations", () => ({ readOrganizationsCard: readers.readOrganizationsCard }));
vi.mock("@/lib/admin-portal/dashboard/recent-changes", () => ({ readRecentChangesCard: readers.readRecentChangesCard }));

import {
  AccountsCardView,
  DASHBOARD_CARD_VIEWS,
  DomainsCardView,
  EmailCardView,
  FeedbackCardView,
  GivingCardView,
  OrganizationsCardView,
  SitesCardView,
  TicketsCardView,
  TwoFactorCardView,
} from "./cards";
import { DASHBOARD_CARDS } from "./registry";

afterEach(() => {
  cleanup();
  for (const r of Object.values(readers)) r.mockReset();
});

describe("every registry card has a view", () => {
  it("the map covers exactly the registry ids", () => {
    expect(Object.keys(DASHBOARD_CARD_VIEWS).sort()).toEqual(
      DASHBOARD_CARDS.map((c) => c.id).sort(),
    );
  });
});

describe("card wrappers", () => {
  it.each([
    ["Tickets", TicketsCardView, readers.readTicketsCard, "/admin/tickets"],
    ["Feedback", FeedbackCardView, readers.readFeedbackCard, "/admin/feedback"],
    ["Email queue", EmailCardView, readers.readEmailCard, "/admin/email-queue"],
    ["Giving notices", GivingCardView, readers.readGivingCard, "/admin/giving"],
    ["Domains", DomainsCardView, readers.readDomainsCard, "/admin/organizations/domains"],
    ["Sites", SitesCardView, readers.readSitesCard, "/admin/sites"],
    ["Two-factor", TwoFactorCardView, readers.readTwoFactorCard, "/admin/2fa"],
    ["Locked accounts", AccountsCardView, readers.readAccountsCard, "/admin/users"],
  ] as const)("%s: a failed read renders the error state and no all-clear", async (title, View, reader, _href) => {
    reader.mockResolvedValue({ kind: "error" });
    render(await View());
    expect(screen.getByRole("heading", { level: 3, name: title })).toBeTruthy();
    expect(screen.getByText("We can't load this right now.")).toBeTruthy();
    expect(screen.queryByText("Nothing waiting.")).toBeNull();
    expect(screen.queryAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/admin"]);
  });

  it.each([
    ["Tickets", TicketsCardView, readers.readTicketsCard, { kind: "ok", newCount: 0, unassignedOpen: 0, oldestNewSeconds: null }, "/admin/tickets"],
    ["Feedback", FeedbackCardView, readers.readFeedbackCard, { kind: "ok", newCount: 0 }, "/admin/feedback"],
    ["Email queue", EmailCardView, readers.readEmailCard, { kind: "ok", failed: 0, overdue: 0 }, "/admin/email-queue"],
    ["Giving notices", GivingCardView, readers.readGivingCard, { kind: "ok", connections: 0, waiting: 0, deadLetters: 0, restricted: 0 }, "/admin/giving"],
    ["Domains", DomainsCardView, readers.readDomainsCard, { kind: "ok", needAttention: 0 }, "/admin/organizations/domains"],
    ["Sites", SitesCardView, readers.readSitesCard, { kind: "ok", live: 0, provisioning: 0, suspended: 0 }, "/admin/sites"],
    ["Two-factor", TwoFactorCardView, readers.readTwoFactorCard, { kind: "ok", notEnrolled: 0 }, "/admin/2fa"],
    ["Locked accounts", AccountsCardView, readers.readAccountsCard, { kind: "ok", locked: 0 }, "/admin/users"],
  ] as const)("%s: a clean read is an all-clear linking to its destination", async (title, View, reader, ok, href) => {
    reader.mockResolvedValue(ok);
    render(await View());
    expect(screen.getByRole("heading", { level: 3, name: title })).toBeTruthy();
    expect(screen.getByText("Nothing waiting.")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(href);
  });

  it("Organizations at a glance links to the list, or to the create page when empty", async () => {
    readers.readOrganizationsCard.mockResolvedValue({
      kind: "ok",
      total: 2,
      byType: { general_assembly: 0, synod: 0, presbytery: 0, congregation: 2, new_worshiping_community: 0 },
      byStatus: { managed: 2, invited: 0, unmanaged: 0 },
      inactive: 0,
      defaultPalette: 0,
    });
    render(await OrganizationsCardView());
    expect(screen.getByText("2 organizations")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/admin/organizations");
    cleanup();

    readers.readOrganizationsCard.mockResolvedValue({
      kind: "ok",
      total: 0,
      byType: { general_assembly: 0, synod: 0, presbytery: 0, congregation: 0, new_worshiping_community: 0 },
      byStatus: { managed: 0, invited: 0, unmanaged: 0 },
      inactive: 0,
      defaultPalette: 0,
    });
    render(await OrganizationsCardView());
    expect(screen.getByText("No organizations yet.")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/admin/organizations/new");
  });

  it("an attention state links to the pre-filtered destination", async () => {
    readers.readDomainsCard.mockResolvedValue({ kind: "ok", needAttention: 2 });
    render(await DomainsCardView());
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/admin/organizations/domains?filter=attention",
    );
  });
});
