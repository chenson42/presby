import { z } from "zod";
import type { DesignationSlot, HolderRow } from "./designation-holder-types";

/**
 * Every string the designation-holder list and revoke show or return, in one
 * pure place (docs/work-log/2026-10-22-designation-revoke.md, Phase 3 "Copy";
 * DECISION-194/195). No imports from `@/lib/db` or `server-only`: the sections
 * and the dialog (client components) and the server action all read this.
 *
 * None of these strings carries an email, a constraint name or a stack trace.
 * Two wording rules are load-bearing and tested:
 *   - a holder row never says "Self-designated" (that is an invitation fact,
 *     shown on the invitation history row; `e2e/invitation-existing-account
 *     .spec.ts` asserts the literal once) and never says "Accepted";
 *   - nothing here says whether an address has an account.
 */

// ---------------------------------------------------------------------------
// The reason (10 to 500 characters, counted in code points)
// ---------------------------------------------------------------------------

export const REASON_MIN = 10;
export const REASON_MAX = 500;

export const REASON_COPY = {
  short: "Add a reason of at least 10 characters.",
  long: "Keep the reason to 500 characters or fewer.",
  control: "The reason can't contain control characters.",
} as const;

// C0 and C1 control characters other than tab (U+0009) and line feed (U+000A).
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

/** Length in code points, so one emoji is one character. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * The shared reason schema (the action and the library both parse with it).
 * Trimmed first; the issue list's first message is the one shown.
 */
export const reasonSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (CONTROL_RE.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: REASON_COPY.control });
      return;
    }
    const length = codePointLength(value);
    if (length < REASON_MIN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: REASON_COPY.short });
    } else if (length > REASON_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: REASON_COPY.long });
    }
  });

export type ReasonResult = { ok: true; reason: string } | { ok: false; message: string };

export function parseReason(raw: unknown): ReasonResult {
  const parsed = reasonSchema.safeParse(typeof raw === "string" ? raw : "");
  if (parsed.success) return { ok: true, reason: parsed.data };
  return { ok: false, message: parsed.error.issues[0]?.message ?? REASON_COPY.short };
}

// ---------------------------------------------------------------------------
// The revoke action's form fields. Lives here (not in the "use server" actions
// file, which can export only async functions) so a test can reach it. Size
// checks come first on the array, before any refinement.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const revokeHolderFieldsSchema = z.object({
  organizationId: z.string().regex(UUID_RE),
  slot: z.enum(["founding_administrator", "treasurer"]),
  subjectKind: z.enum(["person", "group"]),
  subjectId: z.string().regex(UUID_RE),
  expectedGrantIds: z.array(z.string().regex(UUID_RE)).min(1).max(20),
});

// ---------------------------------------------------------------------------
// Outcomes (the action's `error` / the toast). The database-error sentence is
// the action file's own DB_ERROR_COPY, shared with the invitation actions.
// ---------------------------------------------------------------------------

export const OUTCOME_COPY = {
  already_removed: "That access has already been removed. The list has been refreshed.",
  changed:
    "This access changed while you were looking. The list has been refreshed. Review it and try again.",
  // One string for not_a_holder and no_organization: no oracle on which it was.
  not_found:
    "We couldn't find that access to remove at this organization. The list has been refreshed.",
  derived_group_refused:
    "That group's roster comes from the organization's own officers, so it can't be changed here. The congregation's own officers change it.",
  not_applicable: "Treasurer access doesn't apply to this type of organization.",
  unauthorized: "Unauthorized.",
  forbidden: "Forbidden.",
  invalid: "Invalid request.",
} as const;

/** The success sentence (the toast and the inline status). */
export function revokedMessage(row: Pick<HolderRow, "subjectKind" | "displayName">, reachedZero: boolean): string {
  const base =
    row.subjectKind === "group"
      ? `Access ended for the ${row.displayName} group.`
      : `Access ended for ${row.displayName}.`;
  return reachedZero ? `${base} Nobody holds this now. Invite a replacement below.` : base;
}

