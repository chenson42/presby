// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PhotoGrid } from "./photo-grid";

afterEach(cleanup);

const tile = (id: string, over: Partial<Parameters<typeof PhotoGrid>[0]["photos"][number]> = {}) => ({
  id,
  caption: null,
  isCover: false,
  thumbSrc: null,
  width: 160,
  height: 120,
  ...over,
});

describe("PhotoGrid", () => {
  it("the cover tile wears the word Cover, and no other tile does (not colour alone)", () => {
    render(<PhotoGrid photosHref="/p" photos={[tile("a", { isCover: true, caption: "Front steps" }), tile("b"), tile("c")]} />);
    expect(screen.getAllByText("Cover")).toHaveLength(1);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Cover")).toBeTruthy();
    expect(within(items[1]).queryByText("Cover")).toBeNull();
  });

  it("the badge does not change a tile link's accessible name, and the tile stays a 44px link", () => {
    render(<PhotoGrid photosHref="/p" photos={[tile("a", { isCover: true, caption: "Front steps" })]} />);
    const link = screen.getByRole("link", { name: "View larger: Front steps" });
    expect(link.getAttribute("href")).toBe("/p?view=a");
    expect(link.className).toMatch(/min-h-11/);
  });
});
