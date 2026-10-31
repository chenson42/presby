// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PlacementInput } from "@/lib/careers/placement";
import { PlacementLine } from "./placement-line";

afterEach(cleanup);

const slotPage = (path: string) => ({ path, mdxAst: { blocks: [{ type: "liveSlot", props: { slot: "careers" } }] } });
const plain = (path: string) => ({ path, mdxAst: { blocks: [] } });
const ADDRESS = "presby.invalid/site/alder-creek/careers";

function line(input: PlacementInput) {
  render(<PlacementLine input={input} careersAddress={ADDRESS} />);
  return screen.getByTestId("careers-placement").textContent;
}

describe("PlacementLine - Copy S5, all five states (T20)", () => {
  it("a slot page and the platform list", () => {
    expect(line({ kind: "known", pages: [plain("/"), slotPage("/employment")] })).toBe(
      `Your openings appear on your website's /employment page and in a list at ${ADDRESS}.`,
    );
  });

  it("several slot pages are listed, not just the first", () => {
    expect(line({ kind: "known", pages: [slotPage("/employment"), slotPage("/about"), slotPage("/connect")] })).toBe(
      `Your openings appear on your website's /employment, /about and /connect pages and in a list at ${ADDRESS}.`,
    );
  });

  it("a slot page, and the site's own /careers page replaces the list", () => {
    expect(line({ kind: "known", pages: [plain("/careers"), slotPage("/employment")] })).toBe(
      "Your openings appear on your website's /employment page.",
    );
  });

  it("no slot, no own page: only the list, and how to put it on a page", () => {
    expect(line({ kind: "known", pages: [plain("/")] })).toBe(
      `Your openings are listed at ${ADDRESS}. No other page on your website shows them yet. To put them on a page, ask whoever maintains your website.`,
    );
  });

  it("no slot but the site's own /careers page: the list cannot appear there", () => {
    expect(line({ kind: "known", pages: [plain("/careers")] })).toBe(
      "Your website has its own /careers page, so your list of openings can't appear there. No page on your website shows them yet. To put them on a page, ask whoever maintains your website.",
    );
  });

  it("an unreadable bundle says it could not check - and claims nothing", () => {
    expect(line({ kind: "unknown" })).toBe(
      "We couldn't check your published website, so we can't say where your openings appear.",
    );
  });

  it("treats a malformed mdxAst as no slot, never a throw", () => {
    const text = line({
      kind: "known",
      pages: [{ path: "/a", mdxAst: null }, { path: "/b", mdxAst: "x" }, { path: "/c", mdxAst: { blocks: "no" } }, { path: "/d", mdxAst: { blocks: [{ props: {} }, null] } }],
    });
    expect(text).toContain("are listed at");
  });
});
