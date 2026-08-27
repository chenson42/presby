// @vitest-environment jsdom
/**
 * Tests for the genericized `TileGrid` — commit 1 of docs/work-log/
 * 2026-08-27-platform-home-and-portal.md (Phase 3, DECISION-125). Two
 * fixtures prove the generic `TileLike<TDomain>` bound is satisfied by BOTH
 * real shapes this component now serves, not just a synthetic one:
 *
 *   - a `PortalTile`-shaped array + a slug-closure `getHref` (the org-portal
 *     axis, moved here from `src/components/org-portal/tile-grid.test.tsx`)
 *   - an `AdminTile`-shaped array + a plain-string `getHref` (the new
 *     admin-portal axis)
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { TileGrid, type TileLike } from "./tile-grid";

afterEach(cleanup);

interface PortalTileFixture extends TileLike<"people" | "administration"> {
  href: (slug: string) => string;
}

interface AdminTileFixture extends TileLike<"people_access" | "content_communications"> {
  href: string;
}

const DIRECTORY_TILE: PortalTileFixture = {
  key: "directory",
  label: "Directory",
  description: "Browse the congregation directory.",
  href: (slug) => `/o/${slug}/directory`,
  domain: "people",
};

const USERS_TILE: AdminTileFixture = {
  key: "users",
  label: "Users & roles",
  description: "Assign roles to users.",
  href: "/admin/users",
  domain: "people_access",
};

describe("TileGrid — org-portal axis (PortalTile-shaped, slug-closure getHref)", () => {
  it("renders a link per visible tile, built from the slug closure", () => {
    render(
      <TileGrid
        tiles={[DIRECTORY_TILE]}
        getHref={(tile) => tile.href("alder-creek")}
      />,
    );
    const link = screen.getByRole("link", { name: /directory/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory");
    expect(screen.getByText("Browse the congregation directory.")).toBeTruthy();
  });

  it("applies the tile Button variant's elevated card and hover-lift treatment", () => {
    render(
      <TileGrid
        tiles={[DIRECTORY_TILE]}
        getHref={(tile) => tile.href("alder-creek")}
      />,
    );
    const link = screen.getByRole("link", { name: /directory/i });
    expect(link.className).toContain("bg-card");
    expect(link.className).toContain("shadow-sm");
    expect(link.className).toContain("hover:shadow-lg");
  });

  it("renders the description at the body TYPE_SCALE role, not dense", () => {
    render(
      <TileGrid
        tiles={[DIRECTORY_TILE]}
        getHref={(tile) => tile.href("alder-creek")}
      />,
    );
    const description = screen.getByText("Browse the congregation directory.");
    expect(description.className).toContain("text-base");
    expect(description.className).not.toContain("text-sm");
  });

  it("renders a trailing chevron pinned to the bottom plus one mapped icon", () => {
    render(
      <TileGrid
        tiles={[DIRECTORY_TILE]}
        getHref={(tile) => tile.href("alder-creek")}
        getIcon={() => undefined}
      />,
    );
    const link = screen.getByRole("link", { name: /directory/i });
    const icons = link.querySelectorAll("svg");
    expect(icons.length).toBe(2);
  });

  it("falls back to a default icon (never crashes) when getIcon is omitted", () => {
    render(
      <TileGrid tiles={[DIRECTORY_TILE]} getHref={(tile) => tile.href("alder-creek")} />,
    );
    const link = screen.getByRole("link", { name: /directory/i });
    expect(link.querySelector("svg")).toBeTruthy();
  });
});

describe("TileGrid — admin-portal axis (AdminTile-shaped, plain-string getHref)", () => {
  it("renders a link built directly from the plain-string href, no slug at all", () => {
    render(<TileGrid tiles={[USERS_TILE]} getHref={(tile) => tile.href} />);
    const link = screen.getByRole("link", { name: /users & roles/i });
    expect(link.getAttribute("href")).toBe("/admin/users");
  });

  it("uses the caller-supplied getIcon map", () => {
    render(
      <TileGrid
        tiles={[USERS_TILE]}
        getHref={(tile) => tile.href}
        getIcon={() => Users}
      />,
    );
    const link = screen.getByRole("link", { name: /users & roles/i });
    const icon = link.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("lucide-users");
  });
});

describe("TileGrid — no tiles visible", () => {
  it("renders nothing for an empty tiles array — not an empty section", () => {
    const { container } = render(<TileGrid tiles={[]} getHref={() => ""} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});

describe("TileGrid — no internal heading/section wrapper", () => {
  it("renders the bare card grid with no heading and no wrapping <section> — the caller owns that chrome", () => {
    const { container } = render(
      <TileGrid tiles={[DIRECTORY_TILE]} getHref={(tile) => tile.href("alder-creek")} />,
    );

    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector(".grid")).toBeTruthy();
  });
});
