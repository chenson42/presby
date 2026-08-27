// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TileGrid } from "./tile-grid";
import type { PortalTile } from "@/lib/org-portal/tiles";

afterEach(cleanup);

const DIRECTORY_TILE: PortalTile = {
  key: "directory",
  label: "Directory",
  description: "Browse the congregation directory.",
  href: (slug) => `/o/${slug}/directory`,
  flagKey: "org_portal.directory",
  category: "operate",
};

describe("TileGrid — tiles present", () => {
  it("renders a link per visible tile, built from the slug", () => {
    render(<TileGrid slug="alder-creek" tiles={[DIRECTORY_TILE]} />);
    const link = screen.getByRole("link", { name: /directory/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory");
    expect(screen.getByText("Browse the congregation directory.")).toBeTruthy();
  });

  it("applies the tile Button variant's elevated card and hover-lift treatment", () => {
    render(<TileGrid slug="alder-creek" tiles={[DIRECTORY_TILE]} />);
    const link = screen.getByRole("link", { name: /directory/i });
    expect(link.className).toContain("bg-card");
    expect(link.className).toContain("shadow-sm");
    expect(link.className).toContain("hover:shadow-lg");
  });

  it("renders the description at the body TYPE_SCALE role, not dense", () => {
    render(<TileGrid slug="alder-creek" tiles={[DIRECTORY_TILE]} />);
    const description = screen.getByText("Browse the congregation directory.");
    expect(description.className).toContain("text-base");
    expect(description.className).not.toContain("text-sm");
  });

  it("renders a trailing chevron icon pinned to the bottom", () => {
    render(<TileGrid slug="alder-creek" tiles={[DIRECTORY_TILE]} />);
    const link = screen.getByRole("link", { name: /directory/i });
    const icons = link.querySelectorAll("svg");
    // one leading icon (tile-icon map) + one trailing chevron
    expect(icons.length).toBe(2);
  });

  it("renders a mapped icon for a known tile key", () => {
    render(<TileGrid slug="alder-creek" tiles={[DIRECTORY_TILE]} />);
    expect(document.querySelector("svg")).toBeTruthy();
  });

  it("Tile-icon map staleness: falls back to a default icon (never crashes) for an unmapped tile key", () => {
    const futureTile: PortalTile = {
      key: "a-future-tile-key-with-no-icon-mapping",
      label: "Future Tile",
      description: "Not yet in the icon map.",
      href: (slug) => `/o/${slug}/future`,
      flagKey: "org_portal.future",
      category: "operate",
    };
    render(<TileGrid slug="alder-creek" tiles={[futureTile]} />);
    const link = screen.getByRole("link", { name: /future tile/i });
    expect(link.querySelector("svg")).toBeTruthy();
  });
});

describe("TileGrid — icon map (regression for M6, groups/branding sharing LayoutGrid)", () => {
  const GROUPS_TILE: PortalTile = {
    key: "groups",
    label: "Groups",
    description: "Manage committees, small groups, choirs, and teams.",
    href: (slug) => `/o/${slug}/admin/groups`,
    flagKey: "org_portal.groups",
    category: "operate",
  };
  const BRANDING_TILE: PortalTile = {
    key: "branding",
    label: "Branding",
    description: "Set your organization's colour, type pairing, and logo.",
    href: (slug) => `/o/${slug}/admin/branding`,
    flagKey: "org_portal.branding",
    category: "administer",
  };

  it("gives Groups and Branding their own, distinct icon glyphs — not the same LayoutGrid fallback", () => {
    render(<TileGrid slug="alder-creek" tiles={[GROUPS_TILE, BRANDING_TILE]} />);

    const groupsLink = screen.getByRole("link", { name: /groups/i });
    const brandingLink = screen.getByRole("link", { name: /branding/i });
    const groupsIconSvg = groupsLink.querySelector("svg");
    const brandingIconSvg = brandingLink.querySelector("svg");

    expect(groupsIconSvg).toBeTruthy();
    expect(brandingIconSvg).toBeTruthy();
    // lucide-react sets a `class` derived from the component's display name
    // e.g. "lucide-users-round" / "lucide-palette" — comparing these confirms
    // the two glyphs differ, and neither is "lucide-layout-grid" (the shared
    // fallback this finding was about).
    const groupsClass = groupsIconSvg?.getAttribute("class") ?? "";
    const brandingClass = brandingIconSvg?.getAttribute("class") ?? "";
    expect(groupsClass).not.toBe(brandingClass);
    expect(groupsClass).not.toContain("lucide-layout-grid");
    expect(brandingClass).not.toContain("lucide-layout-grid");
  });
});

describe("TileGrid — no tiles visible", () => {
  it("renders nothing when every flag is off — not an empty section", () => {
    const { container } = render(<TileGrid slug="alder-creek" tiles={[]} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});
