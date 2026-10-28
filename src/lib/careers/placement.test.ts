import { describe, expect, it } from "vitest";
import {
  careersBackTarget,
  describePlacement,
  findSlotPages,
  hasOwnCareersPage,
  type BundlePage,
} from "./placement";

const slotBlock = { type: "liveSlot", props: { slot: "careers" } };
const page = (path: string, blocks: unknown[]): BundlePage => ({ path, mdxAst: { blocks } });

const urls = {
  home: () => "/H",
  page: (p: string) => `/P${p}`,
  careers: () => "/C",
};

describe("findSlotPages", () => {
  it("returns the paths of pages carrying the careers slot, in bundle order", () => {
    const pages = [
      page("/", [{ type: "hero", props: {} }]),
      page("/employment", [{ type: "hero", props: {} }, slotBlock]),
      page("/about", []),
      page("/join", [slotBlock, slotBlock]),
    ];
    expect(findSlotPages(pages, "careers")).toEqual(["/employment", "/join"]);
  });

  it("ignores other slots and other block types that mention the slot", () => {
    const pages = [
      page("/a", [{ type: "liveSlot", props: { slot: "eventsCalendar" } }]),
      page("/b", [{ type: "prose", props: { slot: "careers" } }]),
      page("/c", [{ type: "liveSlot", props: { slot: "Careers" } }]),
      page("/d", [{ type: "liveSlot", props: { slot: ["careers"] } }]),
    ];
    expect(findSlotPages(pages, "careers")).toEqual([]);
  });

  it("is defensive about malformed mdxAst, exactly as site-kit's extractBlocks is", () => {
    const malformed: unknown[] = [
      null,
      undefined,
      "raw string",
      42,
      [],
      {},
      { raw: "legacy stub" },
      { blocks: "nope" },
      { blocks: null },
      { blocks: {} },
    ];
    for (const mdxAst of malformed) {
      expect(findSlotPages([{ path: "/x", mdxAst }], "careers"), JSON.stringify(mdxAst)).toEqual([]);
    }
  });

  it("skips a block without a string type, a null block, and tolerates non-record props", () => {
    const pages = [
      page("/a", [null, 5, "x", [], { props: { slot: "careers" } }, { type: 5, props: { slot: "careers" } }]),
      page("/b", [{ type: "liveSlot", props: null }, { type: "liveSlot" }, { type: "liveSlot", props: "careers" }]),
      page("/c", [{ type: "liveSlot", props: { slot: "careers" } }]),
    ];
    expect(findSlotPages(pages, "careers")).toEqual(["/c"]);
  });

  it("skips a malformed page entry", () => {
    const pages = [null, 5, { mdxAst: { blocks: [slotBlock] } }, { path: 5, mdxAst: { blocks: [slotBlock] } }] as unknown as BundlePage[];
    expect(findSlotPages(pages, "careers")).toEqual([]);
  });
});

describe("hasOwnCareersPage", () => {
  it("is exactly /careers", () => {
    expect(hasOwnCareersPage([page("/careers", [])])).toBe(true);
    expect(hasOwnCareersPage([page("/careers/", []), page("/Careers", []), page("/about/careers", [])])).toBe(false);
    expect(hasOwnCareersPage([])).toBe(false);
  });
});

describe("describePlacement (Copy S5)", () => {
  it("slot found, no page of its own at /careers", () => {
    expect(describePlacement({ kind: "known", pages: [page("/", []), page("/employment", [slotBlock])] })).toEqual({
      kind: "slot_and_list",
      slotPaths: ["/employment"],
    });
  });

  it("slot found, and the site has its own /careers page", () => {
    expect(
      describePlacement({ kind: "known", pages: [page("/careers", []), page("/employment", [slotBlock])] }),
    ).toEqual({ kind: "slot_only", slotPaths: ["/employment"] });
  });

  it("no slot anywhere, no page of its own: only the list at /careers", () => {
    expect(describePlacement({ kind: "known", pages: [page("/", [])] })).toEqual({ kind: "list_only" });
    expect(describePlacement({ kind: "known", pages: [] })).toEqual({ kind: "list_only" });
  });

  it("no slot anywhere, but the site has its own /careers page", () => {
    expect(describePlacement({ kind: "known", pages: [page("/careers", [])] })).toEqual({
      kind: "own_page_no_slot",
    });
  });

  it("the slot on the /careers page itself counts as slot_only", () => {
    expect(describePlacement({ kind: "known", pages: [page("/careers", [slotBlock])] })).toEqual({
      kind: "slot_only",
      slotPaths: ["/careers"],
    });
  });

  it("an unreadable bundle says so rather than guessing", () => {
    expect(describePlacement({ kind: "unknown" })).toEqual({ kind: "unknown" });
  });
});

describe("careersBackTarget", () => {
  it("the first slot page wins", () => {
    expect(
      careersBackTarget(
        { kind: "known", pages: [page("/a", [slotBlock]), page("/b", [slotBlock])] },
        urls,
      ),
    ).toBe("/P/a");
  });

  it("else the platform list, when the bundle has no page of its own at /careers", () => {
    expect(careersBackTarget({ kind: "known", pages: [page("/", [])] }, urls)).toBe("/C");
  });

  it("else the site home, when the bundle's own /careers page hides the list", () => {
    expect(careersBackTarget({ kind: "known", pages: [page("/careers", [])] }, urls)).toBe("/H");
  });

  it("an unreadable bundle falls back to the platform list", () => {
    expect(careersBackTarget({ kind: "unknown" }, urls)).toBe("/C");
  });
});
