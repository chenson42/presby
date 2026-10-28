/**
 * The screenshot capture guard's DECISION (R10, DECISION-new-2). Pure: e2e/help-shots/guard.ts
 * reads the database and hands this function a snapshot; vitest can run this file, which it
 * cannot do for e2e/. It fails closed, and every message states COUNTS ONLY, never a value, so
 * a refusal cannot itself leak the row that caused it.
 *
 *   G1  any organization slug outside FIXTURE_SLUGS
 *   G2  any organization_profiles row for an organization outside it, or with an email not ending
 *       .invalid, a phone not containing 555, or a website host not ending .invalid
 *   G3  any user email or active contact-method email not ending .invalid
 *   G4  the database (host AND name) of the DATABASE_URL the dev server uses differs from the one
 *       the guard read - two databases on one Neon branch share a host, so the name decides
 *   G5  HELP_SHOTS_DB_OK=1 is not set (the operator attests the branch is fixture-only;
 *       the guard checks, it does not decide)
 *   G6  any query threw
 *
 * Branch lineage is not trusted: a branch descended from `development` carries one real
 * organization profile row and fails G1/G2 unless it was reset.
 */

/**
 * Every slug scripts/seed-dev.sql and e2e/support/seed-orgs.ts insert. shots-guard.test.ts
 * reads both files as text and fails when one is missing from here.
 */
export const FIXTURE_SLUGS: readonly string[] = [
  "northern-reach",
  "alder-creek",
  "bramblewood",
  "quillhaven",
  "southern-fields",
  "western-basin",
  "coastal-plain-synod",
  "tidewater",
  "fernwood",
  "marrowbone",
  "e2e-presbytery",
  "e2e-alpha",
  "e2e-beta",
  "e2e-gamma",
];

export interface ShotsGuardProfile {
  organizationSlug: string;
  email: string | null;
  phone: string | null;
  websiteHost: string | null;
}

export interface ShotsGuardSnapshot {
  queryFailed: boolean;
  organizationSlugs: readonly string[];
  profiles: readonly ShotsGuardProfile[];
  userEmails: readonly string[];
  contactEmails: readonly string[];
  /** Identity (`host/database`, see dbIdentity) of the DATABASE_URL the dev server will use; null when unknown. */
  serverDbHost: string | null;
  /** Identity (`host/database`) of the owner connection the guard read; null when unknown. */
  ownerDbHost: string | null;
  attested: boolean;
}

export interface ShotsGuardViolation {
  rule: "G1" | "G2" | "G3" | "G4" | "G5" | "G6";
  count: number;
  message: string;
}

const endsInvalid = (s: string) => s.trim().toLowerCase().endsWith(".invalid");

export function decideShotsGuard(
  s: ShotsGuardSnapshot,
  fixtureSlugs: readonly string[] = FIXTURE_SLUGS,
): { ok: boolean; violations: ShotsGuardViolation[] } {
  const fixture = new Set(fixtureSlugs);
  const violations: ShotsGuardViolation[] = [];
  const add = (rule: ShotsGuardViolation["rule"], count: number, message: string) =>
    violations.push({ rule, count, message });

  const strangers = s.organizationSlugs.filter((slug) => !fixture.has(slug)).length;
  if (strangers > 0) add("G1", strangers, `G1: ${strangers} organization(s) outside the fixture list.`);

  const badProfiles = s.profiles.filter(
    (p) =>
      !fixture.has(p.organizationSlug) ||
      (p.email !== null && !endsInvalid(p.email)) ||
      (p.phone !== null && !p.phone.includes("555")) ||
      (p.websiteHost !== null && !endsInvalid(p.websiteHost)),
  ).length;
  if (badProfiles > 0) {
    add("G2", badProfiles, `G2: ${badProfiles} organization profile row(s) outside the fixture rules.`);
  }

  const badEmails = [...s.userEmails, ...s.contactEmails].filter((e) => !endsInvalid(e)).length;
  if (badEmails > 0) add("G3", badEmails, `G3: ${badEmails} user or contact email(s) not on the .invalid domain.`);

  if (s.serverDbHost === null || s.ownerDbHost === null || s.serverDbHost !== s.ownerDbHost) {
    add("G4", 1, "G4: the database the guard read is not provably the one the dev server uses.");
  }

  if (!s.attested) add("G5", 1, "G5: HELP_SHOTS_DB_OK=1 is not set; nobody has attested the branch is fixture-only.");

  if (s.queryFailed) add("G6", 1, "G6: a guard query failed, so the database could not be checked.");

  return { ok: violations.length === 0, violations };
}

