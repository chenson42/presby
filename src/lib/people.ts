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
  rollAction:
    | {
        kind: "profession_of_faith" | "other_participant_enrolled";
        /** 'YYYY-MM-DD'. */
        effectiveDate: string;
        minuteReference?: string;
      }
    | {
        /**
         * DECISION-128/129 (`docs/work-log/2026-08-27-staff-and-
         * personnel.md`) — staff hiring's inline "add a new person"
         * affordance, the ONLY other sanctioned caller of this arm. Skips
         * step 4 entirely (no `roll_actions` insert) — a staff-only anchor
         * row must never fabricate a roll fact ("The Roll Is the System of
         * Record"). Step 3's `memberships` insert sets `engagementStatus:
         * "staff"`, NOT the other two kinds' `"regular"` — the load-bearing
         * DECISION-129 fix that keeps this row OUT of `getDirectory()`'s and
         * `findPersonMatches()`'s `engagement_status = 'regular'`
         * eligibility branch. `current_roll` stays permanently null, the
         * same shape an as-yet-undecided visitor already has. Every
         * `CreatePersonInput` caller that reaches an end user through a form
         * MUST fix this kind server-side, never trust it from client input —
         * see `admin/staff/actions.ts`'s `createStaffPersonAction()` and the
         * runtime guard `admin/members/new/actions.ts`'s
         * `createPersonAction()` added alongside this type change (the
         * member wizard must keep requiring a real roll action; widening
         * this union must not silently let a member-creation caller skip
         * one).
         */
        kind: "none";
      };
}

export type CreatePersonResult =
  | { kind: "ok"; personId: string; rollActionId: string | null }
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
 * optionally a household, a `memberships` row, and — unless `rollAction.kind
 * === "none"` (DECISION-128) — the initial `pending` `roll_actions` row. ONE
 * `withOrgContext()` transaction, per Phase 1's "no URL-skip / no partial
 * submit" wizard requirement.
 *
 * GATING SPLIT (DECISION-128 ruling 1, DECISION-129): `people.manage` is
 * required UNCONDITIONALLY — creating a `people` row is a People-domain
 * action regardless of which module's UI triggers it. `roll.propose` is
 * required ONLY when `rollAction.kind !== "none"` — requiring it for a call
 * that writes no `roll_actions` row makes no sense, and a `staff.manage`-only
 * caller attaching a position to a brand-new person must not ALSO need
 * `roll.propose`, a permission with no bearing on what it's actually doing.
 * Both checks still run before any write, same "gate first" discipline as
 * `role-grants.ts`.
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
 *   4. `rollAction.kind !== "none"`: insert `roll_actions` (`approvalStatus:
 *      "pending"`). MUST run after step 3 — `roll_actions_person_fk`
 *      composite-FKs into `(memberships.personId, memberships.
 *      organizationId)`, which does not exist until the membership row
 *      lands. `rollAction.kind === "none"` (DECISION-128): this step is
 *      SKIPPED ENTIRELY, `rollActionId` is returned `null`, and step 3's
 *      `engagementStatus` is `"staff"` instead of `"regular"` — see
 *      `CreatePersonInput.rollAction`'s own doc comment for why.
 */
