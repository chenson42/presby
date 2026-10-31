/**
 * The contact lane's globalSetup (`PW_HELP_CONTACT=1`; docs/work-log/2026-10-31-help-contact.md,
 * Phase 3 "E2E"). It signs NOBODY in and seeds NOTHING: the standard setup provisions the e2e roster
 * and signs in through the credentials form, and this lane's server has the Turnstile site key set,
 * which disables that form's submit button for everyone (playwright.config.ts, `isHelpContactRun`).
 * Rows are read through the owner connection, never through an admin session.
 *
 * What it does instead, in order:
 *   1. the database-isolation guard (the same rule as e2e/support/global-setup.ts; that one is not
 *      exported, and this lane's writes are permanent rows, so it runs first);
 *   2. on the production lane, the fingerprint that the server really is `next build && next start`;
 *   3. the canary: `/help/contact` renders the FORM (not the "unavailable" block). A server that was
 *      started without the keys would otherwise let every spec fail with a misleading selector error;
 *   4. the row budget: the table cannot be cleaned (never deleted, DECISION-300), and the definer
 *      refuses at 90 messages per hour, so a run that would trip it fails here, with the reason.
 */
import type { FullConfig } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { assertProductionServer } from "../support/global-setup";

function runDbIsolationGuard(): void {
  if (process.env.E2E_DATABASE_URL) return;
  let hostname: string;
  try {
    hostname = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return;
  }
  if (!hostname.endsWith(".neon.tech")) return;
  const message =
    "[help-contact globalSetup] DATABASE_URL points at a Neon shared database (*.neon.tech). This lane writes " +
    "permanent rows (help_contact_messages is never deleted). Set E2E_DATABASE_URL to a dedicated branch, or " +
    "E2E_ALLOW_SHARED_DB=true to accept the risk (a pipeline branch is the intended target).";
  if (process.env.E2E_ALLOW_SHARED_DB === "true") return;
  if (process.env.CI) throw new Error(message);
  console.warn(`\n${message}\n`);
}

/** Messages in the last hour above which this lane refuses to start: the definer's ceiling is 90. */
const BUDGET_PRECHECK = 60;

export default async function globalSetup(config: FullConfig): Promise<void> {
  runDbIsolationGuard();

  const baseURL = config.projects[0].use.baseURL ?? "http://localhost:3000";

  if (process.env.PW_PROD_BUILD === "1") await assertProductionServer(baseURL);

  const res = await fetch(`${baseURL}/help/contact`);
  const html = await res.text();
  if (!res.ok || !html.includes('data-testid="contact-form"')) {
    throw new Error(
      `[help-contact globalSetup] ${baseURL}/help/contact (HTTP ${res.status}) did not render the contact FORM. ` +
        "The server is missing the Turnstile keys, or is not the one this lane started (playwright.config.ts " +
        "starts it with Cloudflare's public test keys and reuseExistingServer: false). " +
        (html.includes("contact-unavailable") ? "It rendered the 'unavailable' block." : ""),
    );
  }

  const url = process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? "";
  if (!url) throw new Error("[help-contact globalSetup] no PLATFORM_DATABASE_URL: the lane reads its rows through the owner connection.");
  const sql = neon(url);
  const [row] = (await sql`select count(*)::int as n from help_contact_messages where created_at > now() - interval '1 hour'`) as { n: number }[];
  if ((row?.n ?? 0) >= BUDGET_PRECHECK) {
    throw new Error(
      `[help-contact globalSetup] ${row!.n} messages were stored in the last hour; the database ceiling is 90 per hour and rows ` +
        "cannot be deleted. Wait for the hour to pass, or point the lane at a fresh branch (this lane stores about 8 messages).",
    );
  }
}
