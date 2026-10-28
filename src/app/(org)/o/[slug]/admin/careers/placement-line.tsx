import { describePlacement, type PlacementInput } from "@/lib/careers/placement";

/**
 * The one line under the list's heading that says where the openings appear on the
 * church's published website (Copy S5; Phase 3 D8). It reports what the PUBLISHED
 * BUNDLE CONTAINS: it says "appear" only for a page whose blocks carry the `careers`
 * slot, never that a menu points at it, and when the bundle could not be read it says
 * so rather than guess. `careersAddress` is the `/careers` address as text (a Server
 * Component computes it from the platform origin; the page that renders this owns
 * that read).
 */

function joinPaths(paths: readonly string[]): string {
  if (paths.length <= 1) return paths.join("");
  return `${paths.slice(0, -1).join(", ")} and ${paths[paths.length - 1]}`;
}

export function PlacementLine({
  input,
  careersAddress,
}: {
  input: PlacementInput;
  careersAddress: string;
}) {
  const state = describePlacement(input);
  let text: string;
  switch (state.kind) {
    case "slot_and_list":
      text = `Your openings appear on your website's ${joinPaths(state.slotPaths)} ${state.slotPaths.length === 1 ? "page" : "pages"} and in a list at ${careersAddress}.`;
      break;
    case "slot_only":
      text = `Your openings appear on your website's ${joinPaths(state.slotPaths)} ${state.slotPaths.length === 1 ? "page" : "pages"}.`;
      break;
    case "list_only":
      text = `Your openings are listed at ${careersAddress}. No other page on your website shows them yet. To put them on a page, ask whoever maintains your website.`;
      break;
    case "own_page_no_slot":
      text =
        "Your website has its own /careers page, so your list of openings can't appear there. No page on your website shows them yet. To put them on a page, ask whoever maintains your website.";
      break;
    case "unknown":
      text = "We couldn't check your published website, so we can't say where your openings appear.";
      break;
  }
  return (
    <p data-testid="careers-placement" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}
