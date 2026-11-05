import type { AssignmentStatus } from "./vocab";

/**
 * The assignment state machine - docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 "Data Model -> The assignment guard" and DECISION-324. PURE.
 *
 * MIRRORS the BEFORE UPDATE trigger `presby_worship_assignments_guard_update`
 * (drizzle/0085 section 7o). `states.db.test.ts` drives every (from, to,
 * actor) pair through the real trigger and compares the outcome with
 * `canTransition`, so this file and the trigger cannot drift. Where they
 * disagree the trigger is the truth and this file is the bug.
 *
 * THE ACTOR KINDS. The trigger does not know a "session": it checks that the
 * NAMED person on the row may do the act (R7). Each kind is the column set the
 * trigger reads:
 *
 *   sender         draft -> requested; `sent_by_person_id` may schedule the team
 *   self           an answer with response_source 'self' and
 *                  responded_by_person_id = the assignee
 *   on_behalf      an answer with response_source 'on_behalf' and a
 *                  responded_by_person_id who may schedule the team
 *   link           response_source 'link': REFUSED in Increment 1
 *                  (`LINK_ACCEPTED` is the one switch Increment 1b flips)
 *   remover        withdrawn_reason 'removed' by a person who may schedule
 *   service_cancel withdrawn_reason 'service_cancelled', no actor, and the
 *                  event must already be cancelled
 *
 * Nothing returns to `draft`, and nothing leaves `withdrawn`.
 */

export type ActorKind = "sender" | "self" | "on_behalf" | "link" | "remover" | "service_cancel";
export const ACTOR_KINDS: readonly ActorKind[] = [
  "sender",
  "self",
  "on_behalf",
  "link",
  "remover",
  "service_cancel",
];

export type TransitionKind = "send" | "respond" | "withdraw";

/** Increment 1b replaces the trigger body and flips this. Until then `link` is refused. */
export const LINK_ACCEPTED = false;

const RESPONDABLE: readonly AssignmentStatus[] = ["draft", "requested", "confirmed", "declined"];

/**
 * Which kind of transition a (from, to) pair is, or null when no transition
 * exists. `confirmed -> confirmed` and `declined -> declined` are RE-ANSWERS
 * (a new responder, source or reason); any other same-status pair is no
 * transition at all (the trigger treats it as "no change").
 */
export function transitionKind(from: AssignmentStatus, to: AssignmentStatus): TransitionKind | null {
  if (from === "draft" && to === "requested") return "send";
  if ((to === "confirmed" || to === "declined") && RESPONDABLE.includes(from)) return "respond";
  if (to === "withdrawn" && from !== "withdrawn") return "withdraw";
  return null;
}

/** The actor kinds that may perform a transition kind. */
const ACTORS: Record<TransitionKind, readonly ActorKind[]> = {
  send: ["sender"],
  respond: ["self", "on_behalf"],
  withdraw: ["remover", "service_cancel"],
};

/**
 * Whether the trigger accepts `from -> to` for this actor, ignoring the
 * service's date state (see `serviceAllows`) and the actor's own authority
 * (the trigger's `may_schedule` / assignee check, exercised by the authority
 * tests). `guest` rows are born `confirmed` and have no answer to record.
 */
export function canTransition(
  from: AssignmentStatus,
  to: AssignmentStatus,
  actor: ActorKind,
  options: { guest?: boolean } = {},
): boolean {
  const kind = transitionKind(from, to);
  if (kind === null) return false;
  if (actor === "link" && !LINK_ACCEPTED) return false;
  if (options.guest && kind !== "withdraw") return false;
  if (actor === "link") return kind === "respond";
  return ACTORS[kind].includes(actor);
}

/** What the service's event looks like to the guard. */
export interface ServiceDateState {
  cancelled: boolean;
  started: boolean;
}

/**
 * The service conditions the trigger adds. Send and respond need a service
 * that is neither cancelled nor started. A withdrawal by a person ('removed')
 * has no service condition; a `service_cancel` withdrawal REQUIRES the event to
 * be cancelled.
 */
export function serviceAllows(
  kind: TransitionKind,
  actor: ActorKind,
  service: ServiceDateState,
): boolean {
  if (kind === "send" || kind === "respond") return !service.cancelled && !service.started;
  return actor === "service_cancel" ? service.cancelled : true;
}

/** True when an assignment in this status still counts toward a position being filled. */
export function isLive(status: AssignmentStatus): boolean {
  return status !== "withdrawn";
}

/** Statuses a cancel withdraws (drafts and open requests); confirmed and declined rows are retained. */
export function withdrawnByServiceCancel(status: AssignmentStatus): boolean {
  return status === "draft" || status === "requested";
}

/** Statuses that count against `slots` when "filled" is shown: draft, requested and confirmed. */
export function countsAsFilled(status: AssignmentStatus): boolean {
  return status === "draft" || status === "requested" || status === "confirmed";
}
