// @vitest-environment jsdom
/**
 * Tests for `PersonCard` — the chevron/hover affordance added in
 * docs/work-log/2026-08-26-portal-ux-fixes.md, Wave 1B, finding L1: a real
 * navigable card that previously carried no "this goes somewhere" cue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// `PersonCard` pulls in `./person-avatar`, which imports the `server-only`
// `@/lib/storage/blob-store` — same mock `person-avatar.test.tsx` and
// `directory-grid.test.tsx` already use to keep this a jsdom-safe unit test.
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve: vi.fn(), resolveMeta: vi.fn(), store: vi.fn() }),
}));

import { PersonCard } from "./person-card";
import type { DirectoryEntry } from "@/lib/directory";

afterEach(cleanup);

const ENTRY: DirectoryEntry = {
  personId: "person-1",
  firstName: "Ada",
  lastName: "Lovelace",
  preferredName: null,
  email: "ada@example.invalid",
  phone: "555-0100",
  address: { city: "Alder Creek", region: "OH", line1: null, postalCode: null },
  dateOfBirth: null,
  photoKey: null,
};

describe("PersonCard — chevron affordance (L1)", () => {
  it("renders the name link with a trailing chevron that nudges on hover", () => {
    render(<PersonCard entry={ENTRY} photoSrc={null} slug="alder-creek" />);
    const link = screen.getByRole("link", { name: /ada lovelace/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory/person-1");
    const chevron = link.querySelector("svg.lucide-chevron-right");
    expect(chevron).toBeTruthy();
    expect(chevron?.getAttribute("class")).toContain("group-hover:translate-x-0.5");
  });

  it("scopes the group/chevron to the name link only, not the whole card — mailto/tel stay independent link targets", () => {
    render(<PersonCard entry={ENTRY} photoSrc={null} slug="alder-creek" />);
    const links = screen.getAllByRole("link");
    // name + mailto + tel = 3 independent links, none nested inside another
    expect(links.length).toBe(3);
    const mailLink = screen.getByRole("link", { name: /ada@example\.invalid/i });
    expect(mailLink.getAttribute("href")).toBe("mailto:ada@example.invalid");
    expect(mailLink.className).not.toContain("group");
  });

  it("keeps the existing hover:shadow-md lift on the outer Card", () => {
    const { container } = render(
      <PersonCard entry={ENTRY} photoSrc={null} slug="alder-creek" />,
    );
    const card = container.firstElementChild;
    expect(card?.className).toContain("hover:shadow-md");
  });
});
