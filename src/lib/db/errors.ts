/**
 * Database error utilities.
 *
 * No DB imports — safe to import from any server-side code path.
 *
 * Cause-depth note: the helper checks `err.cause.code` (one level deep).
 * A doubly-wrapped error (`err.cause.cause.code`) would not match. No
 * evidence Neon's serverless driver or Drizzle wrap two levels deep in
 * production; this is a documented bound, not a TODO.
 *
 * Locale note: the message-fallback regexp matches Postgres's English error
 * string. Neon Postgres runs English `lc_messages` by default and does not
 * expose locale configuration to tenants. The fallback is safe in practice;
 * if you ever run Postgres with a non-English locale, remove or localize it.
 */

/**
 * Returns true when `err` is a Postgres unique-constraint violation (23505).
 *
 * Neon's serverless driver may wrap the Postgres error in a `cause` field.
 * We check the top-level code, the one-level-deep cause code, and an
 * English message pattern as a final fallback.
 *
 * Callers must wrap their INSERT in try/catch and pass the caught value here.
 * On `true`, return a user-facing error appropriate to the context.
 * On `false`, re-throw — don't swallow genuine unexpected errors.
 */
export function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code?: unknown }).code)
      : undefined;
  if (codeOf(err) === "23505") return true;
  if (
    typeof err === "object" &&
    err !== null &&
    "cause" in err &&
    codeOf((err as { cause?: unknown }).cause) === "23505"
  ) {
    return true;
  }
  return (
    err instanceof Error &&
    /duplicate key value violates unique constraint/i.test(err.message)
  );
}

/**
 * Returns true when `err` is a Postgres exclusion-constraint violation
 * (23P01) — e.g. `officer_terms_no_overlap` (`drizzle/0009_presby_rls.sql`),
 * a GIST exclusion over `daterange(starts_on, coalesce(ends_on, 'infinity'))`
 * that rejects a second open term for the same person/office/org.
 *
 * Sibling to `isUniqueViolation()`, same cause-depth/locale bounds (see this
 * file's header) and the same "23503/23514/23P01 never collide" property
 * `docs/work-log/2026-07-01-unique-violation-helper.md` already confirmed
 * for FK/check/exclusion violations — this helper cannot mistake a
 * `officer_terms_org_unit_deacon_check` (23514) or an FK violation (23503)
 * for the exclusion case it exists to detect.
 *
 * Callers must wrap their INSERT in try/catch and pass the caught value here.
 * On `true`, return a user-facing error naming the conflicting term. On
 * `false`, re-throw — don't swallow genuine unexpected errors.
 */
export function isExclusionViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code?: unknown }).code)
      : undefined;
  if (codeOf(err) === "23P01") return true;
  if (
    typeof err === "object" &&
    err !== null &&
    "cause" in err &&
    codeOf((err as { cause?: unknown }).cause) === "23P01"
  ) {
    return true;
  }
  return (
    err instanceof Error &&
    /conflicting key value violates exclusion constraint/i.test(err.message)
  );
}

/**
 * One field of the Postgres error (`code` or `constraint`), found ANYWHERE in
 * the error's cause chain.
 *
 * Drizzle wraps the driver error in its own `Failed query: ...` error and puts
 * the original on `.cause`, so SQLSTATE and the constraint name are one or more
 * levels down. The roll and officer libraries map a SPECIFIC constraint to a
 * typed outcome (`roll_actions_one_pending_per_person_idx` to `pending_exists`,
 * `officer_terms_pastor_no_roll` to `on_roll`) and must not parse a message to
 * tell two unique violations apart. Depth-bounded (6) like the other walkers.
 */
export function pgErrorField(
  err: unknown,
  field: "code" | "constraint",
): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const value = (current as Record<string, unknown>)[field];
      // The Drizzle wrapper carries neither field, so the first string found
      // is the driver's own.
      if (typeof value === "string" && value !== "") return value;
      current = (current as { cause?: unknown }).cause;
    } else {
      return undefined;
    }
  }
  return undefined;
}

/** Every `.message` in the cause chain, joined: the driver's text sits below
 * Drizzle's own "Failed query" wrapper. */
export function pgErrorMessages(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string") parts.push(message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" :: ");
}

/** True when `err` is a Postgres error with this SQLSTATE and, when given,
 * this constraint name (anywhere in the cause chain). */
export function isPgError(
  err: unknown,
  code: string,
  constraint?: string,
): boolean {
  if (pgErrorField(err, "code") !== code) return false;
  return constraint === undefined || pgErrorField(err, "constraint") === constraint;
}
