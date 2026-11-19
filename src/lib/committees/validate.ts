/**
 * Per-form parsing for the committees pages (docs/work-log/2026-11-19-
 * presbytery-committees.md, Phase 3 "Module and file plan" and Copy C4 to C8).
 * PURE: no database, no clock. `today` is INJECTED through `env`, never read from
 * the clock inside a rule, so a boundary test needs no fake timers.
 *
 * ONE RULE, TWO WRAPPERS. Each `parseX(values, env)` is the whole rule and takes
 * the form's STRING values (a form always submits strings). The matching
 * `xSchema(env)` is a thin zod object over the same function, for `zodResolver`,
 * so the client and the Server Action can never disagree: the action re-parses
 * the same object the client validated and trusts nothing (a value of the wrong
 * type reads as empty).
 *
 * Rules that need the STORED row (a change-role date against the seat's start and
 * planned end; a dissolve date against the latest seat that has begun) are the
 * store's, with the same messages; a form that already holds the seat passes it
 * as the optional last argument so its own check agrees.
 *
 * Every message comes from `copy.ts` (C4 to C8). Free text is cleaned (control
 * characters out, whitespace collapsed for a one-line field) and measured in code
 * points, exactly as Postgres `char_length` does.
 */
import { z } from "zod";
import { isCommitteeRole, type CommitteeRole } from "@/lib/group-roles";
import { isUuid } from "@/lib/is-uuid";
import { isCommitteeKind, LIMITS, type CommitteeKind } from "./contract";
import { addYears } from "./derive";
import { VALIDATION } from "./copy";

/** What the rules need from the outside world: today's date (`YYYY-MM-DD`). */
export interface ValidationEnv {
  today: string;
}

export type Parsed<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      /** field name to message, in the order the rules ran. */
      errors: Record<string, string>;
      /** The first error, for an action's single `{ field, message }`. */
      field: string;
      message: string;
    };

class Errors {
  readonly map: Record<string, string> = {};
  add(field: string, message: string): void {
    if (!(field in this.map)) this.map[field] = message;
  }
  get any(): boolean {
    return Object.keys(this.map).length > 0;
  }
  fail<T>(): Parsed<T> {
    const [field, message] = Object.entries(this.map)[0]!;
    return { ok: false, errors: this.map, field, message };
  }
}

// ---------------------------------------------------------------------------
// Helpers (exported for the unit tests and the forms)
// ---------------------------------------------------------------------------

const LINE_BREAK = /\r\n|\r|\n|\u2028|\u2029|\u0085/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** A one-line field: control characters become spaces, runs of spaces collapse, the ends are trimmed. */
export function cleanLine(raw: string): string {
  return raw.replace(CONTROL, " ").replace(/ {2,}/g, " ").trim();
}

/** A multi-line note: line breaks normalised to LF, other control characters dropped, the ends trimmed. */
export function cleanText(raw: string): string {
  return raw
    .replace(LINE_BREAK, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "")
    .trim();
}

/** Length in code points, as Postgres `char_length` counts (an emoji is one). */
export const charLength = (s: string): number => [...s].length;

/** A real calendar date `YYYY-MM-DD`, or null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return s;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A date field's read: empty, not a real day (or before the floor), or a day. */
type DateRead = { kind: "empty" } | { kind: "invalid" } | { kind: "date"; value: string };

function readDate(raw: unknown): DateRead {
  const s = str(raw).trim();
  if (s === "") return { kind: "empty" };
  const date = parseDate(s);
  if (date === null || date < LIMITS.dateFloor) return { kind: "invalid" };
  return { kind: "date", value: date };
}

// ---------------------------------------------------------------------------
// Create and edit a committee (C4)
// ---------------------------------------------------------------------------

export interface CommitteeValues {
  name: string;
  kind: string;
  purpose: string;
  meetsWhen: string;
}
export interface CommitteeInput {
  name: string;
  kind: CommitteeKind;
  purpose: string | null;
  meetsWhen: string | null;
}