// ---- From database rows to a snapshot (pure, so the mapping is unit-tested) --------------------------------------

/**
 * `host/database` of a connection string, or null when it is absent or unparseable. Two databases on
 * one Neon branch share a host, so G4 compares the database name too; the pooler suffix is dropped because
 * the app and owner URLs legitimately differ in it. Never logged.
 */
export function dbIdentity(connectionString: string | undefined | null): string | null {
  if (!connectionString) return null;
  try {
    const u = new URL(connectionString);
    const database = u.pathname.replace(/^\/+/, "");
    if (!u.hostname || !database) return null;
    // Neon serves one endpoint on a direct host and a pooled one (`ep-xxx-pooler.region...`); they are the same database.
    const host = u.hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
    return `${host}/${database}`;
  } catch {
    return null;
  }
}

/** The host of a URL-ish profile field; an unparseable non-empty value is returned as-is so it fails G2 (fail closed). */
export function urlHost(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return value.trim();
  }
}

export interface ShotsGuardRows {
  organizationSlugs: readonly string[];
  /** organization_profiles has a phone and five URL columns (facebook, instagram, x/twitter, youtube, other); it has no email column. */
  profiles: readonly { organizationSlug: string; phone: string | null; urls: readonly (string | null)[] }[];
  userEmails: readonly string[];
  contactEmails: readonly string[];
}

/**
 * Builds the snapshot decideShotsGuard reads. A profile's `websiteHost` is the first URL-column host that
 * is NOT on `.invalid` (so one real link fails G2), else a `.invalid` host, else null. `attestation` is
 * the raw HELP_SHOTS_DB_OK value: only the exact string "1" attests.
 */
export function buildShotsSnapshot(
  rows: ShotsGuardRows | null,
  env: { serverUrl: string | undefined; ownerUrl: string | undefined; attestation: string | undefined },
): ShotsGuardSnapshot {
  const base = {
    serverDbHost: dbIdentity(env.serverUrl),
    ownerDbHost: dbIdentity(env.ownerUrl),
    attested: env.attestation === "1",
  };
  if (rows === null) {
    return { ...base, queryFailed: true, organizationSlugs: [], profiles: [], userEmails: [], contactEmails: [] };
  }
  return {
    ...base,
    queryFailed: false,
    organizationSlugs: rows.organizationSlugs,
    profiles: rows.profiles.map((p) => {
      const hosts = p.urls.map(urlHost).filter((h): h is string => h !== null);
      return {
        organizationSlug: p.organizationSlug,
        email: null,
        phone: p.phone,
        websiteHost: hosts.find((h) => !endsInvalid(h)) ?? hosts[0] ?? null,
      };
    }),
    userEmails: rows.userEmails,
    contactEmails: rows.contactEmails,
  };
}

/** The refusal text: rule ids and counts only. */
export function describeShotsRefusal(violations: readonly ShotsGuardViolation[]): string {
  return [
    "[help-shots] REFUSING TO CAPTURE: this database is not provably fixture-only.",
    ...violations.map((v) => `  ${v.message}`),
    "Capture only against a database built from scratch (docs/testing.md) and seeded with scripts/seed-dev.sql; see the help:shots notes in the work-log.",
  ].join("\n");
}