// ---------------------------------------------------------------------------
// Dates: split the YYYY-MM-DD string, never `new Date("YYYY-MM-DD")`
// (e2e/timezone-safe-dates.spec.ts is the precedent).
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatSince(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return isoDate;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

// ---------------------------------------------------------------------------
// The section and the rows
// ---------------------------------------------------------------------------

function peopleCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function sectionLead(slot: DesignationSlot, holderPeopleCount: number): string {
  const n = peopleCount(holderPeopleCount);
  if (slot === "founding_administrator") {
    return `${n} can manage roles at this organization. When one of its administrators is available, the organization's own Roles page is the better place to change this. End access here to recover from a lockout or a mistaken grant.`;
  }
  return `${n} can manage giving at this organization. The treasurer changes the giving team from the organization's own Giving team page. End access here to recover from a lockout or a mistaken grant. Gift and donor records are not changed by ending access here. Every designation and every ending of access is recorded in the audit log.`;
}

export const PROVENANCE_COPY = {
  designation: "Designated through an invitation",
  other: "Granted another way",
} as const;

export function rowSince(row: Pick<HolderRow, "since">): string {
  return `Since ${formatSince(row.since)}`;
}

export function rowRoles(row: Pick<HolderRow, "roleNames">): string {
  return `Roles: ${row.roleNames.join(", ")}`;
}

export function rowAlsoThrough(row: Pick<HolderRow, "alsoThroughGroupNames">): string | null {
  if (row.alsoThroughGroupNames.length === 0) return null;
  return `Also holds this through ${joinNames(row.alsoThroughGroupNames)}.`;
}

export function groupRowTitle(row: Pick<HolderRow, "displayName">): string {
  return `${row.displayName} (group)`;
}

export function groupRowCount(row: Pick<HolderRow, "holderPeopleCount">): string {
  const n = row.holderPeopleCount;
  return `${peopleCount(n)} ${n === 1 ? "holds" : "hold"} this through the group.`;
}

export function derivedRowText(row: Pick<HolderRow, "holderPeopleCount" | "derivedGroupName" | "displayName">): string {
  const group = row.derivedGroupName ?? row.displayName;
  const n = row.holderPeopleCount;
  return `${peopleCount(n)} ${n === 1 ? "holds" : "hold"} this through ${group}; the congregation's own officers change this.`;
}

export function revokeButtonLabel(row: Pick<HolderRow, "subjectKind" | "displayName">): string {
  return row.subjectKind === "group"
    ? `Revoke access for the ${row.displayName} group`
    : `Revoke access for ${row.displayName}`;
}

// ---------------------------------------------------------------------------
// The confirm dialog
// ---------------------------------------------------------------------------

export const REASON_FIELD = {
  label: "Reason (kept in the audit log)",
  helper: "10 to 500 characters. Don't include passwords or personal details.",
} as const;

export const DIALOG_BUTTONS = {
  cancel: "Cancel",
  confirm: "Yes, end access",
  pending: "Ending…",
} as const;

export type RevokeDialogContent = {
  title: string;
  intro: string;
  rolesLine: string;
  carriesLabel: string;
  permissionDescriptions: string[];
  companionLine: string | null;
  groupLine: string | null;
  stillHoldsLine: string | null;
  lastHolderLine: string;
  treasurerLine: string | null;
  recordLine: string;
};

export function revokeDialogContent(
  slot: DesignationSlot,
  organizationName: string,
  row: HolderRow,
): RevokeDialogContent {
  const isGroup = row.subjectKind === "group";
  const what = slot === "founding_administrator" ? "roles" : "giving";
  const page = slot === "founding_administrator" ? "Roles" : "Giving team";
  const roleNoun = row.roleNames.length === 1 ? "This role ends" : "These roles end";

  const title = isGroup ? `End access for the ${row.displayName} group?` : `End ${row.displayName}'s access?`;
  const intro = isGroup
    ? `This ends the ${row.displayName} group's access to manage ${what} at ${organizationName}.`
    : `This ends ${row.displayName}'s access to manage ${what} at ${organizationName}.`;

  const companionNames = row.companionRoleNames;
  const companionLine =
    companionNames.length > 0
      ? `${joinNames(companionNames)} ${companionNames.length === 1 ? "was" : "were"} assigned together with the designation and ${
          companionNames.length === 1 ? "ends" : "end"
        } with it.`
      : null;

  const groupLine = isGroup
    ? `${peopleCount(row.holderPeopleCount)} ${
        row.holderPeopleCount === 1 ? "holds" : "hold"
      } this access through the ${row.displayName} group. All of them lose it, unless they hold it another way. The group and its members are not changed.`
    : null;

  const stillHoldsLine =
    !isGroup && row.alsoThroughGroupNames.length > 0
      ? `${row.displayName} will still hold this access through ${joinNames(row.alsoThroughGroupNames)}.`
      : null;

  const lastHolderLine = row.leavesNoHolders
    ? isGroup
      ? `Nobody else can manage ${what} here. Nobody will be able to manage ${what} until you invite a replacement.`
      : `${row.displayName} is the only person who has this access. Nobody will be able to manage ${what} until you invite a replacement.`
    : `Others can still manage ${what} here. If one of them is available, use the organization's own ${page} page instead.`;

  return {
    title,
    intro,
    rolesLine: `${roleNoun} today: ${row.roleNames.join(", ")}.`,
    carriesLabel: "They carry:",
    permissionDescriptions: row.permissions.map((p) => p.description),
    companionLine,
    groupLine,
    stillHoldsLine,
    lastHolderLine,
    treasurerLine:
      slot === "treasurer"
        ? "Gift and donor records are not changed. This is recorded in the audit log."
        : null,
    recordLine: `This is recorded in the audit log with your reason. You can't undo it here; the organization can grant access again from its own ${page} page, or you can invite a replacement.`,
  };
}