export function parseCommittee(values: unknown): Parsed<CommitteeInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  const name = cleanLine(str(v.name));
  if (name === "") errors.add("name", VALIDATION.nameRequired);
  else if (charLength(name) > LIMITS.nameMax) errors.add("name", VALIDATION.nameTooLong);

  const kindRaw = str(v.kind);
  if (!isCommitteeKind(kindRaw)) errors.add("kind", VALIDATION.kindRequired);

  const purpose = cleanText(str(v.purpose));
  if (charLength(purpose) > LIMITS.purposeMax) errors.add("purpose", VALIDATION.purposeTooLong);

  const meetsWhen = cleanLine(str(v.meetsWhen));
  if (charLength(meetsWhen) > LIMITS.meetsWhenMax) errors.add("meetsWhen", VALIDATION.meetsWhenTooLong);

  if (errors.any) return errors.fail();
  return {
    ok: true,
    value: {
      name,
      kind: kindRaw as CommitteeKind,
      purpose: purpose === "" ? null : purpose,
      meetsWhen: meetsWhen === "" ? null : meetsWhen,
    },
  };
}

// ---------------------------------------------------------------------------
// Add a member (C5)
// ---------------------------------------------------------------------------

export interface SeatValues {
  personId: string;
  role: string;
  startsOn: string;
  endsOn: string;
}
export interface SeatInput {
  personId: string;
  role: CommitteeRole;
  startsOn: string;
  /** A planned end, or null (no set end). */
  endsOn: string | null;
}

export function parseSeat(values: unknown, env: ValidationEnv): Parsed<SeatInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  const personId = str(v.personId).trim();
  if (!isUuid(personId)) errors.add("personId", VALIDATION.personRequired);

  const roleRaw = str(v.role);
  if (!isCommitteeRole(roleRaw)) errors.add("role", VALIDATION.roleRequired);

  let startsOn: string | null = null;
  const start = readDate(v.startsOn);
  if (start.kind === "empty") errors.add("startsOn", VALIDATION.startRequired);
  else if (start.kind === "invalid") errors.add("startsOn", VALIDATION.dateInvalid);
  else if (start.value > addYears(env.today, LIMITS.startAheadYears)) errors.add("startsOn", VALIDATION.startTooFar);
  else startsOn = start.value;

  let endsOn: string | null = null;
  const end = readDate(v.endsOn);
  if (end.kind === "invalid") errors.add("endsOn", VALIDATION.dateInvalid);
  else if (end.kind === "date") {
    if (end.value > addYears(env.today, LIMITS.endAheadYears)) errors.add("endsOn", VALIDATION.endTooFar);
    else if (startsOn !== null && end.value <= startsOn) errors.add("endsOn", VALIDATION.endNotAfterStart);
    else endsOn = end.value;
  }

  if (errors.any) return errors.fail();
  return { ok: true, value: { personId, role: roleRaw as CommitteeRole, startsOn: startsOn!, endsOn } };
}

// ---------------------------------------------------------------------------
// Change a role (C6)
// ---------------------------------------------------------------------------

export interface ChangeRoleValues {
  newRole: string;
  effectiveOn: string;
}
export interface ChangeRoleInput {
  newRole: CommitteeRole;
  effectiveOn: string;
}

/** The seat a change-role form was opened on, when the caller holds it (the form does; the action's parse does not). */
export interface SeatFacts {
  role: string;
  startsOn: string;
  endsOn: string | null;
}

export function parseChangeRole(values: unknown, env: ValidationEnv, seat?: SeatFacts): Parsed<ChangeRoleInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  const roleRaw = str(v.newRole);
  if (!isCommitteeRole(roleRaw)) errors.add("newRole", VALIDATION.roleDifferent);
  else if (seat && roleRaw === seat.role) errors.add("newRole", VALIDATION.roleDifferent);

  let effectiveOn: string | null = null;
  const effective = readDate(v.effectiveOn);
  if (effective.kind !== "date") errors.add("effectiveOn", VALIDATION.dateInvalid);
  else if (effective.value > addYears(env.today, LIMITS.startAheadYears)) errors.add("effectiveOn", VALIDATION.effectiveTooFar);
  else if (seat && effective.value < seat.startsOn) errors.add("effectiveOn", VALIDATION.effectiveBeforeStart(seat.startsOn));
  else if (seat && seat.endsOn !== null && effective.value >= seat.endsOn) {
    errors.add("effectiveOn", VALIDATION.effectiveNotBeforeEnd(seat.endsOn));
  } else effectiveOn = effective.value;

  if (errors.any) return errors.fail();
  return { ok: true, value: { newRole: roleRaw as CommitteeRole, effectiveOn: effectiveOn! } };
}

