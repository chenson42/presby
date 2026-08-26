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
};

describe("TileGrid — tiles present", () => {
  it("renders a link per visible tile, built from the slug", () => {
    render(<TileGrid slug="alder-creek" tiles={[DIRECTORY_TILE]} />);
    const link = screen.getByRole("link", { name: /directory/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory");
    expect(screen.getByText("Browse the congregation directory.")).toBeTruthy();
  });

  it("applies the shadow-lift hover treatment alongside the existing accent color-shift", () => {
    render(<TileGrid slug="alder-creek" tiles={[DIRECTORY_TILE]} />);
    const link = screen.getByRole("link", { name: /directory/i });
    expect(link.className).toContain("hover:shadow-md");
    expect(link.className).toContain("transition-shadow");
    expect(link.className).toContain("hover:bg-accent");
    expect(link.className).toContain("hover:text-accent-foreground");
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
    };
    render(<TileGrid slug="alder-creek" tiles={[futureTile]} />);
    const link = screen.getByRole("link", { name: /future tile/i });
    expect(link.querySelector("svg")).toBeTruthy();
  });
});

describe("TileGrid — no tiles visible", () => {
  it("renders nothing when every flag is off — not an empty section", () => {
    const { container } = render(<TileGrid slug="alder-creek" tiles={[]} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});
