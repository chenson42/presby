/**
 * domains-fixture.ts — owner-path fixture plumbing for `organization_domains`
 * (drizzle/0057_presby_org_domains.sql). TEST SUPPORT ONLY: imported by the
 * serial DB-backed Vitest suites (`src/lib/db/domain/domains.db.test.ts`) and,
 * from Batch 1c, by the Playwright `custom-hosts` specs. Never by application
 * code: src/lib/domains/service-only-writes.test.ts bans raw writes to this
 * table, and `alter table organization_domains`, anywhere under src/ outside a
 * test file (A4).
 *
 * THE ONE BACKDATING SEAM (Phase 3 Data Model item 8). `expires_at` is
 * immutable and `grace_ends_at` is trigger-owned, so no ordinary write can put
 * either in the past, on either connection. A test that needs a past clock
 * (`pending -> expired`, `grace_elapsed`, `lapsed_grace`) calls
 * backdateDomainClock(), which, inside ONE owner transaction, disables
 * `organization_domains_guard_update`, moves the date, and re-enables the
 * trigger before that transaction commits. Because ALTER TABLE is
 * transactional in Postgres, a failure anywhere inside rolls the DISABLE back
 * too: the trigger can never be left disabled. The ALTER takes an ACCESS
 * EXCLUSIVE lock on the table until commit, which is why this runs only in the
 * serial DB suites and e2e fixtures on a pipeline Neon branch.
 *
 * Rejected alternative (Phase 3): a GUC-driven clock override inside the
 * trigger. Any presby_app transaction can set a GUC, so that would hand every
 * tenant the grace bypass A1 exists to remove.
 *
 * The owner connection is the point: `presby_app` cannot ALTER the table, and
 * the trigger binds neondb_owner too, so only a disabled trigger lets the date
 * move. Names are synthetic (`*.invalid` hosts): No Real Data.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Sql } from "./db";

/** The three guards 0057 installs. Each must read `tgenabled = 'O'` after any backdate. */
export const DOMAIN_GUARD_TRIGGERS = [
  "organization_domains_guard_insert",
  "organization_domains_guard_update",
  "organization_domains_guard_delete",
] as const;

/** Anything with Drizzle's `execute` (a database or a transaction handle). */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/**
 * A Drizzle database or transaction handle. `transaction()` on a handle that
 * is already a transaction opens a SAVEPOINT, so the seam is always inside a
 * transaction no matter what the caller passes.
 */
export interface TransactionalExecutor extends SqlExecutor {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface DomainClock {
  /** New `expires_at` (governs `pending -> expired`). */
  expiresAt?: Date;
  /** New `grace_ends_at` (governs `lapsed|parked -> release_pending` by grace). */
  graceEndsAt?: Date;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  const r = result as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

function assertClock(clock: DomainClock) {
  if (clock.expiresAt === undefined && clock.graceEndsAt === undefined) {
    throw new Error("backdateDomainClock: pass expiresAt and/or graceEndsAt");
  }
}

/**
 * Move `expires_at` and/or `grace_ends_at` on one domain row, on the OWNER
 * connection (getPlatformDb() or one of its transactions). Throws if the row
 * does not exist; never leaves the update guard disabled.
 */
export async function backdateDomainClock(
  db: TransactionalExecutor,
  domainId: string,
  clock: DomainClock,
): Promise<void> {
  assertClock(clock);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table organization_domains disable trigger organization_domains_guard_update`,
    );
    const updated = rowsOf(
      await tx.execute(sql`
        update organization_domains
           set expires_at = coalesce(${clock.expiresAt?.toISOString() ?? null}::timestamptz, expires_at),
               grace_ends_at = coalesce(${clock.graceEndsAt?.toISOString() ?? null}::timestamptz, grace_ends_at)
         where id = ${domainId}
        returning id`),
    );
    await tx.execute(
      sql`alter table organization_domains enable trigger organization_domains_guard_update`,
    );
    if (updated.length !== 1) {
      throw new Error(`backdateDomainClock: no organization_domains row ${domainId}`);
    }
  });
}

/**
 * The same seam over the e2e suite's neon() HTTP client (e2e/support/db.ts):
 * one non-interactive transaction, so the three statements commit or roll
 * back together.
 */
export async function backdateDomainClockHttp(
  db: Sql,
  domainId: string,
  clock: DomainClock,
): Promise<void> {
  assertClock(clock);
  const expires = clock.expiresAt?.toISOString() ?? null;
  const grace = clock.graceEndsAt?.toISOString() ?? null;
  const results = await db.transaction([
    db`alter table organization_domains disable trigger organization_domains_guard_update`,
    db`update organization_domains
          set expires_at = coalesce(${expires}::timestamptz, expires_at),
              grace_ends_at = coalesce(${grace}::timestamptz, grace_ends_at)
        where id = ${domainId}
       returning id`,
    db`alter table organization_domains enable trigger organization_domains_guard_update`,
  ]);
  if (rowsOf(results[1]).length !== 1) {
    throw new Error(`backdateDomainClockHttp: no organization_domains row ${domainId}`);
  }
}

/** `tgenabled` for each of the three guards ('O' = enabled, origin). */
export async function domainGuardStates(db: SqlExecutor): Promise<Record<string, string>> {
  const rows = rowsOf(
    await db.execute(sql`
      select tgname::text as name, tgenabled::text as enabled
        from pg_trigger
       where tgrelid = 'organization_domains'::regclass and not tgisinternal`),
  );
  return Object.fromEntries(rows.map((r) => [String(r.name), String(r.enabled)]));
}