// ---------------------------------------------------------------------------
// End a term (C7)
// ---------------------------------------------------------------------------

export interface EndSeatValues {
  endsOn: string;
}
export interface EndSeatInput {
  /** Null when the field was left empty: only a seat that has not started may be ended without one ("Cancel planned term"). */
  endsOn: string | null;
}

export function parseEndSeat(values: unknown, env: ValidationEnv, seat?: Pick<SeatFacts, "startsOn">): Parsed<EndSeatInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  let endsOn: string | null = null;
  const end = readDate(v.endsOn);
  if (end.kind === "invalid") errors.add("endsOn", VALIDATION.dateInvalid);
  else if (end.kind === "date") {
    if (end.value > addYears(env.today, LIMITS.endAheadYears)) errors.add("endsOn", VALIDATION.endTooFar);
    else if (seat && end.value < seat.startsOn) errors.add("endsOn", VALIDATION.endBeforeStart);
    else endsOn = end.value;
  }

  if (errors.any) return errors.fail();
  return { ok: true, value: { endsOn } };
}

// ---------------------------------------------------------------------------
// Dissolve (C8)
// ---------------------------------------------------------------------------

export interface DissolveValues {
  dissolvedOn: string;
}
export interface DissolveInput {
  dissolvedOn: string;
}

export function parseDissolve(values: unknown, env: ValidationEnv): Parsed<DissolveInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  let dissolvedOn: string | null = null;
  const on = readDate(v.dissolvedOn);
  if (on.kind !== "date") errors.add("dissolvedOn", VALIDATION.dateInvalid);
  else if (on.value > env.today) errors.add("dissolvedOn", VALIDATION.dissolveFuture);
  else dissolvedOn = on.value;

  if (errors.any) return errors.fail();
  return { ok: true, value: { dissolvedOn: dissolvedOn! } };
}

// ---------------------------------------------------------------------------
// Record a commission, edit it, end it (Increment 2, C15)
// ---------------------------------------------------------------------------

export interface CommissionValues {
  title: string;
  charge: string;
  /** Empty means "No congregation". A non-empty value is checked by the store against this presbytery's member congregations. */
  aboutOrgId: string;
  appointedOn: string;
  minuteReference: string;
}
export interface CommissionInput {
  title: string;
  charge: string | null;
  /** Null is "No congregation". A client value otherwise: the store resolves it (one neutral refusal for every miss). */
  aboutOrgId: string | null;
  appointedOn: string;
  minuteReference: string | null;
}

/**
 * A commission record's own fields (C15). The congregation is NOT validated here:
 * a malformed id, another presbytery's congregation, a non-congregation and a
 * nonexistent id must all read as the one `congregation_not_found` answer, and only
 * the store (which knows this presbytery) can give it. There is no ahead-limit on
 * `appointedOn` (C15 words none); the database's 1900 floor is the lower bound.
 */
export function parseCommission(values: unknown): Parsed<CommissionInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  const title = cleanLine(str(v.title));
  if (title === "") errors.add("title", VALIDATION.titleRequired);
  else if (charLength(title) > LIMITS.titleMax) errors.add("title", VALIDATION.titleTooLong);

  const charge = cleanText(str(v.charge));
  if (charLength(charge) > LIMITS.chargeMax) errors.add("charge", VALIDATION.chargeTooLong);

  const aboutOrgId = str(v.aboutOrgId).trim();

  let appointedOn: string | null = null;
  const appointed = readDate(v.appointedOn);
  if (appointed.kind === "empty") errors.add("appointedOn", VALIDATION.appointedRequired);
  else if (appointed.kind === "invalid") errors.add("appointedOn", VALIDATION.dateInvalid);
  else appointedOn = appointed.value;

  const minuteReference = cleanLine(str(v.minuteReference));
  if (charLength(minuteReference) > LIMITS.minuteMax) errors.add("minuteReference", VALIDATION.minuteTooLong);

  if (errors.any) return errors.fail();
  return {
    ok: true,
    value: {
      title,
      charge: charge === "" ? null : charge,
      aboutOrgId: aboutOrgId === "" ? null : aboutOrgId,
      appointedOn: appointedOn!,
      minuteReference: minuteReference === "" ? null : minuteReference,
    },
  };
}

