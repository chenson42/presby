/**
 * Canonical server-action return type for this starter.
 *
 * All server actions called from a client component MUST return this shape.
 * The client component reads the result and calls toast.success() / toast.error().
 * Never call toast() inside a 'use server' function — it is browser-only.
 *
 * Expected failures (bad input, permission denied, conflict) are returned as
 *   { ok: false, error: "human-readable message" }
 * Truly unexpected errors (DB unavailable, etc.) may throw, which Next.js will
 * surface as an unhandled server-action error.
 *
 * The `error` string is end-user-visible. Keep it short and non-technical.
 */
export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
