// @vitest-environment jsdom
/**
 * Tests for the genericized `DomainTileSections` — commit 1 of docs/work-
 * log/2026-08-27-platform-home-and-portal.md (Phase 3, DECISION-125). Two
 * fixtures prove the generic bound is satisfied by both real axis shapes:
 * a `PortalTile`-shaped array with a slug-closure `getHref` and its own
 * seven-domain taxonomy, and an `AdminTile`-shaped array with a
 * plain-string `getHref` and the new three-domain taxonomy. Neither this
 * file nor the component under test imports `@/lib/org-portal/tiles` or
 * `@/lib/admin-portal/tiles` — domain order/labels are passed as props by
 * the caller, which is the whole point of the genericization.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DomainTileSections } from "./domain-tile-sections";
import type { TileLike } from "./tile-grid";

afterEach(cleanup);

type OrgDomain = "people" | "worship" | "governance";
interface OrgTileFixture extends TileLike<OrgDomain> {
  href: (slug: string) => string;
}

const ORG_DOMAIN_ORDER: readonly OrgDomain[] = ["people", "worship", "governance"];
const ORG_DOMAIN_LABELS: Record<OrgDomain, string> = {
  people: "People & Membership",
  worship: "Worship & Events",
  governance: "Governance & Courts",
};

function orgTile(overrides: Partial<OrgTileFixture> & Pick<OrgTileFixture, "key" | "domain">): OrgTileFixture {
  return {
    label: overrides.key,
    description: `${overrides.key} description.`,
    href: (slug: string) => `/o/${slug}/${overrides.key}`,
    ...overrides,
  };
}

describe("DomainTileSections — org-portal axis (slug-closure getHref)", () => {
  it("renders one section per non-empty domain, in domainOrder order, with the correct heading text", () => {
    const tiles: OrgTileFixture[] = [
      orgTile({ key: "events", label: "Events", domain: "worship" }),
      orgTile({ key: "directory", label: "Directory", domain: "people" }),
      orgTile({ key: "officers", label: "Officers", domain: "governance" }),
    ];

    render(
      <DomainTileSections
        tiles={tiles}
        getHref={(tile) => tile.href("alder-creek")}
        domainOrder={ORG_DOMAIN_ORDER}
        domainLabels={ORG_DOMAIN_LABELS}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "People & Membership",
      "Worship & Events",
      "Governance & Courts",
    ]);
  });

  it("gives each section the domain-<key> id", () => {
    const tiles: OrgTileFixture[] = [
      orgTile({ key: "directory", label: "Directory", domain: "people" }),
    ];

    render(
      <DomainTileSections
        tiles={tiles}
        getHref={(tile) => tile.href("alder-creek")}
        domainOrder={ORG_DOMAIN_ORDER}
        domainLabels={ORG_DOMAIN_LABELS}
      />,
    );

    expect(document.getElementById("domain-people")).toBeTruthy();
  });

  it("a domain with zero matching tiles produces no section or heading at all", () => {
    const tiles: OrgTileFixture[] = [
      orgTile({ key: "directory", label: "Directory", domain: "people" }),
    ];

    render(
      <DomainTileSections
        tiles={tiles}
        getHref={(tile) => tile.href("alder-creek")}
        domainOrder={ORG_DOMAIN_ORDER}
        domainLabels={ORG_DOMAIN_LABELS}
      />,
    );

    expect(document.getElementById("domain-worship")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Worship & Events" })).toBeNull();
  });

  it("renders null for an empty tile list", () => {
    const { container } = render(
      <DomainTileSections
        tiles={[]}
        getHref={() => ""}
        domainOrder={ORG_DOMAIN_ORDER}
        domainLabels={ORG_DOMAIN_LABELS}
      />,
    );

    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});

describe("DomainTileSections — admin-portal axis (plain-string getHref, three-domain taxonomy)", () => {
  type AdminDomain = "people_access" | "platform_operations" | "content_communications";
  interface AdminTileFixture extends TileLike<AdminDomain> {
    href: string;
  }

  const ADMIN_DOMAIN_ORDER: readonly AdminDomain[] = [
    "people_access",
    "platform_operations",
    "content_communications",
  ];
  const ADMIN_DOMAIN_LABELS: Record<AdminDomain, string> = {
    people_access: "People & Access",
    platform_operations: "Platform Operations",
    content_communications: "Content & Communications",
  };

  it("buckets AdminTile-shaped tiles under the three-domain taxonomy, in order", () => {
    const tiles: AdminTileFixture[] = [
      {
        key: "tickets",
        label: "Tickets",
        description: "Triage tickets.",
        href: "/admin/tickets",
        domain: "content_communications",
      },
      {
        key: "users",
        label: "Users & roles",
        description: "Assign roles.",
        href: "/admin/users",
        domain: "people_access",
      },
    ];

    render(
      <DomainTileSections
        tiles={tiles}
        getHref={(tile) => tile.href}
        domainOrder={ADMIN_DOMAIN_ORDER}
        domainLabels={ADMIN_DOMAIN_LABELS}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "People & Access",
      "Content & Communications",
    ]);
    const link = screen.getByRole("link", { name: /users & roles/i });
    expect(link.getAttribute("href")).toBe("/admin/users");
  });
});
