/**
 * Per-form parsing for the congregation records (docs/work-log/2026-11-17-
 * congregation-profile.md, Phase 3 "Module and file plan" and Copy C9). PURE:
 * no database, no clock. `year` and `today` are INJECTED through `env`, never
 * read from the clock inside a rule, so a boundary test needs no fake timers.
 *
 * ONE RULE, TWO WRAPPERS. Each `parseX(values, env)` is the whole rule and takes
 * the form's STRING values (a form always submits strings; booleans are the one
 * exception, a checkbox). The matching `xSchema(env)` is a thin zod object over
 * the same function, for `zodResolver`, so the client and the Server Action can
 * never disagree: the action re-parses the same object the client validated and
 * trusts nothing (a malformed value of the wrong type reads as empty).
 *
 * Every message comes from `copy.ts` (C9); a message not in the Copy section
 * does not belong here.
 *
 * Money is integer cents from a decimal string, never a float; a year is a
 * four-digit string; a date is a real calendar day; free text is cleaned
 * (control characters out, whitespace collapsed for a one-line field) and
 * measured in code points, exactly as Postgres `char_length` does.
 */
import { z } from "zod";
import { normalizeAddress } from "@/lib/site-address";
import {
  BUILDING_TYPES,
  CONDITIONS,
  LIMITS,
  LOAN_KINDS,
  RETIRE_REASONS,
  valuesOf,
  type BuildingType,
  type Condition,
  type LoanKind,
  type RetireReason,
} from "./contract";
import { REFUSAL, VALIDATION } from "./copy";

