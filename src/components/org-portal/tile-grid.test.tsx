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

describe("TileGrid — no tiles visible", () => {
  it("renders nothing when every flag is off — not an empty section", () => {
    const { container } = render(<TileGrid slug="alder-creek" tiles={[]} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});
