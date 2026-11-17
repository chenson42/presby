/**
 * The congregation map's browser-side helpers (DECISION-343): the DOM nodes a pin
 * and its popup are made of, the framing rule, and the tile-health rule. NO
 * `leaflet` import, so jsdom can test every function, and NO `'use client'`
 * directive (the two client files are `map-loader.tsx` and `map.tsx`; a test pins
 * that list).
 *
 * Everything user-entered (a congregation's name) reaches the page through
 * `textContent` on an element this file created. There is no HTML string anywhere:
 * Leaflet interprets a string passed to a popup or an icon as HTML, so a name like
 * `<img src=x onerror=...>` must never be one. `popupNode` also sets its link's
 * `href` only when it matches the oversight pattern (defence in depth over the
 * server-built href in `map-derive.ts`).
 */
import { MAP_COPY } from "@/lib/presbytery-reports/copy";
import type { ClientPin } from "@/lib/presbytery-reports/map-derive";

export const TILE_ERROR_LIMIT = 3;
export const TILE_WAIT_MS = 10_000;
export const SINGLE_PIN_ZOOM = 10;
export const FIT_MAX_ZOOM = 12;
export const FIT_PADDING = 32;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;

/** The one place a pin's shape class is named: the pin node, the legend and map.css agree. */
export function shapeClass(score: ClientPin["score"]): string {
  return `presby-pin-shape presby-pin-shape--s${score ?? 0}`;
}

/** A pin's icon content: the shape, and the congregation and rating as visually hidden text (the marker's accessible name). */
export function pinNode(pin: Pick<ClientPin, "name" | "label" | "score">): HTMLElement {
  const root = document.createElement("span");
  root.className = "presby-pin-root";
  const shape = document.createElement("span");
  shape.className = shapeClass(pin.score);
  shape.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "presby-pin-text";
  text.textContent = `${pin.name}, ${pin.label}`;
  root.append(shape, text);
  return root;
}

const OVERSIGHT_HREF = /^\/o\/[a-z0-9-]+\/admin\/oversight\/[0-9a-f-]{36}$/;

/** A popup's content: the name, the rating in words, and (only for a well-formed oversight href) the link. */
export function popupNode(pin: Pick<ClientPin, "name" | "label" | "href">): HTMLElement {
  const root = document.createElement("div");
  root.className = "presby-popup";
  const name = document.createElement("p");
  name.className = "presby-popup-name";
  name.textContent = pin.name;
  const rating = document.createElement("p");
  rating.className = "presby-popup-rating";
  rating.textContent = MAP_COPY.popup.rating(pin.label);
  root.append(name, rating);
  if (pin.href !== null && OVERSIGHT_HREF.test(pin.href)) {
    const link = document.createElement("a");
    link.className = "presby-popup-link";
    link.setAttribute("href", pin.href);
    link.textContent = MAP_COPY.popup.open;
    root.append(link);
  }
  return root;
}

export type Frame =
  | { kind: "center"; center: [number, number]; zoom: number }
  | { kind: "bounds"; bounds: [[number, number], [number, number]]; padding: number; maxZoom: number };

/**
 * One pin (or several at the same point) is centred at a fixed zoom: fit-bounds on a
 * single point zooms to the maximum, a street-level grey tile. Several pins fit their
 * bounds with padding and a maximum zoom; the map's minimum zoom keeps a single
 * wrong-sign pin from leaving a broken frame. Bounds do not wrap the antimeridian,
 * so pins at 179 and -179 frame the whole world (accepted).
 */
export function frameFor(pins: ReadonlyArray<Pick<ClientPin, "lat" | "lng">>): Frame {
  if (pins.length === 0) throw new RangeError("frameFor: at least one pin is required");
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const p of pins) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  if (south === north && west === east) return { kind: "center", center: [south, west], zoom: SINGLE_PIN_ZOOM };
  return { kind: "bounds", bounds: [[south, west], [north, east]], padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM };
}

/**
 * Collapse to the "could not load" line only when the tiles are not arriving: several
 * errors and not one tile loaded, or nothing loaded when the wait ran out. A single
 * transient error, or any loaded tile, never collapses a working map.
 */
export function shouldCollapse({ errors, loaded, timedOut = false }: { errors: number; loaded: number; timedOut?: boolean }): boolean {
  if (loaded > 0) return false;
  return errors >= TILE_ERROR_LIMIT || timedOut;
}
