import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import {
  people,
  memberships,
  households,
  addresses,
  contactMethods,
} from "@/lib/db/domain/people";
import { rollActions } from "@/lib/db/domain/roll";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

/**
 * Member management, Increment 1 (docs/work-log/2026-08-25-member-
 * management.md Deliverable B). SAME SHAPE AS `directory.ts`/`role-
 * grants.ts`: one `withOrgContext()` transaction per exported function,
 * permission check first, typed result variants for every expected/denied
 * outcome, thrown exceptions reserved for genuine failure.
 *
 * `presby_match_person()`/`presby_link_person()` (`drizzle/0009_presby_
 * rls.sql`) are the ONLY sanctioned way to read across the org boundary for
 * duplicate detection — this module never runs a bare `select * from
 * people`. F21's guard (`presby_guard_membership_insert`) is what actually
 * stops a plain `memberships` INSERT from self-granting visibility into a
 * person who already belongs elsewhere; `createPerson()`'s own step-1 check
 * (`existing_member_elsewhere`) exists so that guard is reported as a named,
 * humane result instead of surfacing to the caller as a raw Postgres
 * exception.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PEOPLE_MANAGE = "people.manage";
const ROLL_PROPOSE = "roll.propose";

async function hasPermission(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  permissionKey: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${permissionKey}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

// ---------------------------------------------------------------------------
// matchPerson
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  personId: string;
  displayName: string;
  confidence: "exact" | "high" | "medium" | "low";
}

export type MatchPersonResult =
  | { kind: "ok"; candidates: MatchCandidate[] }
  | { kind: "forbidden" };

export interface MatchPersonInput {
  lastName: string;
  firstName: string;
  dateOfBirth?: string;
  identifiers?: Array<{ kind: "email" | "phone"; value: string }>;
}

interface MatchPersonRow {
  person_id: string;
  display_name: string;
  confidence: string;
}

/**
 * Thin wrapper over `presby_match_person()` — minimal-disclosure by
 * construction (the SQL function itself returns id + initial-plus-surname +
 * confidence band, never a birthdate/address/full name). Gated on
 * `people.manage`; the wizard's search step is the only caller.
 */