/** The optimistic-lock token a form carries (`row_version`): a positive safe integer, or null. */
export function parseExpectedVersion(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * A commission member is a seat with the same fields and rules as a committee's
 * (the same six titles, the same date rules, the same limits: C15 "the person,
 * role and date fields and helpers of C5"), so it is the same parse.
 */
export const parseCommissionMember = parseSeat;

export interface EndCommissionValues {
  endedOn: string;
  endedMinuteReference: string;
}
export interface EndCommissionInput {
  endedOn: string;
  endedMinuteReference: string | null;
}

/** What a form that already holds the record passes so its own check agrees with the store's. */
export interface CommissionFacts {
  appointedOn: string;
}

export function parseEndCommission(values: unknown, env: ValidationEnv, record?: CommissionFacts): Parsed<EndCommissionInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  let endedOn: string | null = null;
  const ended = readDate(v.endedOn);
  if (ended.kind !== "date") errors.add("endedOn", VALIDATION.dateInvalid);
  else if (ended.value > env.today) errors.add("endedOn", VALIDATION.endedFuture);
  else if (record && ended.value < record.appointedOn) errors.add("endedOn", VALIDATION.endedBeforeAppointed(record.appointedOn));
  else endedOn = ended.value;

  const minute = cleanLine(str(v.endedMinuteReference));
  if (charLength(minute) > LIMITS.minuteMax) errors.add("endedMinuteReference", VALIDATION.minuteTooLong);

  if (errors.any) return errors.fail();
  return { ok: true, value: { endedOn: endedOn!, endedMinuteReference: minute === "" ? null : minute } };
}

// ---------------------------------------------------------------------------
// zod schemas for the forms (thin wrappers over the parsers above)
// ---------------------------------------------------------------------------

function refine<T extends z.ZodTypeAny>(
  schema: T,
  run: (values: z.infer<T>) => Parsed<unknown>,
): z.ZodType<z.infer<T>, z.infer<T>> {
  return schema.superRefine((values, ctx) => {
    const parsed = run(values);
    if (parsed.ok) return;
    for (const [field, message] of Object.entries(parsed.errors)) {
      ctx.addIssue({ code: "custom", path: [field], message });
    }
  }) as unknown as z.ZodType<z.infer<T>, z.infer<T>>;
}

export const committeeSchema = () =>
  refine(
    z.object({ name: z.string(), kind: z.string(), purpose: z.string(), meetsWhen: z.string() }),
    (values) => parseCommittee(values),
  );

export const seatSchema = (env: ValidationEnv) =>
  refine(
    z.object({ personId: z.string(), role: z.string(), startsOn: z.string(), endsOn: z.string() }),
    (values) => parseSeat(values, env),
  );

export const changeRoleSchema = (env: ValidationEnv, seat?: SeatFacts) =>
  refine(z.object({ newRole: z.string(), effectiveOn: z.string() }), (values) => parseChangeRole(values, env, seat));

export const endSeatSchema = (env: ValidationEnv, seat?: Pick<SeatFacts, "startsOn">) =>
  refine(z.object({ endsOn: z.string() }), (values) => parseEndSeat(values, env, seat));

export const dissolveSchema = (env: ValidationEnv) =>
  refine(z.object({ dissolvedOn: z.string() }), (values) => parseDissolve(values, env));

export const commissionSchema = () =>
  refine(
    z.object({ title: z.string(), charge: z.string(), aboutOrgId: z.string(), appointedOn: z.string(), minuteReference: z.string() }),
    (values) => parseCommission(values),
  );

export const commissionMemberSchema = seatSchema;

export const endCommissionSchema = (env: ValidationEnv, record?: CommissionFacts) =>
  refine(z.object({ endedOn: z.string(), endedMinuteReference: z.string() }), (values) => parseEndCommission(values, env, record));
