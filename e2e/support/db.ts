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

import { AsyncLocalStorage } from "node:async_hooks";
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

/** A SQLSTATE: five characters, at least one digit (so Node's `EPIPE` is not one). */
const SQLSTATE = /^(?=.*\d)[0-9A-Z]{5}$/;
/** Connection-level SQLSTATEs: class 08, admin/crash shutdown and startup, too many connections. */
const DROP_SQLSTATE = /^(08...|57P01|57P02|57P03|53300)$/;
/** A query the server cancelled on purpose: retrying a stall only makes it longer. */
const NOT_A_DROP = /statement timeout|lock timeout|canceling statement|idle-in-transaction/i;
/** The shape of a dropped Neon connection (the HTTP driver's `fetch failed`, the pool's reset, a connect timeout). */
const DB_DROP =
  /fetch failed|Connection terminated|terminating connection|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|UND_ERR_(CONNECT_TIMEOUT|SOCKET)|Connect Timeout Error/i;

function textOf(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const e = err as { message?: unknown; code?: unknown; cause?: unknown; sourceError?: unknown };
  const parts = [e.message];
  for (const inner of [e.cause, e.sourceError]) {
    if (typeof inner === "object" && inner !== null) {
      const i = inner as { message?: unknown; code?: unknown };
      parts.push(i.message, i.code);
    } else {
      parts.push(inner);
    }
  }
  return parts.filter((p) => p !== undefined && p !== null).map(String).join(" ");
}

/**
 * True only for a dropped connection. In order: (1) a server-side cancel
 * (statement, lock or idle-in-transaction timeout) is never a drop; (2) an error
 * with a SQLSTATE `code` is a drop only for connection-level states, so a unique
 * violation (23505) or a missing table (42P01) throws at once; (3) otherwise the
 * message, plus its `cause` and `sourceError` (a `fetch failed` arrives wrapped,
 * with no code), must read like a lost connection. The bare word "timeout" and
 * the bare class name `NeonDbError` retry nothing.
 */
export function isDbDrop(err: unknown): boolean {
  const text = textOf(err);
  if (NOT_A_DROP.test(text)) return false;
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && SQLSTATE.test(code)) return DROP_SQLSTATE.test(code);
  return DB_DROP.test(text);
}

/** Set while a withDbRetry step runs, so a nested withDbRetry does not multiply attempts. */
const inRetry = new AsyncLocalStorage<true>();

/**
 * Retries `step` with exponential backoff (0.5 s, 1 s, 2 s, 4 s; five attempts) while it fails with a
 * connection drop (`isDbDrop`); any other error (a constraint, a timeout, a bug) is thrown at once, and the
 * ORIGINAL error is rethrown after the last attempt. Only the outermost call retries: a withDbRetry inside
 * another runs its step once, so wrapping a composite and its parts never multiplies attempts.
 *
 * A step may be wrapped only if running it again after "it committed but the reply was lost" leaves the same
 * end state (a `fetch failed` can mean the statement landed). See the rules R1-R6 in docs/testing.md.
 */
export async function withDbRetry<T>(label: string, step: () => Promise<T>, opts: { attempts?: number; baseMs?: number } = {}): Promise<T> {
  if (inRetry.getStore()) return step();
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 500;
  return inRetry.run(true, async () => {
    for (let n = 1; ; n++) {
      try {
        return await step();
      } catch (err) {
        if (n >= attempts || !isDbDrop(err)) throw err;
        console.warn(`[e2e-db] ${label}: connection dropped, retry ${n}/${attempts - 1}`);
        await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** (n - 1)));
      }
    }
  });
}