/** What the rules need from the outside world: the current year and today's date (`YYYY-MM-DD`). */
export interface ValidationEnv {
  year: number;
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

export type YearRead = { kind: "empty" } | { kind: "format" } | { kind: "year"; value: number };

/** A four-digit year, or why not. Range is the caller's, because each field names its own bounds. */
export function parseYear(raw: string): YearRead {
  const s = raw.trim();
  if (s === "") return { kind: "empty" };
  if (!/^\d{4}$/.test(s)) return { kind: "format" };
  return { kind: "year", value: Number(s) };
}

export type MoneyRead =
  | { kind: "empty" }
  | { kind: "format" }
  | { kind: "too_large" }
  | { kind: "cents"; value: number };

const MONEY_RE = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/**
 * Dollars to integer cents. Accepts `1250000`, `1,250,000`, `$5`, `1250000.50`;
 * refuses `1e5`, `-1`, `12.345`, `.5` and anything else. Never a float: the
 * whole part is cut by digit count before any number is made.
 */
export function parseMoneyToCents(raw: string): MoneyRead {
  const s = raw.trim().replace(/^\$\s*/, "");
  if (s === "") return { kind: "empty" };
  const m = MONEY_RE.exec(s);
  if (!m) return { kind: "format" };
  const whole = m[1]!.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  // $1,000,000,000 is ten digits; anything with more than ten is over the ceiling without making a number.
  if (whole.length > 10) return { kind: "too_large" };
  const cents = Number(whole) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (cents > LIMITS.moneyMaxCents) return { kind: "too_large" };
  return { kind: "cents", value: cents };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

type FieldClean = { ok: true; value: string | null } | { ok: false; message: string };

function textLine(raw: unknown, max: number, tooLong: string): FieldClean {
  const s = cleanLine(str(raw));
  if (s === "") return { ok: true, value: null };
  if (charLength(s) > max) return { ok: false, message: tooLong };
  return { ok: true, value: s };
}

function textNotes(raw: unknown, max: number, tooLong: string): FieldClean {
  const s = cleanText(str(raw));
  if (s === "") return { ok: true, value: null };
  if (charLength(s) > max) return { ok: false, message: tooLong };
  return { ok: true, value: s };
}

/** Optional year with its own field label and bounds: null when empty. */
function optionalYear(errors: Errors, field: string, raw: unknown, label: string, env: ValidationEnv): number | null {
  const read = parseYear(str(raw));
  if (read.kind === "empty") return null;
  if (read.kind === "format") {
    errors.add(field, VALIDATION.yearFormat(label));
    return null;
  }
  if (read.value < LIMITS.yearMin || read.value > env.year) {
    errors.add(field, VALIDATION.yearRange(label, env.year));
    return null;
  }
  return read.value;
}

function optionalList<V extends string>(errors: Errors, field: string, raw: unknown, allowed: readonly V[]): V | null {
  const s = str(raw);
  if (s === "") return null;
  if ((allowed as readonly string[]).includes(s)) return s as V;
  errors.add(field, VALIDATION.conditionNotInList);
  return null;
}

/** A Yes / No / Not recorded select. A tampered value is refused with the generic "nothing was changed" line (no Copy string names it). */
function triState(errors: Errors, field: string, raw: unknown, tamperedMessage: string): boolean | null {
  const s = str(raw);
  if (s === "") return null;
  if (s === "yes") return true;
  if (s === "no") return false;
  errors.add(field, tamperedMessage);
  return null;
}

/** An optional money field: null when empty; an error on the field otherwise. */
function optionalMoney(errors: Errors, field: string, raw: unknown): number | null {
  const read = parseMoneyToCents(str(raw));
  if (read.kind === "empty") return null;
  if (read.kind === "format") {
    errors.add(field, VALIDATION.moneyFormat);
    return null;
  }
  if (read.kind === "too_large") {
    errors.add(field, VALIDATION.moneyTooLarge);
    return null;
  }
  return read.value;
}

/** An optional date field: null when empty; "Enter a valid date." when present and not a real day. */
function optionalDate(errors: Errors, field: string, raw: unknown): string | null {
  const s = str(raw).trim();
  if (s === "") return null;
  const date = parseDate(s);
  if (date === null) {
    errors.add(field, VALIDATION.dateInvalid);
    return null;
  }
  return date;
}

// The one generic line a tampered select value gets (the design's Copy has no string for a choice the form never offers).
const TAMPERED = REFUSAL.save_failed;

// ---------------------------------------------------------------------------
// Profile (C3)
// ---------------------------------------------------------------------------

export interface ProfileValues {
  streetAddress: string;
  city: string;
  county: string;
  yearOrganized: string;
  phone: string;
}
export interface ProfileInput {
  streetAddress: string | null;
  city: string | null;
  county: string | null;
  yearOrganized: number | null;
  phone: string | null;
}

const PHONE_RE = /^[0-9 +().xX-]+$/;

export function parseProfile(values: unknown, env: ValidationEnv): Parsed<ProfileInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  let streetAddress: string | null = null;
  const address = normalizeAddress(str(v.streetAddress));
  if (!address.ok) errors.add("streetAddress", address.error);
  else streetAddress = address.value === "" ? null : address.value;

  const city = textLine(v.city, LIMITS.cityMax, VALIDATION.cityTooLong);
  if (!city.ok) errors.add("city", city.message);
  const county = textLine(v.county, LIMITS.countyMax, VALIDATION.countyTooLong);
  if (!county.ok) errors.add("county", county.message);

  let yearOrganized: number | null = null;
  const year = parseYear(str(v.yearOrganized));
  if (year.kind === "format") errors.add("yearOrganized", VALIDATION.yearOrganizedFormat);
  else if (year.kind === "year") {
    if (year.value < LIMITS.yearMin || year.value > env.year) {
      errors.add("yearOrganized", VALIDATION.yearOrganizedRange(env.year));
    } else yearOrganized = year.value;
  }

  let phone: string | null = null;
  const phoneRaw = cleanLine(str(v.phone));
  if (phoneRaw !== "") {
    if (charLength(phoneRaw) > LIMITS.phoneMax || !PHONE_RE.test(phoneRaw)) errors.add("phone", VALIDATION.phone);
    else phone = phoneRaw;
  }

  if (errors.any) return errors.fail();
  return {
    ok: true,
    value: {
      streetAddress,
      city: city.ok ? city.value : null,
      county: county.ok ? county.value : null,
      yearOrganized,
      phone,
    },
  };
}

// ---------------------------------------------------------------------------
// Building (C5)
// ---------------------------------------------------------------------------

export interface BuildingValues {
  name: string;
  buildingType: string;
  primary: boolean;
  yearBuilt: string;
  firstAdditionYear: string;
  secondAdditionYear: string;
  squareFeet: string;
  roofCondition: string;
  plumbingCondition: string;
  hvacCondition: string;
  boilerCondition: string;
  hasSprinklers: string;
  hasFireAlarm: string;
  hasSecuritySystem: string;
  notes: string;
}
export interface BuildingInput {
  name: string;
  buildingType: BuildingType;
  primary: boolean;
  yearBuilt: number | null;
  firstAdditionYear: number | null;
  secondAdditionYear: number | null;
  squareFeet: number | null;
  roofCondition: Condition | null;
  plumbingCondition: Condition | null;
  hvacCondition: Condition | null;
  boilerCondition: Condition | null;
  hasSprinklers: boolean | null;
  hasFireAlarm: boolean | null;
  hasSecuritySystem: boolean | null;
  notes: string | null;
}

const COMMA_THOUSANDS_RE = /^\d{1,3}(?:,\d{3})+$/;

export function parseBuilding(values: unknown, env: ValidationEnv): Parsed<BuildingInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  const name = cleanLine(str(v.name));
  if (name === "") errors.add("name", VALIDATION.buildingNameRequired);
  else if (charLength(name) > LIMITS.buildingNameMax) errors.add("name", VALIDATION.buildingNameTooLong);

