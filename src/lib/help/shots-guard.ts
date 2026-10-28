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
 *   G4  the host of the DATABASE_URL the dev server uses differs from the host the guard read
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
  /** Host of the DATABASE_URL the dev server will use; null when unknown. */
  serverDbHost: string | null;
  /** Host of the owner connection the guard read; null when unknown. */
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
