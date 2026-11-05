import { ACTION_COPY, MEMBER_COPY } from "./copy";

/**
 * The typed result every worship store export and read returns -
 * docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "Module layout"
 * (`WorshipResult<T>`). PURE: no `server-only`, no database.
 *
 * `not_applicable` and `toggle_off` come from the gate and carry no data;
 * `forbidden` means the viewer holds neither the key nor the seat the export
 * needs; `not_found` is ONE answer for "does not exist", "not yours" and
 * "another organization's" (the id-guessing hole: the response for another
 * person's assignment id equals the response for an unknown id).
 *
 * `conflict` carries the reason a page branches on and the sentence to show.
 */

export type ConflictReason =
  | "not_open"
  | "in_use"
  | "role_bound"
  | "duplicate_name"
  | "over_cap"
  | "mail_unavailable";

export type WorshipResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_applicable" }
  | { kind: "toggle_off" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_input"; message: string }
  | { kind: "conflict"; reason: ConflictReason; message: string };

export type WorshipFailure = Exclude<WorshipResult<never>, { kind: "ok" }>;

export const ok = <T>(data: T): WorshipResult<T> => ({ kind: "ok", data });
export const forbidden = (): WorshipFailure => ({ kind: "forbidden" });
export const notFound = (): WorshipFailure => ({ kind: "not_found" });
export const invalid = (message: string): WorshipFailure => ({ kind: "invalid_input", message });
export const conflict = (reason: ConflictReason, message: string): WorshipFailure => ({
  kind: "conflict",
  reason,
  message,
});

// ---------------------------------------------------------------------------
// Database errors -> results
// ---------------------------------------------------------------------------

function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  while (cur && out.length < 6) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

/** A string field (`code`, `constraint`) from an error or anything in its `cause` chain. */
export function pgField(err: unknown, field: "code" | "constraint"): string | undefined {
  for (const e of chain(err)) {
    const v = (e as Record<string, unknown> | null)?.[field];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/**
 * Maps a guard or constraint refusal to the result a page shows, or `null` for
 * an error that is not one of ours (the caller rethrows it). Guards set their
 * CONSTRAINT field to a stable `worship_guard_<code>` (`WORSHIP_GUARD_CODES`),
 * so the mapping never reads message text.
 *
 * Where the sentence needs a name ("{team} has been retired.") the store
 * pre-checks and names it; the mapping here is the fallback for a race the
 * pre-check lost, and says only that the page has changed.
 */
export function mapDatabaseError(err: unknown): WorshipFailure | null {
  const constraint = pgField(err, "constraint");
  const code = pgField(err, "code");
  switch (constraint) {
    case "worship_guard_service_cancelled":
      return conflict("not_open", ACTION_COPY.serviceCancelled);
    case "worship_guard_service_started":
      return conflict("not_open", ACTION_COPY.serviceStarted);
    case "worship_guard_not_authorized":
      return forbidden();
    case "worship_guard_blockout_past":
      return invalid(MEMBER_COPY.blockouts.inPast);
    case "worship_guard_blockout_cap":
      return conflict("over_cap", MEMBER_COPY.blockouts.tooMany);
    case "worship_guard_team_not_eligible":
      return invalid(ACTION_COPY.generic);
    case "worship_guard_team_retired":
    case "worship_guard_position_retired":
    case "worship_guard_service_team_removed":
    case "worship_guard_not_on_roster":
    case "worship_guard_illegal_transition":
    case "worship_guard_terminal":
    case "worship_guard_immutable":
    case "worship_guard_set_once":
    case "worship_guard_guest_shape":
    case "worship_guard_link_not_accepted":
      return conflict("not_open", ACTION_COPY.stale);
    case "worship_positions_live_name_idx":
    case "worship_service_types_live_name_idx":
      return conflict("duplicate_name", ACTION_COPY.stale);
    case "worship_assignments_live_person_idx":
      return conflict("not_open", ACTION_COPY.stale);
    default:
      break;
  }
  // A foreign key or unique violation that no guard pre-empted: the page the
  // person acted on is out of date.
  if (code === "23503" || code === "23505") return conflict("not_open", ACTION_COPY.stale);
  return null;
}
