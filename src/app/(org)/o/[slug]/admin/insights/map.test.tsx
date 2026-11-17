// @vitest-environment jsdom
/**
 * `map.tsx` and `map-loader.tsx` with a FAKE leaflet (jsdom cannot draw tiles): the
 * options passed to the map, one marker per pin built from DOM nodes, the framing call,
 * the tile-failure collapse, the cleanup, the React attribution links, and the loader's
 * error boundary. The real library is exercised by `e2e/presbytery-map/`.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    mapOptions: undefined as Record<string, unknown> | undefined,
    mapRemoved: 0,
    views: [] as unknown[],
    fits: [] as unknown[],
    tileHandlers: {} as Record<string, () => void>,
    tileUrl: "",
    tileOptions: undefined as Record<string, unknown> | undefined,
    markers: [] as { latlng: unknown; options: Record<string, unknown>; popup?: unknown; popupOptions?: unknown }[],
    divIcons: [] as Record<string, unknown>[],
  };
  const chain = () => {
    const api = {
      setView: (...a: unknown[]) => (state.views.push(a), api),
      fitBounds: (...a: unknown[]) => (state.fits.push(a), api),
      remove: () => {
        state.mapRemoved += 1;
      },
    };
    return api;
  };
  return { state, chain };
});

vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("./map.css", () => ({}));
vi.mock("leaflet", () => {
  const L = {
    map: (_el: HTMLElement, options: Record<string, unknown>) => {
      h.state.mapOptions = options;
      return h.chain();
    },
    tileLayer: (url: string, options: Record<string, unknown>) => {
      h.state.tileUrl = url;
      h.state.tileOptions = options;
      const layer = {
        on: (name: string, fn: () => void) => {
          h.state.tileHandlers[name] = fn;
          return layer;
        },
        addTo: () => layer,
      };
      return layer;
    },
    divIcon: (options: Record<string, unknown>) => {
      h.state.divIcons.push(options);
      return options;
    },
    marker: (latlng: unknown, options: Record<string, unknown>) => {
      const entry = { latlng, options } as (typeof h.state.markers)[number];
      h.state.markers.push(entry);
      const m = {
        bindPopup: (node: unknown, popupOptions: unknown) => {
          entry.popup = node;
          entry.popupOptions = popupOptions;
          return m;
        },
        addTo: () => m,
      };
      return m;
    },
  };
  return { default: L, ...L };
});

import ViabilityMap from "./map";
import { TILE_WAIT_MS } from "./map-support";

const ID = "00000000-0000-4000-8000-00000000000a";
const PIN = { id: ID, name: "Alder Creek", lat: 40, lng: -83, score: 1 as const, label: "At risk", href: `/o/northern/admin/oversight/${ID}` };
const PIN2 = { id: "00000000-0000-4000-8000-00000000000b", name: "Birch Hollow", lat: 41, lng: -82, score: null, label: "Not yet assessed", href: null };
const TILE_URL = "https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=fake-key-value_123"; // leak-ok: made up

function stubMedia(matches: Record<string, boolean>) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: matches[q] ?? false, media: q, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  vi.useFakeTimers();
  stubMedia({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  h.state.mapOptions = undefined;
  h.state.mapRemoved = 0;
  h.state.views.length = 0;
  h.state.fits.length = 0;
  h.state.markers.length = 0;
  h.state.divIcons.length = 0;
  h.state.tileHandlers = {};
});

describe("ViabilityMap", () => {
  it("builds a map that never traps a scroll: no wheel zoom, own attribution off, bounded zoom, keyboard on", () => {
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN, PIN2]} />);
    expect(h.state.mapOptions).toMatchObject({
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: true,
      touchZoom: true,
      keyboard: true,
      minZoom: 2,
      maxZoom: 18,
      zoomAnimation: true,
      markerZoomAnimation: true,
    });
  });

  it("turns one-finger dragging off on a coarse pointer (the page scrolls; two fingers move the map)", () => {
    stubMedia({ "(pointer: coarse)": true });
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    expect(h.state.mapOptions).toMatchObject({ dragging: false, touchZoom: true });
  });

  it("turns animations off for reduced motion", () => {
    stubMedia({ "(prefers-reduced-motion: reduce)": true });
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    expect(h.state.mapOptions).toMatchObject({ zoomAnimation: false, markerZoomAnimation: false });
  });

  it("draws the given tile URL with no wildcard subdomain, and nothing about a congregation in it", () => {
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN, PIN2]} />);
    expect(h.state.tileUrl).toBe(TILE_URL);
    expect(h.state.tileUrl).not.toContain("Alder");
    expect(h.state.tileUrl).not.toContain(ID);
    expect(h.state.tileOptions).toEqual({ minZoom: 2, maxZoom: 18 });
  });

  it("makes one keyboard-focusable marker per pin, with DOM-node icons and popups (no HTML strings)", () => {
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN, PIN2]} />);
    expect(h.state.markers.map((m) => m.latlng)).toEqual([[40, -83], [41, -82]]);
    for (const m of h.state.markers) {
      expect(m.options.keyboard).toBe(true);
      expect(m.popup).toBeInstanceOf(HTMLElement);
    }
    for (const icon of h.state.divIcons) {
      expect(icon.html).toBeInstanceOf(HTMLElement);
      expect(icon.className).toBe("presby-pin");
      expect(icon.iconSize).toEqual([44, 44]);
    }
    expect((h.state.markers[0]!.popup as HTMLElement).querySelector("a")?.getAttribute("href")).toBe(PIN.href);
    expect((h.state.markers[1]!.popup as HTMLElement).querySelector("a")).toBeNull();
  });

  it("frames one pin by centring at zoom 10 and several by fitting bounds", () => {
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    expect(h.state.views).toEqual([[[40, -83], 10]]);
    expect(h.state.fits).toEqual([]);
    cleanup();
    h.state.views.length = 0;
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN, PIN2]} />);
    expect(h.state.fits).toEqual([[[[40, -83], [41, -82]], { padding: [32, 32], maxZoom: 12 }]]);
    expect(h.state.views).toEqual([]);
  });

  it("has a named region, the legend in words, and the attribution as real links with rel (and the logo, linked)", () => {
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    expect(screen.getByRole("region", { name: /viability list below gives the same ratings as text/ })).toBeTruthy();
    for (const word of ["At risk: diamond", "Fair: square", "Healthy: circle", "Not yet assessed: hollow circle"]) {
      expect(screen.getByText(word)).toBeTruthy();
    }
    const links = screen.getAllByRole("link");
    const byText = (t: string) => links.find((l) => l.textContent === t)!;
    expect(byText("© MapTiler").getAttribute("href")).toBe("https://www.maptiler.com/copyright/");
    expect(byText("© OpenStreetMap contributors").getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    const logoLink = screen.getByAltText("MapTiler logo").closest("a")!;
    expect(logoLink.getAttribute("href")).toBe("https://www.maptiler.com/");
    expect(screen.getByAltText("MapTiler logo").getAttribute("src")).toBe("https://api.maptiler.com/resources/logo.svg");
    for (const l of [...links]) {
      expect(l.getAttribute("rel")).toBe("noopener noreferrer");
      expect(l.getAttribute("target")).toBe("_blank");
    }
  });

  it("removes the map when it unmounts, once", () => {
    const { unmount } = render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    unmount();
    expect(h.state.mapRemoved).toBe(1);
  });

  it("collapses to the could-not-load line after three tile errors with nothing loaded, removing the map once", () => {
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    act(() => h.state.tileHandlers.tileerror!());
    act(() => h.state.tileHandlers.tileerror!());
    expect(screen.queryByText(/The map could not load/)).toBeNull();
    act(() => h.state.tileHandlers.tileerror!());
    expect(screen.getByText(/The map could not load\. The list below has every congregation\./)).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(h.state.mapRemoved).toBe(1);
    cleanup();
    expect(h.state.mapRemoved).toBe(1);
  });

  it("does not collapse a map whose tiles load, however many errors follow", () => {
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    act(() => h.state.tileHandlers.tileload!());
    for (let i = 0; i < 10; i += 1) act(() => h.state.tileHandlers.tileerror!());
    act(() => {
      vi.advanceTimersByTime(TILE_WAIT_MS + 1);
    });
    expect(screen.queryByText(/The map could not load/)).toBeNull();
    expect(screen.getByRole("region")).toBeTruthy();
  });

  it("collapses when no tile has loaded by the end of the wait", () => {
    render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    act(() => {
      vi.advanceTimersByTime(TILE_WAIT_MS - 1);
    });
    expect(screen.queryByText(/The map could not load/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByText(/The map could not load/)).toBeTruthy();
  });

  it("clears its wait timer on unmount (no collapse after the map is gone)", () => {
    const { unmount } = render(<ViabilityMap tileUrl={TILE_URL} pins={[PIN]} />);
    unmount();
    expect(() => vi.advanceTimersByTime(TILE_WAIT_MS * 2)).not.toThrow();
    expect(h.state.mapRemoved).toBe(1);
  });
});
