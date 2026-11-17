"use client";

/**
 * The congregation map (DECISION-343): the ONLY importer of `leaflet` and of
 * `leaflet/dist/leaflet.css` (`check:deps-drift` rule 6 pins both directions), loaded
 * lazily by `map-loader.tsx` with `ssr: false`, so no other page pays for it.
 *
 * It draws tiles and pins and detects tile failure, which only a browser can. It
 * reads no environment, calls no server, and builds no HTML string: pins and popups
 * are DOM nodes from `map-support.ts`, the attribution and the logo are React.
 * Leaflet's own attribution control is off for that reason.
 *
 * One finger must scroll the page: dragging is off on a coarse pointer (two fingers
 * move and zoom, as do the zoom buttons and the keyboard), and the wheel never zooms
 * (it would trap a desktop scroll). The canvas is its own stacking context (`isolate`)
 * so Leaflet's z-indexes cannot rise over the sticky header or the phone menu.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";
import { useEffect, useRef, useState } from "react";
import { MAP_COPY } from "@/lib/presbytery-reports/copy";
import type { ClientPin } from "@/lib/presbytery-reports/map-derive";
import { MAX_ZOOM, MIN_ZOOM, TILE_WAIT_MS, frameFor, pinNode, popupNode, shapeClass, shouldCollapse } from "./map-support";

const POPUP_GAP = 16;
const POPUP_CHROME = 55; // the popup content's left (14) and right (40) margins, plus its border
const MAX_POPUP_WIDTH = 260;
const MIN_POPUP_WIDTH = 120;
const FALLBACK_CLEAR_LEFT = 66; // the 44px zoom buttons, their 2px border and Leaflet's 10px margin, and a gap

export default function ViabilityMap({ tileUrl, pins }: { tileUrl: string; pins: ClientPin[] }) {
  const canvas = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el || pins.length === 0) return;

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const map = L.map(el, {
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: !coarse,
      touchZoom: true,
      keyboard: true,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      zoomAnimation: !reduced,
      markerZoomAnimation: !reduced,
    });
    let removed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (!removed) {
        removed = true;
        map.remove();
      }
    };

    let errors = 0;
    let loaded = 0;
    const check = (timedOut: boolean) => {
      if (shouldCollapse({ errors, loaded, timedOut })) {
        dispose();
        setFailed(true);
      }
    };
    const tiles = L.tileLayer(tileUrl, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });
    tiles.on("tileload", () => {
      loaded += 1;
    });
    tiles.on("tileerror", () => {
      errors += 1;
      check(false);
    });
    tiles.addTo(map);
    timer = setTimeout(() => check(true), TILE_WAIT_MS);

    // The zoom control (z-index 800) draws over the popup pane (700) and the two cannot be re-ordered (the map
    // pane is its own stacking context), so a popup must not overlap it at all. Measure where the control ends
    // and keep every popup to the right of that line: autopan pads the left edge by it, and the popup is
    // narrowed so it still fits beside the control on a phone. The 55px is the popup content's own margins.
    const zoom = map.zoomControl.getContainer();
    const clearLeft = zoom ? Math.ceil(zoom.getBoundingClientRect().right - el.getBoundingClientRect().left) + POPUP_GAP : FALLBACK_CLEAR_LEFT;
    const popupWidth = Math.max(MIN_POPUP_WIDTH, Math.min(MAX_POPUP_WIDTH, el.clientWidth - clearLeft - POPUP_GAP - POPUP_CHROME));

    for (const pin of pins) {
      L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({ html: pinNode(pin), iconSize: [44, 44], iconAnchor: [22, 22], className: "presby-pin" }),
        keyboard: true,
      })
        .bindPopup(popupNode(pin), {
          maxWidth: popupWidth,
          autoPanPaddingTopLeft: [clearLeft, POPUP_GAP],
          autoPanPaddingBottomRight: [POPUP_GAP, POPUP_GAP],
        })
        .addTo(map);
    }

    const frame = frameFor(pins);
    if (frame.kind === "center") map.setView(frame.center, frame.zoom);
    else map.fitBounds(frame.bounds, { padding: [frame.padding, frame.padding], maxZoom: frame.maxZoom });

    return dispose;
  }, [tileUrl, pins]);

  if (failed) {
    return (
      <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        {MAP_COPY.tilesError}
      </p>
    );
  }

  const a = MAP_COPY.attribution;
  return (
    <div role="region" aria-label={MAP_COPY.regionLabel} className="presby-map overflow-hidden rounded-lg border border-border bg-background">
      <div ref={canvas} className="presby-map__canvas h-72 w-full" />
      <div className="space-y-2 border-t border-border p-3 text-sm">
        <p className="font-medium">{MAP_COPY.legend.heading}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {MAP_COPY.legend.items.map((item) => (
            <li key={item.label} className="inline-flex items-center gap-2">
              <span className={shapeClass(item.score)} aria-hidden="true" />
              <span>
                {item.label}: {item.shape}
              </span>
            </li>
          ))}
        </ul>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <a href={a.maptilerHref} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            {a.maptiler}
          </a>
          <a href={a.osmHref} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            {a.osm}
          </a>
          <a href={a.logoHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center">
            {/* The provider's own logo, linked, as its plan requires; a plain img keeps next/image's loader off a third-party host. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.logoSrc} alt={a.logoAlt} className="h-5 w-auto" />
          </a>
        </p>
      </div>
    </div>
  );
}
