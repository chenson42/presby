/**
 * flags.ts — capture-then-restore for `feature_flags` rows.
 *
 * `getFlag`/`setFlag` were byte-identical in statistics-submit.spec.ts:69-81
 * and public-sites.spec.ts:108-120 before this extraction
 * (2026-09-28-presbytery-e2e, architect Phase 2 Notes §1b). `captureFlags()`
 * is the capture-then-restore pattern both specs hand-rolled in their own
 * `beforeAll`/`afterAll`, collapsed into one call.
 *
 * Every restore VERIFIES by SELECT rather than trusting the UPDATE succeeded
 * — public-sites.spec.ts:300-307's own precedent, generalized here. A flag
 * this suite fails to restore is GLOBAL state every spec that runs after it
 * inherits, so a silent restore failure is exactly the kind of thing that
 * must throw loudly rather than pass quietly.
 */

import type { Sql } from "./db";

export async function getFlag(sql: Sql, key: string): Promise<boolean> {
  const rows = (await sql`select enabled from feature_flags where key = ${key}`) as {
    enabled: boolean;
  }[];
  if (rows.length === 0) {
    throw new Error(`[flags] no feature_flags row for "${key}"`);
  }
  return rows[0].enabled;
}

export async function setFlag(sql: Sql, key: string, enabled: boolean): Promise<void> {
  await sql`update feature_flags set enabled = ${enabled} where key = ${key}`;
}

export interface FlagCapture {
  values: Record<string, boolean>;
  /**
   * Sets every captured flag back to its captured value, THEN re-reads each
   * by SELECT and throws on any mismatch — never trusts the UPDATE alone.
   */
  restore(): Promise<void>;
}

export async function captureFlags(sql: Sql, keys: string[]): Promise<FlagCapture> {
  const values: Record<string, boolean> = {};
  for (const key of keys) values[key] = await getFlag(sql, key);
  return {
    values,
    async restore() {
      for (const key of keys) await setFlag(sql, key, values[key]);
      for (const key of keys) {
        const restored = await getFlag(sql, key);
        if (restored !== values[key]) {
          throw new Error(
            `[flags] restore verification failed for "${key}": expected ` +
              `${values[key]}, got ${restored} — the suite is leaving GLOBAL ` +
              `flag state wrong for every spec that runs after this one.`,
          );
        }
      }
    },
  };
}
