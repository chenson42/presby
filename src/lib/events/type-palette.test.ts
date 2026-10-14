import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as lucide from "lucide-react";
import { CATEGORY_KEYS } from "../brand/contract";
import {
  DEFAULT_EVENT_TYPE_ICON,
  EVENT_TYPE_COLORS,
  EVENT_TYPE_COLOR_LABELS,
  EVENT_TYPE_ICONS,
  EVENT_TYPE_ICON_LABELS,
  SELECTABLE_EVENT_TYPE_COLORS,
  TYPE_COLOR_CLASSES,
  isEventTypeColor,
  isEventTypeIcon,
  typeColorClasses,
} from "./type-palette";

describe("EVENT_TYPE_COLORS", () => {
  it("is exactly the brand contract's CATEGORY_KEYS", () => {
    expect([...EVENT_TYPE_COLORS]).toEqual([...CATEGORY_KEYS]);
  });

  it("offers every colour but neutral to an admin; neutral is the fallback's", () => {
    expect(SELECTABLE_EVENT_TYPE_COLORS).toHaveLength(8);
    expect(SELECTABLE_EVENT_TYPE_COLORS).not.toContain("neutral");
    expect(EVENT_TYPE_COLORS).toContain("neutral");
  });

  it("labels every colour and every icon", () => {
    expect(Object.keys(EVENT_TYPE_COLOR_LABELS).sort()).toEqual([...EVENT_TYPE_COLORS].sort());
    expect(Object.keys(EVENT_TYPE_ICON_LABELS).sort()).toEqual([...EVENT_TYPE_ICONS].sort());
  });
});

describe("EVENT_TYPE_ICONS", () => {
  it("has 15 unique names", () => {
    expect(EVENT_TYPE_ICONS).toHaveLength(15);
    expect(new Set(EVENT_TYPE_ICONS).size).toBe(15);
  });

  it("names only icons that exist in the installed lucide-react", () => {
    const exports = lucide as unknown as Record<string, unknown>;
    for (const name of EVENT_TYPE_ICONS) {
      expect(exports[name], `lucide-react has no export ${name}`).toBeTruthy();
    }
  });

  it("includes the default icon", () => {
    expect(EVENT_TYPE_ICONS).toContain(DEFAULT_EVENT_TYPE_ICON);
  });
});

describe("TYPE_COLOR_CLASSES", () => {
  it("covers every palette key, with the key's own tokens in every class", () => {
    for (const color of EVENT_TYPE_COLORS) {
      const c = TYPE_COLOR_CLASSES[color];
      expect(c.chip).toBe(`bg-category-${color} text-category-${color}-foreground`);
      expect(c.ink).toBe(`text-category-${color}-foreground`);
      expect(c.rule).toBe(`border-l-category-${color}-foreground`);
      expect(c.border).toBe(`border-category-${color}-foreground`);
      expect(c.swatch).toBe(`bg-category-${color}-foreground`);
    }
  });

  it("is written as literal class strings, never interpolated (Tailwind scans source)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./type-palette.ts", import.meta.url)),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/category-\$\{/);
    for (const color of EVENT_TYPE_COLORS) {
      expect(src).toContain(`"bg-category-${color} text-category-${color}-foreground"`);
    }
  });
});

describe("guards and fallback", () => {
  it("accepts every palette key and icon, rejects the rest", () => {
    for (const c of EVENT_TYPE_COLORS) expect(isEventTypeColor(c)).toBe(true);
    for (const i of EVENT_TYPE_ICONS) expect(isEventTypeIcon(i)).toBe(true);
    for (const bad of ["red", "", null, undefined, 3, "Rose"]) {
      expect(isEventTypeColor(bad)).toBe(false);
    }
    for (const bad of ["church", "Nope", null, undefined, 3]) {
      expect(isEventTypeIcon(bad)).toBe(false);
    }
  });

  it("degrades an unknown or missing colour to neutral instead of throwing", () => {
    expect(typeColorClasses("hotpink")).toBe(TYPE_COLOR_CLASSES.neutral);
    expect(typeColorClasses(null)).toBe(TYPE_COLOR_CLASSES.neutral);
    expect(typeColorClasses(undefined)).toBe(TYPE_COLOR_CLASSES.neutral);
    expect(typeColorClasses("teal")).toBe(TYPE_COLOR_CLASSES.teal);
  });
});