  const type = str(v.buildingType);
  const buildingType = (valuesOf(BUILDING_TYPES) as readonly string[]).includes(type) ? (type as BuildingType) : null;
  if (buildingType === null) errors.add("buildingType", VALIDATION.buildingTypeRequired);

  const yearBuilt = optionalYear(errors, "yearBuilt", v.yearBuilt, "Year built", env);
  const firstAdditionYear = optionalYear(errors, "firstAdditionYear", v.firstAdditionYear, "First addition", env);
  const secondAdditionYear = optionalYear(errors, "secondAdditionYear", v.secondAdditionYear, "Second addition", env);
  if (firstAdditionYear !== null && yearBuilt !== null && firstAdditionYear < yearBuilt) {
    errors.add("firstAdditionYear", VALIDATION.firstAdditionBeforeBuilt);
  }
  if (secondAdditionYear !== null) {
    if (firstAdditionYear === null && str(v.firstAdditionYear).trim() === "") {
      errors.add("secondAdditionYear", VALIDATION.secondAdditionNeedsFirst);
    } else if (firstAdditionYear !== null && secondAdditionYear < firstAdditionYear) {
      errors.add("secondAdditionYear", VALIDATION.secondAdditionBeforeFirst);
    }
  }

  let squareFeet: number | null = null;
  const sfRaw = str(v.squareFeet).trim();
  if (sfRaw !== "") {
    const digits = COMMA_THOUSANDS_RE.test(sfRaw) ? sfRaw.replace(/,/g, "") : sfRaw;
    if (!/^\d+$/.test(digits) || Number(digits) < LIMITS.squareFeetMin) errors.add("squareFeet", VALIDATION.squareFeetFormat);
    else if (digits.length > 7 || Number(digits) > LIMITS.squareFeetMax) errors.add("squareFeet", VALIDATION.squareFeetTooMany);
    else squareFeet = Number(digits);
  }

  const conditions = valuesOf(CONDITIONS);
  const roofCondition = optionalList(errors, "roofCondition", v.roofCondition, conditions);
  const plumbingCondition = optionalList(errors, "plumbingCondition", v.plumbingCondition, conditions);
  const hvacCondition = optionalList(errors, "hvacCondition", v.hvacCondition, conditions);
  const boilerCondition = optionalList(errors, "boilerCondition", v.boilerCondition, conditions);

  const hasSprinklers = triState(errors, "hasSprinklers", v.hasSprinklers, TAMPERED);
  const hasFireAlarm = triState(errors, "hasFireAlarm", v.hasFireAlarm, TAMPERED);
  const hasSecuritySystem = triState(errors, "hasSecuritySystem", v.hasSecuritySystem, TAMPERED);

