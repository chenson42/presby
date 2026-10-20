// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { FIXTURE_TARGETS, fixtureGroups, fixturePair, fixtureRow, observation } from "@/lib/domains/checklist-fixtures";
import type { OrgDomainsForPlatform } from "@/lib/domains/platform-read";

vi.mock("./domains-actions", () => ({
  checkDomainPlatformAction: vi.fn(),
  setDomainHoldAction: vi.fn(),
  forceReleaseDomainAction: vi.fn(),
  setOrgDomainFeatureAction: vi.fn(),
  claimDomainForOrgAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DomainsSection } from "./domains-section";

afterEach(cleanup);

function data(over: Partial<OrgDomainsForPlatform> = {}): OrgDomainsForPlatform {
  return {
    groups: [],
    siteStatus: "live",
    toggles: { "org_portal.domains": true, "org_portal.mail_domain": false },
    daysInState: {},
    history: [],
    ...over,
  };
}
const renderSection = (d = data()) => render(<DomainsSection organizationId="org-1" organizationName="Alder Creek Church" data={d} />);

describe("DomainsSection", () => {
  it("empty and on: says there are no domains, offers the on-behalf claim and the toggles", () => {
    renderSection();
    expect(screen.getByRole("heading", { name: "Domains" })).toBeTruthy();
    expect(screen.getByText(/Alder Creek Church has no domains/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Record a claim on this organization.s behalf/ })).toBeTruthy();
    expect(screen.getByText("Website domain:", { exact: false })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All domains" }).getAttribute("href")).toBe("/admin/organizations/domains");
  });

  it("with the website toggle off it says so and offers no claim form", () => {
    renderSection(data({ toggles: { "org_portal.domains": false, "org_portal.mail_domain": false } }));
    expect(screen.getByText(/Website domains are off for Alder Creek Church/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Record a claim/ })).toBeNull();
  });

  it("shows exactly the claim card the church sees, with the platform controls on each host and the support facts", () => {
    const rows = fixturePair("live", {
      lastCheckClass: "ok",
      lastCheckedAt: new Date("2030-01-02T00:00:00Z"),
      stateChangedAt: new Date("2030-01-01T00:00:00Z"),
      observation: observation({ targets: FIXTURE_TARGETS }),
    });
    const groups = fixtureGroups(rows);
    renderSection(data({ groups, daysInState: { [rows[0]!.id]: 3, [rows[1]!.id]: 1 } }));
    const card = screen.getByTestId("claim-card");
    expect(within(card).getByRole("heading", { name: "church-one.invalid" })).toBeTruthy();
    expect(within(card).getAllByRole("button", { name: /^Pause / })).toHaveLength(2);
    expect(within(card).getAllByRole("button", { name: /^Force-release / })).toHaveLength(2);
    const facts = screen.getByTestId("platform-support-facts");
    expect(facts.textContent).toMatch(/Healthy/);
    expect(facts.textContent).toMatch(/3 days in this state/);
    expect(facts.textContent).toMatch(/1 day in this state/);
    // the platform view has no church-side buttons and no copy-all
    expect(within(card).getAllByRole("button", { name: /^Check now / })).toHaveLength(2); // the PLATFORM check, one per host
    expect(within(card).queryByRole("button", { name: /Copy all records/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("a last-check error class reads in words, not as a code", () => {
    const rows = fixturePair("attach_pending", { lastCheckClass: "provider_unavailable" });
    renderSection(data({ groups: fixtureGroups(rows) }));
    expect(screen.getByTestId("platform-support-facts").textContent).toMatch(/Hosting provider unavailable/);
    expect(screen.getByTestId("platform-support-facts").textContent).not.toMatch(/provider_unavailable/);
  });

  it("flags a primary address that isn't serving while another is live", () => {
    const groups = fixtureGroups([
      fixtureRow({ hostname: "www.church-one.invalid", state: "lapsed", webRole: "canonical" }),
      fixtureRow({ hostname: "www.other.invalid", claimName: "other.invalid", state: "live", webRole: "alias" }),
    ]);
    renderSection(data({ groups }));
    expect(screen.getByTestId("platform-primary-advisory").textContent).toMatch(/isn.t serving while www\.other\.invalid is live/);
  });

  it("notes an unpublished site, and lists released/expired hosts as history", () => {
    renderSection(
      data({
        siteStatus: "provisioning",
        history: [
          { id: "h1", hostname: "old.invalid", state: "released", releaseCause: "force_released", at: "2030-01-01T00:00:00.000Z" },
          { id: "h2", hostname: "never.invalid", state: "expired", releaseCause: null, at: "2030-01-02T00:00:00.000Z" },
        ],
      }),
    );
    expect(screen.getByText(/public site is provisioning/)).toBeTruthy();
    expect(screen.getByText(/Released \(force released\)/)).toBeTruthy();
    expect(screen.getByText(/Expired/)).toBeTruthy();
  });
});