export async function matchPerson(
  viewerPersonId: string,
  organizationId: string,
  input: MatchPersonInput,
): Promise<MatchPersonResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, PEOPLE_MANAGE))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select person_id, display_name, confidence
        from presby_match_person(
               ${input.lastName},
               ${input.firstName},
               ${input.dateOfBirth ?? null}::date,
               ${JSON.stringify(input.identifiers ?? [])}::jsonb
             )
    `);
    const rows = (result as unknown as { rows?: MatchPersonRow[] }).rows ?? [];

    return {
      kind: "ok",
      candidates: rows.map((row) => ({
        personId: row.person_id,
        displayName: row.display_name,
        confidence: row.confidence as MatchCandidate["confidence"],
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// createPerson
// ---------------------------------------------------------------------------

export type PersonIdentityInput =
  | {
      mode: "new";
      firstName: string;
      lastName: string;
      middleName?: string;
      preferredName?: string;
      suffix?: string;
      dateOfBirth?: string;
    }
  | { mode: "existing"; matchedPersonId: string };

export interface CreatePersonInput {
  identity: PersonIdentityInput;
  contact: { email?: string; phone?: string };
  address?: {
    line1?: string;
    city?: string;
    region?: string;
    postalCode?: string;
  };
  household:
    | { mode: "new"; name: string }
    | { mode: "existing"; householdId: string }
    | { mode: "none" };
  rollAction: {
    kind: "profession_of_faith" | "other_participant_enrolled";
    /** 'YYYY-MM-DD'. */
    effectiveDate: string;
    minuteReference?: string;
  };
}

export type CreatePersonResult =
  | { kind: "ok"; personId: string; rollActionId: string }
  | { kind: "forbidden" }
  | { kind: "existing_member_elsewhere" }
  | { kind: "invalid_household" };

/**
 * Internal control-flow signal, NOT exported. Thrown from inside the
 * `withOrgContext()` transaction to abort with a typed, expected result —
 * necessary (not merely stylistic) because `identity.mode === "new"` writes
 * a `people` row in step 1, BEFORE the household validation in step 2 can
 * fail. An ordinary early `return` from inside `db.transaction()`'s callback
 * COMMITS whatever was written so far (Drizzle only rolls back on a thrown
 * rejection) — so every abort path in this function, even ones reached
 * before any write, goes through this class, and the outer function is what
 * translates it back to the typed `CreatePersonResult`. This is the single
 * mechanism that makes "no orphan `people` row on a mid-transaction failure"
 * true regardless of which step fails.
 */
class CreatePersonAbort extends Error {
  constructor(
    readonly result: Exclude<CreatePersonResult, { kind: "ok" }>,
  ) {
    super(`createPerson aborted: ${result.kind}`);
    this.name = "CreatePersonAbort";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Concatenates `err.message` with every `.cause` in the chain — Drizzle's
 * `DrizzleQueryError` wraps the driver's actual Postgres error as `.cause`,
 * so matching against `err.message` alone misses it entirely. */
function errorMessageChain(err: unknown, depth = 0): string {
  if (depth > 5 || err === null || err === undefined) return "";
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  return cause ? `${message} :: ${errorMessageChain(cause, depth + 1)}` : message;
}

/**
 * Creates a person (or attaches an existing, still-unaffiliated one),
 * optionally a household, a `memberships` row, and the initial `pending`
 * `roll_actions` row — ONE `withOrgContext()` transaction, per Phase 1's
 * "no URL-skip / no partial submit" wizard requirement.
 *
 * Gated on BOTH `people.manage` AND `roll.propose` — checked together,
 * before any write, same "gate first" discipline as `role-grants.ts`.
 *
 * ORDER OF OPERATIONS (Phase 3's design, each step named because a reorder
 * would reopen a finding):
 *   1. `identity.mode === "new"` inserts `people` (+ `addresses` +
 *      `contact_methods`). `identity.mode === "existing"` checks the
 *      matched person holds NO membership anywhere — nonzero means the
 *      "same person?" confirm was answered "yes" on someone who already
 *      belongs to another org, which this increment cannot silently
 *      resolve (no `presby_link_person()` reason fits "staff confirmed a
 *      match, no certificate") — `existing_member_elsewhere`, nothing
 *      written.
 *   2. Resolve `household`: `new` inserts a row; `existing` re-validates
 *      the id belongs to THIS `organizationId` (`invalid_household`
 *      otherwise); `none` leaves it null.
 *   3. Insert `memberships`. `presby_guard_membership_insert` passes
 *      without ever calling `presby_link_person()`, because by
 *      construction the person here always has zero memberships anywhere
 *      (a brand-new person, or an `existing` person already proven clear
 *      in step 1).
 *   4. Insert `roll_actions` (`approvalStatus: "pending"`). MUST run after
 *      step 3 — `roll_actions_person_fk` composite-FKs into
 *      `(memberships.personId, memberships.organizationId)`, which does
 *      not exist until the membership row lands.
 */
export async function createPerson(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: CreatePersonInput,
): Promise<CreatePersonResult> {
  if (!DATE_RE.test(input.rollAction.effectiveDate)) {
    // Genuine bad input, not a denial — thrown, matching grantRole's own
    // "malformed startsOn" contract.
    throw new Error(
      `createPerson: rollAction.effectiveDate must be 'YYYY-MM-DD', got ${JSON.stringify(
        input.rollAction.effectiveDate,
      )}`,
    );
  }
  if (
    input.identity.mode === "new" &&
    input.identity.dateOfBirth !== undefined &&
    !DATE_RE.test(input.identity.dateOfBirth)
  ) {
    throw new Error(
      `createPerson: identity.dateOfBirth must be 'YYYY-MM-DD', got ${JSON.stringify(
        input.identity.dateOfBirth,
      )}`,
    );
  }

  try {
    return await withOrgContext(actingPersonId, organizationId, async (tx) => {
      const [canManagePeople, canProposeRoll] = await Promise.all([
        hasPermission(tx, actingPersonId, organizationId, PEOPLE_MANAGE),
        hasPermission(tx, actingPersonId, organizationId, ROLL_PROPOSE),
      ]);
      if (!canManagePeople || !canProposeRoll) {
        throw new CreatePersonAbort({ kind: "forbidden" });
      }

      let personId: string;

      if (input.identity.mode === "new") {
        // Client-generated id, NOT `.returning({ id: people.id })` — this is
        // load-bearing, not a style choice. `people`'s RLS carries a real
        // SELECT policy (a person is invisible until a `memberships` row
        // links them, drizzle/0028_presby_people_write_rls_fix.sql), and
        // Postgres enforces the SELECT policy on the rows an
        // `INSERT ... RETURNING` clause hands back, not just the WITH CHECK
        // policy on the write itself — a person freshly inserted in THIS
        // same transaction, before step 3's `memberships` insert, fails
        // that RETURNING-side SELECT check even though the INSERT itself is
        // now permitted. Generating the id here and passing it explicitly
        // sidesteps needing to read the row back at all.
        personId = randomUUID();
        await tx.insert(people).values({
          id: personId,
          firstName: input.identity.firstName,
          lastName: input.identity.lastName,
          middleName: input.identity.middleName ?? null,
          preferredName: input.identity.preferredName ?? null,
          suffix: input.identity.suffix ?? null,
          dateOfBirth: input.identity.dateOfBirth ?? null,
        });

        if (input.contact.email) {
          await tx.insert(contactMethods).values({
            personId,
            kind: "email",
            value: input.contact.email,
            isPrimary: true,
          });
        }
        if (input.contact.phone) {
          await tx.insert(contactMethods).values({
            personId,
            kind: "phone",
            value: input.contact.phone,
            isPrimary: true,
          });
        }
        const addr = input.address;
        if (addr && (addr.line1 || addr.city || addr.region || addr.postalCode)) {
          await tx.insert(addresses).values({
            personId,
            addressType: "home",
            line1: addr.line1 ?? null,
            city: addr.city ?? null,
            region: addr.region ?? null,
            postalCode: addr.postalCode ?? null,
            isPrimary: true,
          });
        }
      } else {
        // NO pre-check SELECT here — deliberately. `memberships` carries the
        // standard tenant_isolation policy (organization_id =
        // presby_current_org()), so a plain `select ... from memberships
        // where person_id = matchedPersonId` run through THIS transaction
        // (org context = organizationId) is RLS-BLIND to a membership at
        // any OTHER org: it always returns zero rows for exactly the
        // cross-org case this check exists to catch. An earlier draft of
        // this function had that pre-check and it was silently wrong — the
        // membership insert below proceeded, and only
        // `presby_guard_membership_insert` (SECURITY DEFINER, genuinely
        // cross-org-visible) caught it, as a raw exception. See this
        // function's own step-3 catch below for the actual mechanism.
        personId = input.identity.matchedPersonId;
      }

      let householdId: string | null = null;
      if (input.household.mode === "new") {
        const [household] = await tx
          .insert(households)
          .values({ organizationId, name: input.household.name })
          .returning({ id: households.id });
        householdId = household!.id;
      } else if (input.household.mode === "existing") {
        const [household] = await tx
          .select({ id: households.id })
          .from(households)
          .where(
            and(
              eq(households.id, input.household.householdId),
              eq(households.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!household) {
          throw new CreatePersonAbort({ kind: "invalid_household" });
        }
        householdId = household.id;
      }

      // THE actual F21/existing-member-elsewhere gate: attempt the insert
      // and translate `presby_guard_membership_insert`'s raised exception
      // (errcode insufficient_privilege, "already exists elsewhere") into
      // the typed `existing_member_elsewhere` result. This is the ONLY
      // reliable way to ask "does this person hold a membership at ANY
      // org" from inside an org-scoped transaction — the trigger runs
      // SECURITY DEFINER and is genuinely cross-org-visible; an ordinary
      // SELECT through this same `tx` is not (see the comment above). For
      // `identity.mode === "new"` this branch is unreachable in practice —
      // a brand-new person has zero memberships anywhere by construction —
      // so a match here would indicate a genuine anomaly and is re-thrown,
      // not swallowed.
      try {
        await tx.insert(memberships).values({
          organizationId,
          personId,
          householdId,
          engagementStatus: "regular",
        });
      } catch (err) {
        // Drizzle wraps the underlying pg error as `DrizzleQueryError`,
        // whose OWN `.message` is "Failed query: insert into ..." — the
        // driver's actual message ("... already exists elsewhere ...") is
        // one level down, on `.cause`. Walk the chain rather than trusting
        // `err.message` alone.
        if (
          input.identity.mode === "existing" &&
          /already exists elsewhere/.test(errorMessageChain(err))
        ) {
          throw new CreatePersonAbort({ kind: "existing_member_elsewhere" });
        }
        throw err;
      }

      const [rollAction] = await tx
        .insert(rollActions)
        .values({
          organizationId,
          personId,
          kind: input.rollAction.kind,
          effectiveDate: input.rollAction.effectiveDate,
          approvalStatus: "pending",
          minuteReference: input.rollAction.minuteReference ?? null,
          proposedBy: actingUserId,
        })
        .returning({ id: rollActions.id });

      return { kind: "ok", personId, rollActionId: rollAction!.id };
    });
  } catch (err) {
    if (err instanceof CreatePersonAbort) {
      return err.result;
    }
    throw err;
  }
}