  const notes = textNotes(v.notes, LIMITS.buildingNotesMax, VALIDATION.notesTooLong(LIMITS.buildingNotesMax));
  if (!notes.ok) errors.add("notes", notes.message);

  if (errors.any || buildingType === null || !notes.ok) return errors.fail();
  return {
    ok: true,
    value: {
      name,
      buildingType,
      primary: v.primary === true,
      yearBuilt,
      firstAdditionYear,
      secondAdditionYear,
      squareFeet,
      roofCondition,
      plumbingCondition,
      hvacCondition,
      boilerCondition,
      hasSprinklers,
      hasFireAlarm,
      hasSecuritySystem,
      notes: notes.value,
    },
  };
}

export interface RetireValues {
  reason: string;
  retiredOn: string;
}
export interface RetireInput {
  reason: RetireReason;
  retiredOn: string;
}

export function parseRetire(values: unknown, env: ValidationEnv): Parsed<RetireInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();
  const reasonRaw = str(v.reason);
  const reason = (valuesOf(RETIRE_REASONS) as readonly string[]).includes(reasonRaw) ? (reasonRaw as RetireReason) : null;
  if (reason === null) errors.add("reason", VALIDATION.retireReasonRequired);
  const date = parseDate(str(v.retiredOn));
  if (date === null) errors.add("retiredOn", VALIDATION.dateRequired);
  else if (date > env.today) errors.add("retiredOn", VALIDATION.dateInFuture);
  if (errors.any || reason === null || date === null) return errors.fail();
  return { ok: true, value: { reason, retiredOn: date } };
}

// ---------------------------------------------------------------------------
// Appraisal (C6)
// ---------------------------------------------------------------------------

export interface AppraisalValues {
  assessedYear: string;
  amount: string;
  notes: string;
}
export interface AppraisalInput {
  assessedYear: number;
  amountCents: number;
  notes: string | null;
}

export function parseAppraisal(values: unknown, env: ValidationEnv): Parsed<AppraisalInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  let assessedYear: number | null = null;
  const year = parseYear(str(v.assessedYear));
  if (year.kind === "empty") errors.add("assessedYear", VALIDATION.assessedYearRequired);
  else if (year.kind === "format" || year.value < LIMITS.yearMin || year.value > env.year) {
    errors.add("assessedYear", VALIDATION.assessedYearRange(env.year));
  } else assessedYear = year.value;

  let amountCents: number | null = null;
  const money = parseMoneyToCents(str(v.amount));
  if (money.kind === "empty") errors.add("amount", VALIDATION.appraisalAmountRequired);
  else if (money.kind === "format") errors.add("amount", VALIDATION.moneyFormat);
  else if (money.kind === "too_large") errors.add("amount", VALIDATION.moneyTooLarge);
  else if (money.value <= 0) errors.add("amount", VALIDATION.appraisalAmountPositive);
  else amountCents = money.value;

  const notes = textNotes(v.notes, LIMITS.appraisalNotesMax, VALIDATION.notesTooLong(LIMITS.appraisalNotesMax));
  if (!notes.ok) errors.add("notes", notes.message);

  if (errors.any || assessedYear === null || amountCents === null || !notes.ok) return errors.fail();
  return { ok: true, value: { assessedYear, amountCents, notes: notes.value } };
}

// ---------------------------------------------------------------------------
// Insurance (C7)
// ---------------------------------------------------------------------------

export interface InsuranceValues {
  /** Ignored when editing: the policy year is not editable (remove and re-record). */
  policyYear: string;
  carrier: string;
  policyNumber: string;
  policyExpiresOn: string;
  recentClaims: string;
  poolInterest: string;
  notes: string;
}
export interface InsuranceInput {
  /** Null when parsed in `edit` mode. */
  policyYear: number | null;
  carrier: string | null;
  policyNumber: string | null;
  policyExpiresOn: string | null;
  recentClaims: boolean | null;
  poolInterest: boolean | null;
  notes: string | null;
}

