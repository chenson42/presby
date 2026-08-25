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
});

describe("TileGrid — no tiles visible", () => {
  it("renders nothing when every flag is off — not an empty section", () => {
    const { container } = render(<TileGrid slug="alder-creek" tiles={[]} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});
