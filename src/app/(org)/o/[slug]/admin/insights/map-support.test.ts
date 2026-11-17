// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  FIT_MAX_ZOOM,
  FIT_PADDING,
  SINGLE_PIN_ZOOM,
  TILE_ERROR_LIMIT,
  frameFor,
  pinNode,
  popupNode,
  shapeClass,
  shouldCollapse,
} from "./map-support";

const ID = "00000000-0000-4000-8000-00000000000a";
const HREF = `/o/northern/admin/oversight/${ID}`;
const HOSTILE = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

describe("pinNode", () => {
  it("carries the shape, and the name and rating as visually hidden text (the marker's accessible name)", () => {
    const node = pinNode({ name: "Alder Creek", label: "At risk", score: 1 });
    expect(node.querySelector(".presby-pin-text")?.textContent).toBe("Alder Creek, At risk");
    const shape = node.querySelector(".presby-pin-shape");
    expect(shape?.className).toBe("presby-pin-shape presby-pin-shape--s1");
    expect(shape?.getAttribute("aria-hidden")).toBe("true");
  });

  it("a hostile name is text: no element is created from it", () => {
    const node = pinNode({ name: HOSTILE, label: "Fair", score: 2 });
    expect(node.querySelector("img")).toBeNull();
    expect(node.querySelector("script")).toBeNull();
    expect(node.querySelector(".presby-pin-text")?.textContent).toBe(`${HOSTILE}, Fair`);
    expect(node.querySelectorAll("*")).toHaveLength(2); // the shape and the text, nothing the name made
  });

  it("each score has its own shape class, and 'not yet assessed' is s0", () => {
    expect([1, 2, 3, null].map((s) => shapeClass(s as 1 | 2 | 3 | null))).toEqual([
      "presby-pin-shape presby-pin-shape--s1",
      "presby-pin-shape presby-pin-shape--s2",
      "presby-pin-shape presby-pin-shape--s3",
      "presby-pin-shape presby-pin-shape--s0",
    ]);
  });
});

describe("popupNode", () => {
  it("shows the name and the rating in words, with the link when the href is the oversight page", () => {
    const node = popupNode({ name: "Alder Creek", label: "Fair", href: HREF });
    expect(node.querySelector(".presby-popup-name")?.textContent).toBe("Alder Creek");
    expect(node.querySelector(".presby-popup-rating")?.textContent).toBe("Viability: Fair");
    const link = node.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(HREF);
    expect(link.textContent).toBe("Open oversight page");
  });

  it("has no link when the href is null (the oversight page is not turned on)", () => {
    const node = popupNode({ name: "Alder Creek", label: "Fair", href: null });
    expect(node.querySelector("a")).toBeNull();
    expect(node.textContent).toBe("Alder CreekViability: Fair");
  });

  it.each([
    "javascript:alert(1)",
    "https://example.invalid/o/northern/admin/oversight/" + ID,
    "//example.invalid/o/x/admin/oversight/" + ID,
    "/o/northern/admin/oversight/not-a-uuid",
    `/o/Northern/admin/oversight/${ID}`,
    `/o/northern/admin/people/${ID}`,
    `${HREF}?next=/x`,
    `${HREF}/`,
  ])("ignores an href that is not the oversight pattern: %s", (href) => {
    expect(popupNode({ name: "A", label: "Fair", href }).querySelector("a")).toBeNull();
  });

  it("a hostile name is text: no element, no attribute", () => {
    const node = popupNode({ name: HOSTILE, label: "At risk", href: HREF });
    expect(node.querySelector("img")).toBeNull();
    expect(node.querySelector("script")).toBeNull();
    expect(node.querySelector(".presby-popup-name")?.textContent).toBe(HOSTILE);
    expect(node.querySelectorAll("*")).toHaveLength(3); // name, rating, link
  });
});

describe("frameFor", () => {
  it("one pin is centred at the fixed zoom, never fit-bounds on a single point", () => {
    expect(frameFor([{ lat: 39.96, lng: -82.99 }])).toEqual({ kind: "center", center: [39.96, -82.99], zoom: SINGLE_PIN_ZOOM });
    expect(SINGLE_PIN_ZOOM).toBe(10);
  });

  it("several pins at the same point are one point", () => {
    expect(frameFor([{ lat: 1, lng: 2 }, { lat: 1, lng: 2 }]).kind).toBe("center");
  });

  it("several pins fit their bounds with padding and a maximum zoom", () => {
    const frame = frameFor([
      { lat: 41.2, lng: -77.2 },
      { lat: 41.35, lng: -77.02 },
      { lat: 40.9, lng: -77.5 },
    ]);
    expect(frame).toEqual({
      kind: "bounds",
      bounds: [[40.9, -77.5], [41.35, -77.02]],
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
    });
    expect(FIT_MAX_ZOOM).toBe(12);
  });

  it("a pair on one meridian is still bounds, not a centre (the latitudes differ)", () => {
    expect(frameFor([{ lat: 40, lng: -83 }, { lat: 41, lng: -83 }]).kind).toBe("bounds");
  });

  it("a far-apart pair (a wrong-sign pin) is bounds; the map's own minimum zoom keeps the frame sane", () => {
    const frame = frameFor([{ lat: 40, lng: -83 }, { lat: 40, lng: 83 }]);
    expect(frame.kind).toBe("bounds");
  });

  it("refuses no pins (the page never mounts a map for none)", () => {
    expect(() => frameFor([])).toThrow(RangeError);
  });
});

describe("shouldCollapse", () => {
  it("collapses on several errors with no tile loaded", () => {
    expect(shouldCollapse({ errors: TILE_ERROR_LIMIT, loaded: 0 })).toBe(true);
    expect(TILE_ERROR_LIMIT).toBe(3);
  });

  it("never collapses on one or two transient errors", () => {
    expect(shouldCollapse({ errors: 1, loaded: 0 })).toBe(false);
    expect(shouldCollapse({ errors: 2, loaded: 0 })).toBe(false);
  });

  it("never collapses a map that has loaded any tile, however many errors follow", () => {
    expect(shouldCollapse({ errors: 50, loaded: 1 })).toBe(false);
    expect(shouldCollapse({ errors: 50, loaded: 1, timedOut: true })).toBe(false);
  });

  it("collapses when the wait ran out with nothing loaded, even with no error", () => {
    expect(shouldCollapse({ errors: 0, loaded: 0, timedOut: true })).toBe(true);
    expect(shouldCollapse({ errors: 0, loaded: 0, timedOut: false })).toBe(false);
  });
});
