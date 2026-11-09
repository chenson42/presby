/**
 * The worship vocabularies - docs/work-log/2026-11-04-worship-inc1.md, Phase 3
 * "Module layout" (`vocab.ts`). PURE: no `server-only`, no database, no import
 * of the Drizzle mirror (that file pulls the schema in). `vocab.test.ts` pins
 * every list here EQUAL to the mirror's (`src/lib/db/domain/worship.ts`), which
 * is itself pinned to the migration's CHECKs, so the three cannot drift.
 */

/** The per-organization toggle (`ORG_FEATURE_CATALOG`). Toggle-only: no platform flag. */
export const WORSHIP_TOGGLE_KEY = "org_portal.worship" as const;

/** The three permission keys (migration 0085). All tier 1, none requires 2FA. */
export const WORSHIP_KEYS = {
  manage: "worship.manage",
  plan: "worship.plan",
  schedule: "worship.schedule",
} as const;
export type WorshipKeyName = keyof typeof WORSHIP_KEYS;
export const WORSHIP_KEY_NAMES = Object.keys(WORSHIP_KEYS) as WorshipKeyName[];

/** Which of the three keys a viewer holds, read live from the resolver. */
export type WorshipHas = Record<WorshipKeyName, boolean>;

export const NO_KEYS: WorshipHas = { manage: false, plan: false, schedule: false };

export function holdsAnyWorshipKey(has: WorshipHas): boolean {
  return has.manage || has.plan || has.schedule;
}

export const ASSIGNMENT_STATUSES = [
  "draft",
  "requested",
  "confirmed",
  "declined",
  "withdrawn",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** What a person (or a leader for them) can answer. `accepted` is stored as `confirmed`. */
export const ANSWERS = ["accepted", "declined"] as const;
export type Answer = (typeof ANSWERS)[number];

export function statusForAnswer(answer: Answer): "confirmed" | "declined" {
  return answer === "accepted" ? "confirmed" : "declined";
}

/** The closed reason list for a decline and for a blockout (R12, F425): no free text exists. */
export const REASONS = ["away", "work", "family", "other"] as const;
export type Reason = (typeof REASONS)[number];

export const REASON_LABELS: Readonly<Record<Reason, string>> = {
  away: "Away",
  work: "Work",
  family: "Family",
  other: "Other",
};

export function isReason(value: unknown): value is Reason {
  return typeof value === "string" && (REASONS as readonly string[]).includes(value);
}

/** What happened to a person's notice at Send, stored so the board can say why someone was not emailed. */
export const NOTICE_OUTCOMES = ["emailed", "guardian", "no_address", "do_not_contact"] as const;
export type NoticeOutcome = (typeof NOTICE_OUTCOMES)[number];

export const WITHDRAWN_REASONS = ["removed", "service_cancelled"] as const;
export type WithdrawnReason = (typeof WITHDRAWN_REASONS)[number];

/** `link` is valid in the vocabulary from day one and refused by the guard until Increment 1b. */
export const RESPONSE_SOURCES = ["self", "on_behalf", "link"] as const;
export type ResponseSource = (typeof RESPONSE_SOURCES)[number];

/** A team is a managed `team` or `choir` group. */
export const TEAM_KINDS = ["team", "choir"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];

/** The repeat patterns "Add several services" offers (a subset of `events/recurrence.ts`). */
export const SERVICE_PATTERNS = ["weekly", "biweekly", "monthly"] as const;
export type ServicePattern = (typeof SERVICE_PATTERNS)[number];

/** The four template keys (all `person:role`, none a credential key). */
export const WORSHIP_TEMPLATE_KEYS = {
  request: "worship.notice.request",
  reminder: "worship.notice.reminder",
  cancelled: "worship.notice.cancelled",
  declined: "worship.notice.declined",
} as const;
export type WorshipTemplateKey = (typeof WORSHIP_TEMPLATE_KEYS)[keyof typeof WORSHIP_TEMPLATE_KEYS];

/** Limits, server-side. Each mirrors a CHECK or trigger in 0085; the schema test pins the SQL side. */
export const LIMITS = {
  teamName: 80,
  teamDescription: 500,
  positionName: 60,
  positionsPerTeam: 40,
  slotsMin: 1,
  slotsMax: 20,
  serviceTypeName: 80,
  serviceTypeLocation: 200,
  durationMin: 15,
  durationMax: 480,
  guestName: 80,
  sendMaxAssignments: 200,
  sendMaxServices: 52,
  generateMax: 26,
  blockoutMaxDays: 366,
  blockoutLiveCap: 50,
  rosterSearchMax: 20,
  rosterSearchMinChars: 2,
  servicesListUpcoming: 100,
  servicesListEarlier: 20,
  noEndServiceHours: 2,
} as const;
