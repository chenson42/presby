// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const listDomains = vi.hoisted(() => vi.fn());
vi.mock("@/lib/domains/platform-read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/domains/platform-read")>("@/lib/domains/platform-read");
  return { ...actual, listDomainsAcrossOrgs: (...a: unknown[]) => listDomains(...a) };
});
vi.mock("server-only", () => ({}));
// platform-read's real parsePlatformListFilter is used; its database module is faked so importing it needs no connection.
vi.mock("@/lib/db", async () => {
  await import("@/lib/db/schema");
  return { getPlatformDb: vi.fn() };
});

import { FEATURES } from "@/lib/permissions";
import DomainsOverviewPage from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  listDomains.mockReset();
});

const asAdmin = () => mockAuth.mockResolvedValue({ user: { features: [FEATURES.ADMIN_ORGANIZATIONS] } });
const renderPage = async (filter?: string) => render(await DomainsOverviewPage({ searchParams: Promise.resolve({ filter }) }));
const row = (over = {}) => ({
  id: "d1",
  hostname: "church-one.invalid",
  organizationId: "org-1",
  organizationName: "Alder Creek Church",
  purpose: "web" as const,
  state: "live" as const,
  hold: null,
  role: "canonical" as const,
  lastCheckClass: "ok",
  lastCheckedAt: "2030-01-02T00:00:00.000Z",
  lastVerifiedAt: "2030-01-02T00:00:00.000Z",
  daysAttachedNotLive: null,
  ...over,
});

describe("DomainsOverviewPage", () => {
  it("is gated on ADMIN_ORGANIZATIONS and reads nothing without it", async () => {
    mockAuth.mockResolvedValue({ user: { features: [] } });
    await renderPage();
    expect(document.body.textContent).toMatch(/don.t have permission to manage organization domains/);
    expect(listDomains).not.toHaveBeenCalled();
  });

  it("lists each host with its organization (linked), state, hold, role, last check and last confirmation", async () => {
    asAdmin();
    listDomains.mockResolvedValue({
      rows: [row(), row({ id: "d2", hostname: "other.invalid", state: "attached", hold: "paused", role: "alias", lastCheckClass: "provider_unavailable", lastVerifiedAt: null, daysAttachedNotLive: 4 })],
      truncated: false,
    });
    await renderPage();
    const live = document.querySelector('[data-domain="church-one.invalid"]') as HTMLElement;
    expect(within(live).getByRole("link", { name: "Alder Creek Church" }).getAttribute("href")).toBe("/admin/organizations/org-1");
    expect(live.textContent).toMatch(/Live/);
    expect(live.textContent).toMatch(/Primary/);
    expect(live.textContent).toMatch(/Healthy/);
    const held = document.querySelector('[data-domain="other.invalid"]') as HTMLElement;
    expect(held.textContent).toMatch(/Paused/);
    expect(held.textContent).toMatch(/Alias/);
    expect(held.textContent).toMatch(/Hosting unavailable/);
    expect(held.textContent).toMatch(/Never/);
    expect(held.textContent).toMatch(/4 days/);
    expect(held.textContent).not.toMatch(/provider_unavailable/);
  });

  it("passes the filter through (an unknown one falls back to all) and marks the current filter", async () => {
    asAdmin();
    listDomains.mockResolvedValue({ rows: [row()], truncated: false });
    await renderPage("attention");
    expect(listDomains).toHaveBeenCalledWith("attention");
    expect(screen.getByRole("link", { name: "Needs attention" }).getAttribute("aria-current")).toBe("page");
    cleanup();
    listDomains.mockClear();
    await renderPage("bogus");
    expect(listDomains).toHaveBeenCalledWith("all");
  });

  it("empty: tells a platform admin the next action; an empty filter says nothing matches", async () => {
    asAdmin();
    listDomains.mockResolvedValue({ rows: [], truncated: false });
    await renderPage();
    expect(screen.getByTestId("domains-list-empty").textContent).toMatch(/Turn on Website domain for an organization/);
    cleanup();
    await renderPage("live");
    expect(screen.getByTestId("domains-list-empty").textContent).toBe("Nothing matches this filter.");
  });

  it("a failed read is an alert in plain words, not an empty list", async () => {
    asAdmin();
    listDomains.mockRejectedValue(new Error("connection terminated"));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/couldn.t load the domains right now/);
    expect(screen.queryByTestId("domains-list-empty")).toBeNull();
    expect(document.body.textContent).not.toMatch(/connection terminated/);
  });

  it("says when the list was cut off", async () => {
    asAdmin();
    listDomains.mockResolvedValue({ rows: [row()], truncated: true });
    await renderPage();
    expect(document.body.textContent).toMatch(/Showing the first 1/);
  });
});
