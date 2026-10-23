import type { ActiveEmailRow, EmailSubtype } from "./types";

/**
 * Row builder for the module's unit tests (pure; imported only by `*.test.ts`).
 * `createdAt` defaults to a strictly increasing stamp, so the order rows are
 * built in is the canonical "oldest first" order unless a test says otherwise.
 */
let seq = 0;
export function row(
  id: string,
  opts: { subtype?: EmailSubtype | null; main?: boolean; dnc?: boolean; at?: string; value?: string } = {},
): ActiveEmailRow {
  seq += 1;
  return {
    id,
    value: opts.value ?? `${id}@example.invalid`,
    subtype: opts.subtype ?? null,
    isPrimary: opts.main ?? false,
    doNotContact: opts.dnc ?? false,
    createdAt: opts.at ?? `2026-01-01T00:${String(Math.floor(seq / 60) % 60).padStart(2, "0")}:${String(seq % 60).padStart(2, "0")}.000000Z`,
  };
}
