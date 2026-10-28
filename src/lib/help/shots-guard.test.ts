/**
 * The screenshot capture guard's decision (R10, G1 to G6). One failing fixture per
 * rule, one clean fixture, and a counts-only check on every message.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_SLUGS, decideShotsGuard, type ShotsGuardSnapshot } from "./shots-guard";

const clean = (over: Partial<ShotsGuardSnapshot> = {}): ShotsGuardSnapshot => ({
  queryFailed: false,
  organizationSlugs: ["alder-creek", "e2e-alpha"],
  profiles: [
    { organizationSlug: "alder-creek", email: "office@alder.invalid", phone: "614-555-0100", websiteHost: "alder.invalid" },
  ],
  userEmails: ["admin@example.invalid"],
  contactEmails: ["a@b.invalid"],
  serverDbHost: "ep-fixture-host.invalid",
  ownerDbHost: "ep-fixture-host.invalid",
  attested: true,
  ...over,
});
const rulesOf = (s: ShotsGuardSnapshot) =>
  decideShotsGuard(s)
    .violations.map((v) => v.rule)
    .sort();

describe("decideShotsGuard", () => {
  it("passes a fixture-only snapshot", () => {
    expect(decideShotsGuard(clean())).toEqual({ ok: true, violations: [] });
  });

  it("G1: an organization slug outside the fixture list refuses", () => {
    expect(rulesOf(clean({ organizationSlugs: ["alder-creek", "some-real-looking-slug"] }))).toEqual(["G1"]);
  });

  it("G2: a profile row for an organization outside the list refuses", () => {
    const s = clean({
      profiles: [{ organizationSlug: "not-a-fixture", email: null, phone: null, websiteHost: null }],
    });
    expect(rulesOf(s)).toEqual(["G2"]);
  });
  it("G2: a profile email not ending .invalid refuses", () => {
    const p = { organizationSlug: "alder-creek", email: "x@example.org", phone: "555-0100", websiteHost: null };
    expect(rulesOf(clean({ profiles: [p] }))).toEqual(["G2"]);
  });
  it("G2: a phone without 555 refuses", () => {
    const p = { organizationSlug: "alder-creek", email: null, phone: "ext 0100", websiteHost: null };
    expect(rulesOf(clean({ profiles: [p] }))).toEqual(["G2"]);
  });
  it("G2: a website host not ending .invalid refuses", () => {
    const p = { organizationSlug: "alder-creek", email: null, phone: null, websiteHost: "church.org" };
    expect(rulesOf(clean({ profiles: [p] }))).toEqual(["G2"]);
  });
  it("G2: null email, phone and website are fine", () => {
    const p = { organizationSlug: "alder-creek", email: null, phone: null, websiteHost: null };
    expect(decideShotsGuard(clean({ profiles: [p] })).ok).toBe(true);
  });

  it("G3: a user email not ending .invalid refuses", () => {
    expect(rulesOf(clean({ userEmails: ["someone@example.com"] }))).toEqual(["G3"]);
  });
  it("G3: a contact-method email not ending .invalid refuses", () => {
    expect(rulesOf(clean({ contactEmails: ["someone@example.com"] }))).toEqual(["G3"]);
  });
  it("G3: the check is case-insensitive about the suffix", () => {
    expect(decideShotsGuard(clean({ userEmails: ["A@B.INVALID"] })).ok).toBe(true);
  });

  it("G4: a different server and owner database host refuses", () => {
    expect(rulesOf(clean({ serverDbHost: "ep-one.invalid", ownerDbHost: "ep-two.invalid" }))).toEqual(["G4"]);
  });
  it("G4: an unknown host on either side refuses", () => {
    expect(rulesOf(clean({ serverDbHost: null }))).toEqual(["G4"]);
    expect(rulesOf(clean({ ownerDbHost: null }))).toEqual(["G4"]);
  });

  it("G5: no attestation refuses", () => {
    expect(rulesOf(clean({ attested: false }))).toEqual(["G5"]);
  });

  it("G6: a failed query refuses", () => {
    expect(rulesOf(clean({ queryFailed: true }))).toEqual(["G6"]);
  });

  it("reports every rule that fails, not only the first", () => {
    const s = clean({ attested: false, queryFailed: true, userEmails: ["a@example.com"] });
    expect(rulesOf(s)).toEqual(["G3", "G5", "G6"]);
  });

  it("names counts only, never a value", () => {
    const secrets = ["leaky-slug-xyz", "leaky@example.org", "ep-secret-one.invalid", "ep-secret-two.invalid", "church.org"];
    const s = clean({
      organizationSlugs: ["leaky-slug-xyz"],
      profiles: [{ organizationSlug: "leaky-slug-xyz", email: "leaky@example.org", phone: "1", websiteHost: "church.org" }],
      userEmails: ["leaky@example.org"],
      contactEmails: ["leaky@example.org"],
      serverDbHost: "ep-secret-one.invalid",
      ownerDbHost: "ep-secret-two.invalid",
    });
    const verdict = decideShotsGuard(s);
    expect(verdict.ok).toBe(false);
    const text = verdict.violations.map((v) => v.message).join("\n");
    for (const secret of secrets) expect(text).not.toContain(secret);
    for (const v of verdict.violations) {
      expect(v.message).toMatch(/\d/);
      expect(Number.isInteger(v.count)).toBe(true);
    }
  });
});

describe("FIXTURE_SLUGS stay in step with the seed files", () => {
  const root = path.resolve(__dirname, "../../..");

  it("includes every slug scripts/seed-dev.sql inserts into organizations", () => {
    const sql = readFileSync(path.join(root, "scripts/seed-dev.sql"), "utf8");
    const slugs: string[] = [];
    for (const block of sql.split(/insert into organizations\s*\(/i).slice(1)) {
      const body = block.split(";")[0];
      for (const m of body.matchAll(/'[a-z_]+',\s*'(?:[^']|'')*',\s*'([a-z0-9-]+)',\s*'[a-z0-9_]+',\s*'[a-z_]+'\)/g)) {
        slugs.push(m[1]);
      }
    }
    expect(slugs.length).toBeGreaterThanOrEqual(10); // the regex really matched
    for (const slug of slugs) expect(FIXTURE_SLUGS, slug).toContain(slug);
  });

  it("includes every slug e2e/support/seed-orgs.ts inserts", () => {
    const ts = readFileSync(path.join(root, "e2e/support/seed-orgs.ts"), "utf8");
    const slugs = [...ts.matchAll(/^\s*slug:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThanOrEqual(4);
    for (const slug of slugs) expect(FIXTURE_SLUGS, slug).toContain(slug);
  });

  it("has no duplicates", () => {
    expect(new Set(FIXTURE_SLUGS).size).toBe(FIXTURE_SLUGS.length);
  });
});
