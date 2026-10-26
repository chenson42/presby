/**
 * Where a congregation's openings appear on its published website - pure
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Pure helpers", Copy S5).
 *
 * The status line the staff list shows is a report of what the PUBLISHED BUNDLE
 * CONTAINS, nothing more: it says "appear" only for a page whose blocks carry the
 * `careers` live slot, and it says it could not check when it could not read the
 * bundle. It does not claim a menu points at the page.
 *
 * `findSlotPages` mirrors site-kit's own defensive `extractBlocks`
 * (`dist/index.js`): a page's `mdxAst` that is not a record, a `blocks` that is
 * not an array, a block without a string `type`, and a `props` that is not a
 * record are all treated as "no block", never thrown. A legacy `{ raw }` page
 * simply has no slot.
 */
import { CAREERS_SLOT } from "./contract";

export interface BundlePage {
  path: string;
  mdxAst: unknown;
}

/** What the reader could learn: the bundle's pages, or that it could not read them. */
export type PlacementInput = { kind: "known"; pages: BundlePage[] } | { kind: "unknown" };

/** The path where PresbyPortal's own list lives; a bundle page here wins over it. */
export const CAREERS_PAGE_PATH = "/careers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Paths of the pages carrying a `liveSlot` block whose `props.slot` equals `slot`, in bundle order. */
export function findSlotPages(pages: BundlePage[], slot: string): string[] {
  const found: string[] = [];
  for (const page of pages) {
    if (!isRecord(page) || typeof page.path !== "string") continue;
    const ast = page.mdxAst;
    if (!isRecord(ast) || !Array.isArray(ast.blocks)) continue;
    const carries = ast.blocks.some((block: unknown) => {
      if (!isRecord(block) || typeof block.type !== "string") return false;
      if (block.type !== "liveSlot") return false;
      const props = isRecord(block.props) ? block.props : {};
      return props.slot === slot;
    });
    if (carries) found.push(page.path);
  }
  return found;
}

/** True when the bundle has a page of its own at exactly `/careers` (the path the renderer would match). */
export function hasOwnCareersPage(pages: BundlePage[]): boolean {
  return pages.some((page) => isRecord(page) && page.path === CAREERS_PAGE_PATH);
}

/** The four states of Copy S5, plus the one for an unreadable bundle. */
export type PlacementState =
  /** A slot page exists, and the platform list at /careers is also live. */
  | { kind: "slot_and_list"; slotPaths: string[] }
  /** A slot page exists, and the site's own /careers page replaces the list. */
  | { kind: "slot_only"; slotPaths: string[] }
  /** No slot anywhere; only the platform list at /careers. */
  | { kind: "list_only" }
  /** No slot anywhere, and the site's own /careers page hides the list: nothing shows the openings. */
  | { kind: "own_page_no_slot" }
  | { kind: "unknown" };

export function describePlacement(input: PlacementInput): PlacementState {
  if (input.kind === "unknown") return { kind: "unknown" };
  const slotPaths = findSlotPages(input.pages, CAREERS_SLOT);
  const ownPage = hasOwnCareersPage(input.pages);
  if (slotPaths.length > 0) {
    return ownPage ? { kind: "slot_only", slotPaths } : { kind: "slot_and_list", slotPaths };
  }
  return ownPage ? { kind: "own_page_no_slot" } : { kind: "list_only" };
}

/** The slice of `SiteUrls` the back link needs. */
export interface BackTargetUrls {
  home(): string;
  page(bundlePath: string): string;
  careers(): string;
}

/**
 * Where the posting page's "All job openings" link goes: the first page that
 * carries the slot, else the platform list when the bundle has no page of its
 * own at /careers, else the site home. An unreadable bundle falls back to the
 * platform list, which serves either the list or the bundle's own page.
 */
export function careersBackTarget(input: PlacementInput, urls: BackTargetUrls): string {
  if (input.kind === "unknown") return urls.careers();
  const slotPaths = findSlotPages(input.pages, CAREERS_SLOT);
  if (slotPaths.length > 0) return urls.page(slotPaths[0]!);
  return hasOwnCareersPage(input.pages) ? urls.home() : urls.careers();
}
