import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadHelpPage, loadHelpPageFrom } from "./content";
import { HELP_CONTACT_LINE } from "./contact";
import type { HelpEntry } from "./types";

const entry = (slug: string, status: "published" | "pending"): HelpEntry => ({
  slug, title: slug, summary: "s", order: 1, status, audience: "everyone", covers: [], labels: [], verifiedIn: status === "published" ? "0.47.0" : null,
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "help-content-"));
  writeFileSync(path.join(dir, "live.md"), "Body. {{contact}}\n");
  writeFileSync(path.join(dir, "waiting.md"), "Not yet.\n");
  return dir;
}

describe("loadHelpPageFrom", () => {
  const pages: HelpEntry[] = [entry("live", "published"), entry("waiting", "pending")];

  it("reads a published page and resolves {{contact}}", () => {
    const loaded = loadHelpPageFrom("live", { pages, dir: fixture() });
    expect(loaded?.entry.slug).toBe("live");
    expect(loaded?.markdown).toBe(`Body. ${HELP_CONTACT_LINE}\n`);
  });

  it("is null for a pending page, an unknown slug and a traversal string", () => {
    const dir = fixture();
    expect(loadHelpPageFrom("waiting", { pages, dir })).toBeNull();
    expect(loadHelpPageFrom("nope", { pages, dir })).toBeNull();
    expect(loadHelpPageFrom("../../package", { pages, dir })).toBeNull();
    expect(loadHelpPageFrom("live/../waiting", { pages, dir })).toBeNull();
  });

  it("builds the path from the entry's slug, so a published entry's file is the only one read", () => {
    expect(() => loadHelpPageFrom("live", { pages, dir: path.join(tmpdir(), "no-such-help-dir") })).toThrow();
  });
});

describe("loadHelpPage (the real registry)", () => {
  it("loads a published page from src/content/help and resolves {{contact}}", () => {
    const loaded = loadHelpPage("getting-help");
    expect(loaded?.entry.slug).toBe("getting-help");
    expect(loaded?.markdown).toContain(HELP_CONTACT_LINE);
    expect(loaded?.markdown).not.toContain("{{contact}}");
  });

  it("is null for an unknown slug and a traversal string", () => {
    expect(loadHelpPage("no-such-page")).toBeNull();
    expect(loadHelpPage("../../package")).toBeNull();
  });
});
