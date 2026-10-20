/**
 * Bulk re-attach of every attached custom domain to the CURRENT Vercel project.
 *
 * RUNBOOK - when the platform moves to a different Vercel project (or the
 * project's domains are lost):
 *   1. Set VERCEL_API_TOKEN (scoped to the NEW project), VERCEL_PROJECT_ID and
 *      VERCEL_TEAM_ID for the new project, and PLATFORM_DATABASE_URL for the
 *      database to read (all in the shell or .env.local; never committed).
 *   2. Dry run first - it calls nothing and lists what it would attach:
 *        npx dotenv -e .env.local -- tsx scripts/domains/reattach.ts
 *   3. Apply:
 *        npx dotenv -e .env.local -- tsx scripts/domains/reattach.ts --apply
 *      Re-run safely: the provider's add is idempotent, so a host already on
 *      the project reports "already_attached". It writes nothing to the
 *      database. It stops at once if the provider refuses the credentials.
 *   4. Each church's DNS may need no change (generic targets keep working), but
 *      the provider may issue new certificates, so expect a short TLS gap; the
 *      sweep's live-ness probe re-confirms every host within a few cron ticks.
 *   5. Confirm with the platform admin domains list that every host is `live`.
 *
 * Which hosts, and why, is documented in src/lib/domains/reattach.ts. Exit code
 * 0 = every host attached (or a clean dry run), 1 = some failed, 2 = bad usage.
 */
import { neon } from "@neondatabase/serverless";
import { VercelHosting } from "../../src/lib/domains/adapters/vercel";
import { REATTACH_STATES, reattachAll, type ReattachRow } from "../../src/lib/domains/reattach";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--apply" && a !== "--dry-run");
  if (unknown.length > 0 || (args.includes("--apply") && args.includes("--dry-run"))) {
    console.error("usage: reattach.ts [--dry-run | --apply]   (default: --dry-run)");
    return 2;
  }
  const apply = args.includes("--apply");

  const databaseUrl = process.env.PLATFORM_DATABASE_URL;
  if (!databaseUrl) {
    console.error("Set PLATFORM_DATABASE_URL (the owner connection) to read the attached hosts.");
    return 2;
  }
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (apply && (!token || !projectId)) {
    console.error("Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for a team project) to apply.");
    return 2;
  }
  console.log(`project: ${projectId ?? "(not set; dry run)"}  team: ${process.env.VERCEL_TEAM_ID ?? "(none)"}`);

  const sql = neon(databaseUrl);
  const rows = (await sql`
    select hostname, state
      from organization_domains
     where purpose = 'web'
       and state = any(${REATTACH_STATES as unknown as string[]})
  `) as ReattachRow[];

  const hosting = new VercelHosting({
    token: token ?? "unused-in-dry-run",
    projectId: projectId ?? "unused-in-dry-run",
    teamId: process.env.VERCEL_TEAM_ID || undefined,
  });
  const report = await reattachAll(rows, hosting, { apply, log: (line) => console.log(line) });

  console.log(JSON.stringify({ apply: report.apply, total: report.total, byOutcome: report.byOutcome, failed: report.failed.length, aborted: report.aborted }));
  return report.failed.length > 0 || report.aborted ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.name : "failed");
    process.exit(1);
  },
);
