import "server-only";

/**
 * The dashboard's per-card read wrapper (docs/work-log/
 * 2026-10-25-platform-admin-redesign-inc1.md, API Contract; Phase 2 R7a).
 *
 * Every card reads independently and catches its own failure, so one slow or
 * broken statement can never blank the page or, worse, turn into a zero. The
 * result is a union: a presenter cannot render `{kind:"error"}` as "Nothing
 * waiting", because there is no count on it to render (U2, E5).
 *
 * A failure is logged by CLASS only - the error's name, or its database error
 * code - never its message: a driver message can carry SQL text or a value
 * (E6). Nothing is cached here: a count shown on an operator's dashboard is read
 * fresh on every render.
 */

export type CardResult<T> = ({ kind: "ok" } & T) | { kind: "error" };

const SAFE_CLASS = /^[A-Za-z0-9_.-]{1,40}$/;

/** "DatabaseError/42P01", "TypeError", or "unknown": never the message. */
function errorClass(err: unknown): string {
  if (err === null || typeof err !== "object") return "unknown";
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  const safeName = typeof name === "string" && SAFE_CLASS.test(name) ? name : "Error";
  return typeof code === "string" && SAFE_CLASS.test(code) ? `${safeName}/${code}` : safeName;
}

export async function readCard<T extends object>(
  name: string,
  read: () => Promise<T>,
): Promise<CardResult<T>> {
  try {
    return { kind: "ok", ...(await read()) };
  } catch (err) {
    console.error(`[admin-dashboard] ${name} failed: ${errorClass(err)}`);
    return { kind: "error" };
  }
}

type Row = Record<string, unknown>;

/** The rows of whatever `execute()` returned (the pool driver returns `{ rows }`). */
export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] } | null)?.rows ?? []) as Row[];
}

/** A count column as a non-negative integer. A bigint arrives as a string; a missing or odd value is 0. */
export function toCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}
