import "server-only";
import type { OrgTx } from "@/lib/authz";
import type { EventActor } from "@/lib/events/insert";
import { onServiceCancelledInTx, onServiceUpdatedInTx } from "@/lib/worship/event-hooks";

/**
 * The event fan-out: what other modules do, in the writer's own transaction,
 * when an event is cancelled or when its start, end or place changes
 * (DECISION-326; worship Increment 1, Batch 0; architect addendum C1, C4, S1).
 *
 * TWO RUNNERS, ONE LIST EACH. `runEventCancelledHooks` is called by
 * `mutate.ts#cancelEventInTx` only on the transition (an already-cancelled
 * event runs no hook). `runEventUpdatedHooks` is called by
 * `mutate.ts#updateEventFieldsInTx` and by `events.ts#updateEvent`. Each runs
 * its consumers in order, in the CALLER'S transaction: a consumer that throws
 * rolls the whole cancel or edit back (stated behaviour).
 *
 * `{ queueIds }` (S1) is every `email_queue` id the consumers wrote, combined.
 * A caller that wants send-after-commit (sign-ups) can use them; one that relies
 * on the five-minute cron (worship) ignores them.
 *
 * IMPORT RULE (C1). `hooks.ts` imports its consumers; a consumer never imports
 * `@/lib/events` (the file), `events/{mutate,hooks,insert}.ts` or
 * `worship/store.ts`, directly or through any file it imports (`import type`
 * is allowed - it is erased). `events/boundaries.source.test.ts` walks the
 * static imports reachable from this file and fails on any such path. A
 * consumer takes its argument types from this file with `import type`.
 *
 * Both lists were EMPTY in Batch 0 (the refactor shipped green on its own).
 * Worship Increment 1 (Batch 3) adds its line to each: `onServiceCancelledInTx`
 * and `onServiceUpdatedInTx` from `worship/event-hooks.ts` (the update handler
 * is a no-op in Increment 1; it is the registered place a later increment
 * reacts to a service move, F430). Sign-ups adds its own hook-only file(s) at
 * its integration, under the same import rule.
 */

/** The start, end and place of an event: what the update hooks are given before and after. */
export interface EventWhenWhere {
  /** Wall-clock digits in the UTC fields (DECISION-113 ruling 3); not an instant. */
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
}

export interface EventCancelledHookInput {
  organizationId: string;
  eventId: string;
  /** Who cancelled; null when the caller had no session actor. */
  actor: EventActor | null;
}

export interface EventUpdatedHookInput {
  organizationId: string;
  eventId: string;
  before: EventWhenWhere;
  after: EventWhenWhere;
}

export interface EventHookResult {
  queueIds: string[];
}

export type EventCancelledHook = (
  tx: OrgTx,
  input: EventCancelledHookInput,
) => Promise<EventHookResult>;

export type EventUpdatedHook = (
  tx: OrgTx,
  input: EventUpdatedHookInput,
) => Promise<EventHookResult>;

/** Runs `hooks` in order against one input and combines their queue ids. */
export async function runHookList<I>(
  hooks: ReadonlyArray<(tx: OrgTx, input: I) => Promise<EventHookResult>>,
  tx: OrgTx,
  input: I,
): Promise<EventHookResult> {
  const queueIds: string[] = [];
  for (const hook of hooks) {
    const result = await hook(tx, input);
    queueIds.push(...result.queueIds);
  }
  return { queueIds };
}

/** One line per consumer. */
const CANCELLED_HOOKS: ReadonlyArray<EventCancelledHook> = [onServiceCancelledInTx];

/** One line per consumer. */
const UPDATED_HOOKS: ReadonlyArray<EventUpdatedHook> = [onServiceUpdatedInTx];

export function runEventCancelledHooks(
  tx: OrgTx,
  input: EventCancelledHookInput,
): Promise<EventHookResult> {
  return runHookList(CANCELLED_HOOKS, tx, input);
}

export function runEventUpdatedHooks(
  tx: OrgTx,
  input: EventUpdatedHookInput,
): Promise<EventHookResult> {
  return runHookList(UPDATED_HOOKS, tx, input);
}
