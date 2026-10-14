/**
 * Runs a suite with the process time zone flipped to `timeZone`, then restores
 * it. Precedent: src/lib/format-date.test.ts flips process.env.TZ the same way.
 * Node re-reads TZ on assignment, so Date's local getters really move; the
 * guard below throws if they did not, so a test can never pass vacuously
 * because the override silently failed to take.
 *
 * Call it inside a `describe` block, passing vitest's own `beforeAll` and
 * `afterAll` (this module imports nothing from vitest, so it stays usable from
 * any runner).
 */
export function useProcessTimeZone(
  timeZone: string,
  hooks: {
    beforeAll: (fn: () => void) => void;
    afterAll: (fn: () => void) => void;
  },
): void {
  let original: string | undefined;
  hooks.beforeAll(() => {
    original = process.env.TZ;
    process.env.TZ = timeZone;
    const effective = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (effective !== timeZone) {
      throw new Error(
        `TZ override did not take: wanted ${timeZone}, got ${effective}`,
      );
    }
  });
  hooks.afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
}

/** The zones the wall-clock suites run under: UTC (Vercel), a DST zone, and a zone with no DST. */
export const TEST_TIME_ZONES = [
  "UTC",
  "America/New_York",
  "Pacific/Honolulu",
] as const;