export function parseInsurance(values: unknown, env: ValidationEnv, mode: "create" | "edit"): Parsed<InsuranceInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  let policyYear: number | null = null;
  if (mode === "create") {
    const year = parseYear(str(v.policyYear));
    if (year.kind === "empty") errors.add("policyYear", VALIDATION.policyYearRequired);
    else if (year.kind === "format" || year.value < LIMITS.policyYearMin || year.value > env.year + 1) {
      errors.add("policyYear", VALIDATION.policyYearRange(env.year + 1));
    } else policyYear = year.value;
  }

  const carrier = textLine(v.carrier, LIMITS.carrierMax, VALIDATION.carrierTooLong);
  if (!carrier.ok) errors.add("carrier", carrier.message);
  const policyNumber = textLine(v.policyNumber, LIMITS.policyNumberMax, VALIDATION.policyNumberTooLong);
  if (!policyNumber.ok) errors.add("policyNumber", policyNumber.message);
  const policyExpiresOn = optionalDate(errors, "policyExpiresOn", v.policyExpiresOn);
  const recentClaims = triState(errors, "recentClaims", v.recentClaims, TAMPERED);
  const poolInterest = triState(errors, "poolInterest", v.poolInterest, TAMPERED);
  const notes = textNotes(v.notes, LIMITS.insuranceNotesMax, VALIDATION.notesTooLong(LIMITS.insuranceNotesMax));
  if (!notes.ok) errors.add("notes", notes.message);

  if (errors.any || !carrier.ok || !policyNumber.ok || !notes.ok) return errors.fail();
  return {
    ok: true,
    value: {
      policyYear,
      carrier: carrier.value,
      policyNumber: policyNumber.value,
      policyExpiresOn,
      recentClaims,
      poolInterest,
      notes: notes.value,
    },
  };
}

// ---------------------------------------------------------------------------
// Loan (C8)
// ---------------------------------------------------------------------------

export interface LoanValues {
  kind: string;
  lender: string;
  originalAmount: string;
  currentBalance: string;
  balanceAsOf: string;
  grantsAmount: string;
  guaranteeNote: string;
  notes: string;
  /** The status the form shows: "open" or "paid_off". Only a paid-off loan going back to "open" changes anything. */
  status: string;
}
export interface LoanInput {
  kind: LoanKind;
  lender: string | null;
  originalAmountCents: number | null;
  currentBalanceCents: number | null;
  balanceAsOf: string | null;
  grantsAmountCents: number | null;
  guaranteeNote: string | null;
  notes: string | null;
  status: "open" | "paid_off";
}

export function parseLoan(values: unknown, env: ValidationEnv): Parsed<LoanInput> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();

  const kindRaw = str(v.kind);
  const kind = (valuesOf(LOAN_KINDS) as readonly string[]).includes(kindRaw) ? (kindRaw as LoanKind) : null;
  if (kind === null) errors.add("kind", VALIDATION.loanKindRequired);

  const lender = textLine(v.lender, LIMITS.lenderMax, VALIDATION.lenderTooLong);
  if (!lender.ok) errors.add("lender", lender.message);

  const originalAmountCents = optionalMoney(errors, "originalAmount", v.originalAmount);
  const currentBalanceCents = optionalMoney(errors, "currentBalance", v.currentBalance);
  const grantsAmountCents = optionalMoney(errors, "grantsAmount", v.grantsAmount);

  // A balance is always dated and a date always has a balance (the loans CHECK).
  const balanceAsOf = optionalDate(errors, "balanceAsOf", v.balanceAsOf);
  const balanceTouched = str(v.currentBalance).trim() !== "";
  const dateTouched = str(v.balanceAsOf).trim() !== "";
  if (!("balanceAsOf" in errors.map) && !("currentBalance" in errors.map)) {
    if (balanceTouched && !dateTouched) errors.add("balanceAsOf", VALIDATION.balanceDateRequired);
    else if (dateTouched && !balanceTouched) errors.add("currentBalance", VALIDATION.balanceRequiredForDate);
    else if (balanceAsOf !== null && balanceAsOf > env.today) errors.add("balanceAsOf", VALIDATION.dateInFuture);
  }

  const guaranteeNote = textNotes(v.guaranteeNote, LIMITS.guaranteeNoteMax, VALIDATION.guaranteeTooLong);
  if (!guaranteeNote.ok) errors.add("guaranteeNote", guaranteeNote.message);
  const notes = textNotes(v.notes, LIMITS.loanNotesMax, VALIDATION.notesTooLong(LIMITS.loanNotesMax));
  if (!notes.ok) errors.add("notes", notes.message);

  const statusRaw = str(v.status);
  const status = statusRaw === "paid_off" ? "paid_off" : statusRaw === "open" || statusRaw === "" ? "open" : null;
  if (status === null) errors.add("status", TAMPERED);

  if (errors.any || kind === null || !lender.ok || !guaranteeNote.ok || !notes.ok || status === null) return errors.fail();
  return {
    ok: true,
    value: {
      kind,
      lender: lender.value,
      originalAmountCents,
      currentBalanceCents,
      balanceAsOf,
      grantsAmountCents,
      guaranteeNote: guaranteeNote.value,
      notes: notes.value,
      status,
    },
  };
}

