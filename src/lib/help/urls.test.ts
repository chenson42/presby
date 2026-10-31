import { describe, expect, it } from "vitest";
import { HELP_INDEX_HREF, PLANNED_INDEX_HREF, entryHref, helpHref, plannedEntryHref, plannedHref } from "./urls";

describe("help URLs", () => {
  it("exposes the index href", () => {
    expect(HELP_INDEX_HREF).toBe("/help");
  });
  // The registry is empty at first, so PublishedSlug and PlannedSlug are `never`:
  // every slug is a compile error, which is the R12 guarantee (a typo or a pending
  // slug cannot be linked). The runtime is two string concatenations; the casts below
  // exercise it without a registry entry.
  it("builds /help/<slug>[#anchor] and /help/planned/<slug>", () => {
    expect(helpHref("a-page" as never)).toBe("/help/a-page");
    expect(helpHref("a-page" as never, "an-anchor" as never)).toBe("/help/a-page#an-anchor");
    expect(plannedHref("a-plan" as never)).toBe("/help/planned/a-plan");
  });
  it("refuses a slug that is not in the registry, at compile time", () => {
    // @ts-expect-error no published page has this slug
    helpHref("no-such-page-anywhere");
    // @ts-expect-error no planned page has this slug
    plannedHref("no-such-plan-anywhere");
  });
  it("builds registry-driven hrefs from an entry's slug", () => {
    expect(entryHref({ slug: "signing-in" })).toBe("/help/signing-in");
    expect(plannedEntryHref({ slug: "worship-planning" })).toBe("/help/planned/worship-planning");
    expect(PLANNED_INDEX_HREF).toBe("/help/planned");
  });
});
