import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadHelpPage, loadHelpPageFrom } from "./content";
import { HELP_CONTACT_LINE, HELP_PRIVACY_CONTACT_FALLBACK } from "./contact";
import type { HelpEntry } from "./types";

const entry = (slug: string, status: "published" | "pending"): HelpEntry => ({
  slug, title: slug, summary: "s", order: 1, status, audience: "everyone", covers: [], labels: [], verifiedIn: status === "published" ? "0.47.0" : null,
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "help-content-"));
  writeFileSync(path.join(dir, "live.md"), "Body. {{contact}}\n");
  writeFileSync(path.join(dir, "waiting.md"), "Not yet.\n");
  writeFileSync(path.join(dir, "policy.md"), "Questions.\n\n{{privacyContact}}\n");
  return dir;
}

describe("loadHelpPageFrom", () => {
  const pages: HelpEntry[] = [entry("live", "published"), entry("waiting", "pending"), entry("policy", "published")];

  it("reads a published page and resolves {{contact}}", () => {
    const loaded = loadHelpPageFrom("live", { pages, dir: fixture() });
    expect(loaded?.entry.slug).toBe("live");
    expect(loaded?.markdown).toBe(`Body. ${HELP_CONTACT_LINE}\n`);
  });

  it("resolves {{privacyContact}} to the mailto sentence when an address is passed, and says so on the result", () => {
    const loaded = loadHelpPageFrom("policy", { pages, dir: fixture(), privacyContact: "privacy@example.invalid" });
    expect(loaded?.markdown).toBe(
      "Questions.\n\nEmail us at [privacy@example.invalid](mailto:privacy@example.invalid).\n",
    );
    expect(loaded?.privacyContact).toBe("privacy@example.invalid");
  });

  it("resolves {{privacyContact}} to the fallback when no address is passed", () => {
    const loaded = loadHelpPageFrom("policy", { pages, dir: fixture() });
    expect(loaded?.markdown).toBe(`Questions.\n\n${HELP_PRIVACY_CONTACT_FALLBACK}\n`);
    expect(loaded?.markdown).not.toContain("@");
    expect(loaded?.privacyContact).toBeNull();
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

describe("loadHelpPage — the privacy policy and HELP_PRIVACY_CONTACT_EMAIL (read at build)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("with the variable set: the contact is a mailto link to exactly that address", () => {
    vi.stubEnv("HELP_PRIVACY_CONTACT_EMAIL", "privacy@example.invalid");
    const loaded = loadHelpPage("privacy-policy");
    expect(loaded?.privacyContact).toBe("privacy@example.invalid");
    expect(loaded?.markdown).toContain("Email us at [privacy@example.invalid](mailto:privacy@example.invalid).");
    expect(loaded?.markdown).not.toContain("{{");
  });

  it("with the variable unset: the truthful fallback and no address anywhere on the page", () => {
    vi.stubEnv("HELP_PRIVACY_CONTACT_EMAIL", "");
    const loaded = loadHelpPage("privacy-policy");
    expect(loaded?.privacyContact).toBeNull();
    expect(loaded?.markdown).toContain(HELP_PRIVACY_CONTACT_FALLBACK);
    expect(loaded?.markdown).not.toMatch(/@|mailto:/);
  });

  it("a malformed value fails the load (the build) instead of publishing a wrong contact", () => {
    vi.stubEnv("HELP_PRIVACY_CONTACT_EMAIL", "not an address");
    expect(() => loadHelpPage("privacy-policy")).toThrow(/HELP_PRIVACY_CONTACT_EMAIL/);
  });

  it("the committed markdown holds the token and no address of any kind (the repository is public)", () => {
    const raw = readFileSync(path.join(process.cwd(), "src", "content", "help", "privacy-policy.md"), "utf8");
    expect(raw.match(/\{\{privacyContact\}\}/g)).toHaveLength(1);
    expect(raw).not.toMatch(/@|mailto:/);
  });
});