export interface PaidOffValues {
  paidOffOn: string;
}

export function parsePaidOff(values: unknown, env: ValidationEnv): Parsed<{ paidOffOn: string }> {
  const v = (values ?? {}) as Record<string, unknown>;
  const errors = new Errors();
  const date = parseDate(str(v.paidOffOn));
  if (date === null) errors.add("paidOffOn", VALIDATION.dateRequired);
  else if (date > env.today) errors.add("paidOffOn", VALIDATION.dateInFuture);
  if (errors.any || date === null) return errors.fail();
  return { ok: true, value: { paidOffOn: date } };
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

export const profileSchema = (env: ValidationEnv) =>
  refine(
    z.object({
      streetAddress: z.string(),
      city: z.string(),
      county: z.string(),
      yearOrganized: z.string(),
      phone: z.string(),
    }),
    (values) => parseProfile(values, env),
  );

export const buildingSchema = (env: ValidationEnv) =>
  refine(
    z.object({
      name: z.string(),
      buildingType: z.string(),
      primary: z.boolean(),
      yearBuilt: z.string(),
      firstAdditionYear: z.string(),
      secondAdditionYear: z.string(),
      squareFeet: z.string(),
      roofCondition: z.string(),
      plumbingCondition: z.string(),
      hvacCondition: z.string(),
      boilerCondition: z.string(),
      hasSprinklers: z.string(),
      hasFireAlarm: z.string(),
      hasSecuritySystem: z.string(),
      notes: z.string(),
    }),
    (values) => parseBuilding(values, env),
  );

export const retireSchema = (env: ValidationEnv) =>
  refine(z.object({ reason: z.string(), retiredOn: z.string() }), (values) => parseRetire(values, env));

export const appraisalSchema = (env: ValidationEnv) =>
  refine(
    z.object({ assessedYear: z.string(), amount: z.string(), notes: z.string() }),
    (values) => parseAppraisal(values, env),
  );

export const insuranceSchema = (env: ValidationEnv, mode: "create" | "edit") =>
  refine(
    z.object({
      policyYear: z.string(),
      carrier: z.string(),
      policyNumber: z.string(),
      policyExpiresOn: z.string(),
      recentClaims: z.string(),
      poolInterest: z.string(),
      notes: z.string(),
    }),
    (values) => parseInsurance(values, env, mode),
  );

export const loanSchema = (env: ValidationEnv) =>
  refine(
    z.object({
      kind: z.string(),
      lender: z.string(),
      originalAmount: z.string(),
      currentBalance: z.string(),
      balanceAsOf: z.string(),
      grantsAmount: z.string(),
      guaranteeNote: z.string(),
      notes: z.string(),
      status: z.string(),
    }),
    (values) => parseLoan(values, env),
  );

export const paidOffSchema = (env: ValidationEnv) =>
  refine(z.object({ paidOffOn: z.string() }), (values) => parsePaidOff(values, env));
