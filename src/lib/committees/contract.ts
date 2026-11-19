/**
 * The presbytery committees contract (docs/work-log/2026-11-19-presbytery-
 * committees.md, Phase 3 "Module and file plan"; DECISION-352, 353, 354, 357).
 * PURE: it imports only the one pure vocabulary file (`@/lib/group-roles`, which
 * has no imports of its own), so a form, a page, the validators, the store and
 * the tests all read the same lists and limits. A client form may import it.
 *
 * Every closed list and every limit here is pinned against the migration by
 * `contract.test.ts` (parsed out of `drizzle/0090_presby_committees.sql`): a
 * list changed in one place and not the other fails the suite.
 *
 * A committee is a `managed` group of type `committee` at a PRESBYTERY. Its
 * label (`kind`) and its one-way dissolved state live in `committee_details`
 * (a 1:1 side table, DECISION-353); its seats are `group_memberships` rows,
 * written only through `@/lib/groups` (DECISION-352). The key is the existing
 * `groups.manage` (tier 1): never a `FEATURES.*` entry (Permissions vs Flags).
 */
import {
  COMMITTEE_ROLES,
  GROUP_ROLE_LABELS,
  type CommitteeRole,
  type GroupRoleValue,
} from "@/lib/group-roles";

/** The existing global flag the pages sit behind (a toggle). Mirrors `presbytery-reports/contract.ts#COMMITTEES_FLAG`. */
export const COMMITTEES_FLAG = "org_portal.committees";

/** The one permission key: tier 1, no two-factor flag. Never mapped into `FEATURES.*`. */
export const GROUPS_MANAGE_KEY = "groups.manage";

export interface Labeled<V extends string> {
  readonly value: V;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Closed lists (the CHECK lists in 0090). Labels are the Copy section's (C2, C4).
// ---------------------------------------------------------------------------

/** `committee_details_kind_check`. Null (or no row) is "Not yet labelled": never a stored value. */
export const COMMITTEE_KINDS = [
  { value: "required", label: "Required" },
  { value: "standing", label: "Standing" },
  { value: "ad_hoc", label: "Ad hoc" },
] as const satisfies readonly Labeled<string>[];
export type CommitteeKind = (typeof COMMITTEE_KINDS)[number]["value"];

export const COMMITTEE_KIND_VALUES: readonly CommitteeKind[] = COMMITTEE_KINDS.map((k) => k.value);

export function isCommitteeKind(value: unknown): value is CommitteeKind {
  return typeof value === "string" && (COMMITTEE_KIND_VALUES as readonly string[]).includes(value);
}

/** The six titles a committee (and a commission) offers, with their labels, in display order. */
export const COMMITTEE_ROLE_OPTIONS: ReadonlyArray<Labeled<CommitteeRole>> = COMMITTEE_ROLES.map((value) => ({
  value,
  label: GROUP_ROLE_LABELS[value],
}));

// ---------------------------------------------------------------------------
// Limits (the char_length bounds and the application's own date rules)
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** `groups.name` is validated 1 to 200 by `groups.ts` (and the committee form). */
  nameMax: 200,
  purposeMax: 2000,
  meetsWhenMax: 200,
  /** The database's date floor on every date column (0090). */
  dateFloor: "1900-01-01",
  /** A start (or an effective date) may not be more than this many years ahead. */
  startAheadYears: 5,
  /** An end date may not be more than this many years ahead. */
  endAheadYears: 10,
} as const;

// ---------------------------------------------------------------------------
// The closed names an audit row's `changed` array may carry. A field NAME, never a value.
// ---------------------------------------------------------------------------

export const CHANGED_FIELDS = ["name", "purpose", "meetsWhen"] as const;
export type ChangedField = (typeof CHANGED_FIELDS)[number];

// ---------------------------------------------------------------------------
// Viewer, context, outcomes
// ---------------------------------------------------------------------------

/** Who is reading: the acting person and the presbytery (never from the client). */
export interface CommitteesViewer {
  personId: string;
  organizationId: string;
}

/** Who is writing: a viewer plus the acting user, for the audit row. */
export interface CommitteesCtx extends CommitteesViewer {
  actor: { userId: string; email: string | null };
}

/**
 * Why a write was refused. One fixed string per kind (`copy.ts`), never raw
 * database text. `invalid` is the only kind that carries a field. `seat_not_found`
 * is the C9 "That member could not be found." answer; `not_found` is the
 * committee's (the two are the only strings that differ by object, never by
 * whether the thing exists elsewhere: DECISION-040).
 */
export type Refusal =
  | "forbidden"
  | "not_found"
  | "seat_not_found"
  | "duplicate_name"
  | "overlap"
  | "not_a_member"
  | "committee_dissolved"
  | "already_dissolved"
  | "already_ended"
  | "same_role"
  | "date_before_start"
  | "stale"
  | "save_failed";

/** What a refusal's message may name: the stored name of the existing thing, or a date. Never a client value. */
export interface RefusalDetail {
  /** `duplicate_name`: the existing committee's stored name. */
  existingName?: string;
  /** `overlap`: the person's and the committee's stored names. */
  personName?: string;
  committeeName?: string;
  /** `date_before_start`: the date the earliest allowed value is. */
  date?: string;
  /** `committee_dissolved`: `"edit"` when the refused act was an edit (C4's sentence), absent for an add (C5's). */
  during?: "edit";
}

export type Outcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "refused"; reason: Refusal; detail?: RefusalDetail }
  | { kind: "invalid"; field: string; message: string };

/** What a store write returns on success: the row's id and whether anything was written. */
export interface Written {
  /** The committee's group id, or the membership id (a seat write names its seat). */
  id: string;
  /** True when the edit changed nothing: nothing was written and nothing was audited. */
  unchanged?: true;
}

/**
 * What a read returns: `ok`, `forbidden` (the key or the organization type is
 * missing, checked inside the reader's own transaction), or `not_found`. The two
 * form readers add `committee_dissolved`, which a page renders as the C4 state.
 */
export type CommitteesRead<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "not_found" };
export type CommitteesFormRead<T> = CommitteesRead<T> | { kind: "committee_dissolved" };

// ---------------------------------------------------------------------------
// What a Server Action returns (a superset of `ActionResult<{ id: string }>`)
// ---------------------------------------------------------------------------

/** The success payload of a committees action: the row id plus whether anything changed. */
export interface ActionData extends Written {
  /** `dissolveCommitteeAction`: how many terms the dissolve ended. */
  seatsEnded?: number;
  /** `endCommitteeSeatAction`: a planned term was cancelled rather than ended ("Planned term cancelled."). */
  cancelled?: boolean;
  /** `setCommitteeSeatPublicListedAction`: the listing as it now stands. */
  publicListed?: boolean;
}

/**
 * `{ ok: true, data }` or `{ ok: false, error }`, exactly `ActionResult`'s shape,
 * plus two optional extras a form may use: `field` (an `invalid` message belongs
 * under that field) and `kind` (why). `error` is always one fixed `copy.ts`
 * string, never database text.
 */
export type CommitteesActionResult =
  | { ok: true; data?: ActionData }
  | {
      ok: false;
      error: string;
      field?: string;
      kind?: Refusal | "invalid" | "unauthenticated" | "two_factor_required";
    };

export type { CommitteeRole, GroupRoleValue };
