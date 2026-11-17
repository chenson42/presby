// @vitest-environment jsdom
/**
 * `map-loader.tsx`: the lazy boundary. A chunk or Leaflet failure must become one
 * honest line, never reach `[slug]/error.tsx` (which would replace the whole page and
 * take the viability list with it).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({ throws: false }));
vi.mock("./map", () => ({
  default: function FakeMap({ tileUrl, pins }: { tileUrl: string; pins: unknown[] }) {
    if (mode.throws) throw new Error("leaflet exploded");
    return <div data-testid="fake-map" data-tile-url={tileUrl} data-pins={pins.length} />;
  },
}));

import { ViabilityMapLoader } from "./map-loader";

afterEach(() => {
  cleanup();
  mode.throws = false;
  vi.restoreAllMocks();
});

const PINS = [{ id: "i", name: "A", lat: 1, lng: 2, score: null, label: "Not yet assessed", href: null }];

describe("ViabilityMapLoader", () => {
  it("loads the map lazily and hands it the tile URL and the pins", async () => {
    mode.throws = false;
    render(<ViabilityMapLoader tileUrl="https://api.maptiler.com/x" pins={PINS} />);
    const fake = await screen.findByTestId("fake-map");
    expect(fake.getAttribute("data-tile-url")).toBe("https://api.maptiler.com/x");
    expect(fake.getAttribute("data-pins")).toBe("1");
  });

  it("a map that throws becomes the could-not-load line, not an unhandled error", async () => {
    mode.throws = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ViabilityMapLoader tileUrl="https://api.maptiler.com/x" pins={PINS} />);
    await waitFor(() => expect(screen.getByText(/The map could not load\. The list below has every congregation\./)).toBeTruthy());
    expect(screen.queryByTestId("fake-map")).toBeNull();
  });
});