export async function createPerson(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: CreatePersonInput,
): Promise<CreatePersonResult> {
  if (
    input.rollAction.kind !== "none" &&
    !DATE_RE.test(input.rollAction.effectiveDate)
  ) {
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
      // DECISION-128 ruling 1 / DECISION-129: people.manage is required
      // UNCONDITIONALLY; roll.propose is required ONLY when a roll_actions
      // row will actually be written. Short-circuits to `true` (no DB round
      // trip) when rollAction.kind === "none" rather than skipping the
      // Promise.all entry, so the two checks stay structurally parallel.
      const [canManagePeople, canProposeRoll] = await Promise.all([
        hasPermission(tx, actingPersonId, organizationId, PEOPLE_MANAGE),
        input.rollAction.kind === "none"
          ? Promise.resolve(true)
          : hasPermission(tx, actingPersonId, organizationId, ROLL_PROPOSE),
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
          // DECISION-129: `"staff"`, NEVER `"regular"`, when rollAction.kind
          // === "none" — the load-bearing fix. `getDirectory()`'s and
          // `findPersonMatches()`'s eligibility predicates both admit any
          // row with `engagement_status = 'regular'` (their OR-branch,
          // since `current_roll` stays null for this kind by construction);
          // a staff-only anchor row that kept the old hardcoded value would
          // leak straight into the public directory and the admin/members
          // roster the moment this branch shipped. Confirmed by reading both
          // predicates directly (`src/lib/directory.ts`, `src/lib/org-portal
          // /find-person.ts`) — see `staff.test.ts`'s and `people.test.ts`'s
          // own regression tests proving the literal-string exclusion holds.
          engagementStatus: input.rollAction.kind === "none" ? "staff" : "regular",
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

      // DECISION-128: rollAction.kind === "none" skips step 4 entirely — no
      // roll_actions row, ever, for this kind. Checked as a plain `if` (not
      // folded into the try/catch above) so TypeScript narrows
      // `input.rollAction` to the two roll-bearing kinds for the insert
      // below — the discriminant check inside the earlier Promise.all
      // ternary does NOT persist narrowing past that expression.
      if (input.rollAction.kind === "none") {
        return { kind: "ok", personId, rollActionId: null };
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

// ---------------------------------------------------------------------------
// updatePerson — Increment 2 (docs/work-log/2026-08-26-member-management-
// edit-person.md)
// ---------------------------------------------------------------------------

export interface UpdatePersonInput {
  personId: string;
  identity: {
    firstName: string;
    lastName: string;
    middleName?: string;
    preferredName?: string;
    suffix?: string;
  };
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
}

export type UpdatePersonResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_household" };

/**
 * Edits an already-visible person's name variants, contact methods, address,
 * and household — the Increment 1 wizard's "identity/contact/household"
 * shape, minus everything roll-related. Gated on `people.manage` ONLY —
 * `roll.propose` is deliberately not required, since nothing here touches
 * `roll_actions`/`current_roll`/death-as-status (Phase 1's explicit
 * boundary: no "Status" field on this form, ever).
 *
 * `personId` must already be visible through THIS org's RLS (i.e. already
 * hold a `memberships` row here) — `not_found` covers both "no such person"
 * and "exists, but not visible in this org," which are indistinguishable
 * from inside an org-scoped transaction and, per F21's enumeration
 * discipline, meant to be: a `people.manage` holder must not learn a person
 * exists in some OTHER org from this form's error message.
 *
 * Contact methods and the address are each a single PRIMARY row, mirroring
 * `createPerson()`'s own "one primary email/phone/address" shape (Increment
 * 1 never created a second of any of them, so Increment 2 doesn't need to
 * manage multiples either). A blank value clears (deletes) the primary row
 * if one exists; a non-blank value updates it if present, else inserts a
 * new primary row.
 */
export async function updatePerson(
  actingPersonId: string,
  organizationId: string,
  input: UpdatePersonInput,
): Promise<UpdatePersonResult> {
  const result = await withOrgContext<UpdatePersonResult>(actingPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, actingPersonId, organizationId, PEOPLE_MANAGE))) {
      return { kind: "forbidden" };
    }

    // RLS-scoped by construction: `people`'s SELECT policy only shows rows
    // with a `memberships` row in THIS org (drizzle/0028_presby_people_
    // write_rls_fix.sql's `USING` clause, untouched by that migration) — a
    // zero-row result here is already the correct "not visible to me"
    // answer, no separate cross-org check needed the way createPerson's
    // existing-member-elsewhere path required.
    const [existing] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(
        memberships,
        and(
          eq(memberships.personId, people.id),
          eq(memberships.organizationId, organizationId),
        ),
      )
      .where(eq(people.id, input.personId))
      .limit(1);
    if (!existing) {
      return { kind: "not_found" };
    }

    await tx
      .update(people)
      .set({
        firstName: input.identity.firstName,
        lastName: input.identity.lastName,
        middleName: input.identity.middleName ?? null,
        preferredName: input.identity.preferredName ?? null,
        suffix: input.identity.suffix ?? null,
      })
      .where(eq(people.id, input.personId));

    await upsertPrimaryContactMethod(tx, input.personId, "email", input.contact.email);
    await upsertPrimaryContactMethod(tx, input.personId, "phone", input.contact.phone);
    await upsertPrimaryAddress(tx, input.personId, input.address);

    if (input.household.mode === "new") {
      const [household] = await tx
        .insert(households)
        .values({ organizationId, name: input.household.name })
        .returning({ id: households.id });
      await tx
        .update(memberships)
        .set({ householdId: household!.id })
        .where(
          and(
            eq(memberships.personId, input.personId),
            eq(memberships.organizationId, organizationId),
          ),
        );
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
        return { kind: "invalid_household" };
      }
      await tx
        .update(memberships)
        .set({ householdId: household.id })
        .where(
          and(
            eq(memberships.personId, input.personId),
            eq(memberships.organizationId, organizationId),
          ),
        );
    } else {
      await tx
        .update(memberships)
        .set({ householdId: null })
        .where(
          and(
            eq(memberships.personId, input.personId),
            eq(memberships.organizationId, organizationId),
          ),
        );
    }

    return { kind: "ok" };
  });

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.PERSON_UPDATED,
      resourceType: "person",
      resourceId: input.personId,
      metadata: { organizationId },
    });
  }

  return result;
}

