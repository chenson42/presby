/**
 * The screenshot capture guard's decision (R10, G1 to G6). One failing fixture per
 * rule, one clean fixture, and a counts-only check on every message.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_SLUGS,
  buildShotsSnapshot,
  dbIdentity,
  decideShotsGuard,
  describeShotsRefusal,
  urlHost,
  type ShotsGuardSnapshot,
} from "./shots-guard";

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

/** A connection string built from parts, so no literal `scheme://user:pass@host` sits in the source (check:secrets). */
const conn = (userinfo: string, hostAndDb: string) => `postgresql://${userinfo}@${hostAndDb}`;

describe("dbIdentity and urlHost", () => {
  it("is host/database, so two databases on one branch differ (G4)", () => {
    const a = dbIdentity(conn("u:p", "ep-x.invalid/neondb?sslmode=require"));
    const b = dbIdentity(conn("u2:p2", "EP-X.invalid/help_shots?sslmode=require"));
    expect(a).toBe("ep-x.invalid/neondb");
    expect(b).toBe("ep-x.invalid/help_shots");
    expect(a).not.toBe(b);
  });
  it("treats a pooled endpoint and its direct endpoint as the same database, but not a different endpoint", () => {
    const direct = dbIdentity(conn("u:p", "ep-cool-name-123456.region.invalid/help_shots"));
    const pooled = dbIdentity(conn("u:p", "ep-cool-name-123456-pooler.region.invalid/help_shots"));
    expect(pooled).toBe(direct);
    expect(dbIdentity(conn("u:p", "ep-other-name-654321-pooler.region.invalid/help_shots"))).not.toBe(direct);
  });
  it("never includes the user or password", () => {
    expect(dbIdentity(conn("someone:hunter2", "ep-x.invalid/db"))).not.toMatch(/someone|hunter2/);
  });
  it("is null for an absent, empty, database-less or unparseable string", () => {
    for (const bad of [undefined, null, "", "not a url", conn("u:p", "ep-x.invalid"), conn("u:p", "ep-x.invalid/")]) {
      expect(dbIdentity(bad as string | undefined)).toBeNull();
    }
  });
  it("urlHost reads a host, tolerates a missing scheme, and keeps an unparseable value so it fails G2", () => {
    expect(urlHost("https://Example.INVALID/page")).toBe("example.invalid");
    expect(urlHost("church.invalid")).toBe("church.invalid");
    expect(urlHost(null)).toBeNull();
    expect(urlHost("  ")).toBeNull();
    expect(urlHost("http://")).toBe("http://");
  });
});

describe("buildShotsSnapshot", () => {
  const env = { serverUrl: conn("a:b", "h.invalid/db1"), ownerUrl: conn("c:d", "h.invalid/db1"), attestation: "1" };
  const rows = {
    organizationSlugs: ["alder-creek"],
    profiles: [] as { organizationSlug: string; phone: string | null; urls: (string | null)[] }[],
    userEmails: ["a@example.invalid"],
    contactEmails: [] as string[],
  };

  it("a clean database passes through the decision", () => {
    expect(decideShotsGuard(buildShotsSnapshot(rows, env))).toEqual({ ok: true, violations: [] });
  });
  it("one real link among .invalid ones fails G2", () => {
    const snap = buildShotsSnapshot(
      { ...rows, profiles: [{ organizationSlug: "alder-creek", phone: "614-555-0100", urls: ["https://a.invalid/x", "https://church.org/x", null] }] },
      env,
    );
    expect(decideShotsGuard(snap).violations.map((v) => v.rule)).toEqual(["G2"]);
  });
  it("all-.invalid links, a 555 phone and no other fields pass", () => {
    const snap = buildShotsSnapshot(
      { ...rows, profiles: [{ organizationSlug: "alder-creek", phone: "614-555-0100", urls: ["https://a.invalid/x", null] }] },
      env,
    );
    expect(decideShotsGuard(snap).ok).toBe(true);
  });
  it("a query failure (null rows) is G6 and refuses", () => {
    const snap = buildShotsSnapshot(null, env);
    expect(decideShotsGuard(snap).violations.map((v) => v.rule)).toEqual(["G6"]);
  });
  it("a server on a different database of the same host is G4", () => {
    const snap = buildShotsSnapshot(rows, { ...env, serverUrl: conn("a:b", "h.invalid/neondb") });
    expect(decideShotsGuard(snap).violations.map((v) => v.rule)).toEqual(["G4"]);
  });
  it("only the exact string 1 attests (G5)", () => {
    for (const bad of [undefined, "", "0", "true", "yes", "1 "]) {
      expect(decideShotsGuard(buildShotsSnapshot(rows, { ...env, attestation: bad })).violations.map((v) => v.rule)).toEqual(["G5"]);
    }
  });
  it("the refusal text names rules and counts and carries no value", () => {
    const snap = buildShotsSnapshot(
      { ...rows, organizationSlugs: ["real-looking-slug-zq"], userEmails: ["person@example.com"] },
      { ...env, attestation: undefined },
    );
    const text = describeShotsRefusal(decideShotsGuard(snap).violations);
    expect(text).toMatch(/G1: 1 /);
    expect(text).toMatch(/G3: 1 /);
    expect(text).toMatch(/G5/);
    expect(text).not.toMatch(/real-looking-slug-zq|person@/);
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
