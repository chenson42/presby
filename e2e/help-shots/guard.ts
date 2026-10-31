/**
 * guard.ts - the fail-closed database guard of the help screenshot capture (R10, G1 to G6).
 *
 * Reads the database the capture will run against on the OWNER connection (the one place besides
 * fixture setup the suite uses it) and hands the rows to src/lib/help/shots-guard.ts, which
 * decides. Counts and rule ids only ever leave this file: a refusal must not itself leak the
 * row that caused it, so no value is selected into an error message or a log line.
 *
 * It runs twice: in this project's globalSetup (before the standard setup writes the e2e roster
 * into whatever database is configured) and again in the spec's beforeAll (design: before any
 * navigation).
 */
import { neon } from "@neondatabase/serverless";
import {
  buildShotsSnapshot,
  decideShotsGuard,
  describeShotsRefusal,
  type ShotsGuardRows,
} from "../../src/lib/help/shots-guard";

async function readRows(ownerUrl: string): Promise<ShotsGuardRows | null> {
  try {
    const sql = neon(ownerUrl);
    const [orgs, profiles, users, contacts] = (await Promise.all([
      sql`select slug from organizations`,
      sql`
        select o.slug as organization_slug, p.phone,
               array[p.facebook_url, p.instagram_url, p.x_twitter_url, p.youtube_url, p.other_url] as urls
          from organization_profiles p
          left join organizations o on o.id = p.organization_id`,
      sql`select email from users where email is not null`,
      sql`select value from contact_methods where kind = 'email' and ended_at is null`,
    ])) as unknown as [
      { slug: string }[],
      { organization_slug: string | null; phone: string | null; urls: (string | null)[] }[],
      { email: string }[],
      { value: string }[],
    ];
    return {
      organizationSlugs: orgs.map((r) => r.slug),
      // A profile row whose organization cannot be joined has no slug: "" is outside every allow-list.
      profiles: profiles.map((r) => ({ organizationSlug: r.organization_slug ?? "", phone: r.phone, urls: r.urls })),
      userEmails: users.map((r) => r.email),
      contactEmails: contacts.map((r) => r.value),
    };
  } catch {
    return null; // G6
  }
}

/** Throws (rule ids and counts only) unless the configured database is provably fixture-only. */
export async function assertFixtureOnlyDatabase(): Promise<void> {
  const ownerUrl = process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL;
  const rows = ownerUrl ? await readRows(ownerUrl) : null;
  const snapshot = buildShotsSnapshot(rows, {
    // The dev server under test is started with the same environment; its DATABASE_URL must name the same database.
    serverUrl: process.env.DATABASE_URL,
    ownerUrl,
    attestation: process.env.HELP_SHOTS_DB_OK,
  });
  const verdict = decideShotsGuard(snapshot);
  if (!verdict.ok) throw new Error(describeShotsRefusal(verdict.violations));
}