async function upsertPrimaryContactMethod(
  tx: OrgTx,
  personId: string,
  kind: "email" | "phone",
  value: string | undefined,
): Promise<void> {
  const [primary] = await tx
    .select({ id: contactMethods.id })
    .from(contactMethods)
    .where(
      and(
        eq(contactMethods.personId, personId),
        eq(contactMethods.kind, kind),
        eq(contactMethods.isPrimary, true),
      ),
    )
    .limit(1);

  if (!value) {
    if (primary) {
      await tx.delete(contactMethods).where(eq(contactMethods.id, primary.id));
    }
    return;
  }

  if (primary) {
    await tx
      .update(contactMethods)
      .set({ value })
      .where(eq(contactMethods.id, primary.id));
  } else {
    await tx.insert(contactMethods).values({ personId, kind, value, isPrimary: true });
  }
}

async function upsertPrimaryAddress(
  tx: OrgTx,
  personId: string,
  address: UpdatePersonInput["address"],
): Promise<void> {
  const [primary] = await tx
    .select({ id: addresses.id })
    .from(addresses)
    .where(and(eq(addresses.personId, personId), eq(addresses.isPrimary, true)))
    .limit(1);

  const hasAnyField = !!(
    address &&
    (address.line1 || address.city || address.region || address.postalCode)
  );

  if (!hasAnyField) {
    if (primary) {
      await tx.delete(addresses).where(eq(addresses.id, primary.id));
    }
    return;
  }

  const values = {
    line1: address!.line1 ?? null,
    city: address!.city ?? null,
    region: address!.region ?? null,
    postalCode: address!.postalCode ?? null,
  };

  if (primary) {
    await tx.update(addresses).set(values).where(eq(addresses.id, primary.id));
  } else {
    await tx.insert(addresses).values({
      personId,
      addressType: "home",
      isPrimary: true,
      ...values,
    });
  }
}

// ---------------------------------------------------------------------------
// getPersonForEdit — read side for the edit form
// ---------------------------------------------------------------------------

export interface PersonForEdit {
  personId: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  preferredName: string | null;
  suffix: string | null;
  email: string | null;
  phone: string | null;
  address: {
    line1: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
  } | null;
  householdId: string | null;
}

export type GetPersonForEditResult =
  | { kind: "ok"; person: PersonForEdit }
  | { kind: "forbidden" }
  | { kind: "not_found" };

/** Gated on `people.manage`, same visibility discipline as `updatePerson`. */
export async function getPersonForEdit(
  viewerPersonId: string,
  organizationId: string,
  personId: string,
): Promise<GetPersonForEditResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, PEOPLE_MANAGE))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        middleName: people.middleName,
        preferredName: people.preferredName,
        suffix: people.suffix,
        householdId: memberships.householdId,
      })
      .from(people)
      .innerJoin(
        memberships,
        and(
          eq(memberships.personId, people.id),
          eq(memberships.organizationId, organizationId),
        ),
      )
      .where(eq(people.id, personId))
      .limit(1);
    if (!row) {
      return { kind: "not_found" };
    }

    const [email] = await tx
      .select({ value: contactMethods.value })
      .from(contactMethods)
      .where(
        and(
          eq(contactMethods.personId, personId),
          eq(contactMethods.kind, "email"),
          eq(contactMethods.isPrimary, true),
        ),
      )
      .limit(1);
    const [phone] = await tx
      .select({ value: contactMethods.value })
      .from(contactMethods)
      .where(
        and(
          eq(contactMethods.personId, personId),
          eq(contactMethods.kind, "phone"),
          eq(contactMethods.isPrimary, true),
        ),
      )
      .limit(1);
    const [address] = await tx
      .select({
        line1: addresses.line1,
        city: addresses.city,
        region: addresses.region,
        postalCode: addresses.postalCode,
      })
      .from(addresses)
      .where(and(eq(addresses.personId, personId), eq(addresses.isPrimary, true)))
      .limit(1);

    return {
      kind: "ok",
      person: {
        personId: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        middleName: row.middleName,
        preferredName: row.preferredName,
        suffix: row.suffix,
        email: email?.value ?? null,
        phone: phone?.value ?? null,
        address: address ?? null,
        householdId: row.householdId,
      },
    };
  });
}
