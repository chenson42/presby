import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DOMAIN_LABELS, PORTAL_TILES } from "@/lib/org-portal/tiles";
import { HELP_PAGES } from "./registry";

// QA run 1 (congregation records Inc 1), items 2 and 7 (amendment A1 and A5):
// the help page told a reader to open "Administration", but the tile sits on
// the portal home under its domain heading, and its audit sentence said
// "Every change", which brushes the F455 residual (the assessment write is
// audited just after commit). The navigation words are derived from the tile
// registry, not retyped, so a tile that moves fails this test.

const body = readFileSync(path.join(process.cwd(), "src/content/help/congregation-records.md"), "utf8");
const entry = HELP_PAGES.find((p) => p.slug === "congregation-records");
const tile = PORTAL_TILES.find((t) => t.key === "oversight");

describe("congregation-records help: how to reach the page", () => {
  it("finds the tile and the entry", () => {
    expect(tile).toBeDefined();
    expect(entry).toBeDefined();
  });

  it("names the portal home heading the tile is rendered under, from the tile registry", () => {
    // The home page renders `operate` tiles under DOMAIN_LABELS[tile.domain];
    // the Administration hub lists only `administer` tiles.
    expect(tile!.category).toBe("operate");
    const heading = DOMAIN_LABELS[tile!.domain];
    expect(body).toContain(`choose "${tile!.label}" under "${heading}"`);
    expect(body).not.toContain('Open "Administration"');
  });

  it("lists the heading, and not Administration, among the page's labels", () => {
    const labels = (entry as { labels: readonly string[] }).labels;
    expect(labels).toContain(DOMAIN_LABELS[tile!.domain]);
    expect(labels).toContain(tile!.label);
    expect(labels).not.toContain("Administration");
  });
});

describe("congregation-records help: the audit trail sentence (F455)", () => {
  it("does not claim every change is recorded, and states the assessment residual", () => {
    expect(body).not.toContain("Every change is recorded");
    expect(body).toContain('A change to the "Assessment" is recorded just after it is saved');
    expect(body).toContain("Looking at a record is not recorded.");
  });
});
