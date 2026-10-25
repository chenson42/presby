/**
 * db.ts — the one place the e2e suite resolves the RLS-bypassing owner
 * connection string.
 *
 * Extracted from the three call sites that duplicated this resolution+throw
 * (statistics-submit.spec.ts, public-sites.spec.ts,
 * assert-fixture-invariants.ts) — e2e/support/flags.ts and
 * e2e/support/sasr-fixture.ts both depend on it, so a fourth and fifth copy
 * would have appeared today without this file (2026-09-28-presbytery-e2e,
 * architect Phase 2 Notes §1c).
 *
 * This is the one legitimate use of the owner connection in the suite, and it
 * is fixture setup / assertion plumbing, never application code — the same
 * justification e2e/support/seed-orgs.ts's own header gives for its own use
 * of it.
 */

import { neon } from "@neondatabase/serverless";

export type Sql = ReturnType<typeof neon<false, false>>;

/**
 * Resolves `E2E_PLATFORM_DATABASE_URL ?? PLATFORM_DATABASE_URL` and returns a
 * `neon()` client against it, or throws an actionable error naming the
 * calling spec/module.
 *
 * `specName` is threaded into the error message only — it never changes
 * behavior — so a thrown error names which spec's `beforeAll` was mid-flight
 * when the connection string was missing, rather than a bare "no platform
 * database URL" with no caller context.
 */
export function platformSql(specName: string): Sql {
  const url =
    process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? "";
  if (!url) {
    throw new Error(
      `[${specName}] No platform database URL. Set PLATFORM_DATABASE_URL ` +
        `(or E2E_PLATFORM_DATABASE_URL) in .env.local — this spec writes ` +
        `through the RLS-bypassing owner connection, same as e2e/support/seed-orgs.ts.`,
    );
  }
  return neon(url);
}

/** The shape of a dropped Neon connection (the HTTP driver's `fetch failed`, the pool's reset, a socket timeout). */
const DB_DROP = /fetch failed|Connection terminated|terminating connection|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|timeout|NeonDbError/i;

/**
 * Retries `step` with exponential backoff (0.5 s, 1 s, 2 s, 4 s) while it fails with a connection-drop error;
 * any other error (a constraint, a bug) is thrown at once. Every caller passes an IDEMPOTENT step, so a drop
 * that landed after the statement committed is harmless on the retry.
 */
export async function withDbRetry<T>(label: string, step: () => Promise<T>, opts: { attempts?: number; baseMs?: number } = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 500;
  for (let n = 1; ; n++) {
    try {
      return await step();
    } catch (err) {
      const message = String((err as { message?: unknown })?.message ?? err) + String((err as { cause?: unknown })?.cause ?? "");
      if (n >= attempts || !DB_DROP.test(message)) throw err;
      console.warn(`[e2e-db] ${label}: connection dropped, retry ${n}/${attempts - 1}`);
      await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** (n - 1)));
    }
  }
}
