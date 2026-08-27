import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import { memberships } from "@/lib/db/domain/people";
import { organizationSettings } from "@/lib/db/domain/org";
import { personNotes, personMedical } from "@/lib/db/domain/person-ext";
import { personDemographics, personDisabilities } from "@/lib/db/domain/privacy";
import { ordinations } from "@/lib/db/domain/officers";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

/**
 * Member edit: tiered sensitive information (docs/work-log/
 * 2026-08-26-member-sensitive-info.md, Phase 3/DECISION-108). Surfaces four
 * tier-3 tables the schema has carried since the original domain design but
 * no screen has ever touched: `person_notes` (pastoral care),
 * `person_demographics` (SASR), `person_medical` (children's-safety),
 * `person_disabilities` (staff-observed, non-consensual). SAME SHAPE as
 * `people.ts`: one `withOrgContext()` transaction per exported function,
 * permission check first, typed result variants for every expected/denied
 * outcome.
 *
 * Four independent table-level permissions, never one blanket key
 * (architect's Phase 2 ruling) — `pastoral_notes.manage`,
 * `demographics.manage`, `medical.manage`, `disabilities.manage`.
 * `pastoral_notes.manage` does NOT itself decide whether a `clergy_only`
 * `person_notes` row is visible — that is a second, finer read-time filter
 * (see `isOrdainedClergy` below), mirroring `directory.ts`'s
 * `hide_email`/`hide_phone` CASE-WHEN shape but on the inverse axis: the
 * row's own tag gates the *reader*, not a person's own opt-out. A row that
 * fails the filter is OMITTED from the result set, never nulled-in-place —
 * a list has no honest placeholder for "a note exists here you can't read."
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PASTORAL_NOTES_MANAGE = "pastoral_notes.manage";
const DEMOGRAPHICS_MANAGE = "demographics.manage";
const MEDICAL_MANAGE = "medical.manage";
const DISABILITIES_MANAGE = "disabilities.manage";

/**
 * Server-side counterpart to `sensitive-info-form.tsx`'s client-side
 * `maxLength` attributes (`BODY_MAX_LENGTH` = 4000, `FIELD_MAX_LENGTH` =
 * 2000 there) — same numbers, not re-derived, per Phase 6's SHIP WITH NOTES
 * finding (docs/work-log/2026-08-26-member-sensitive-info.md): only the
 * client-side `maxLength` HTML attribute shipped, so a request bypassing
 * the browser form could write an arbitrarily long string to any of these
 * tables' free-text columns. Checked inline, before `withOrgContext`, same
 * shape as `roll.ts`'s `recordRollAction()` re-validating `input.kind`
 * before its own permission check — a malformed request is rejected before
 * any query runs, not discovered mid-transaction.
 */
const BODY_MAX_LENGTH = 4000; // person_notes.body, person_medical.* textareas
const FIELD_MAX_LENGTH = 2000; // person_demographics.gender

const FIELD_LABELS: Record<string, string> = {
  body: "Note",
  gender: "Gender",
  allergies: "Allergies",
  medicalNotes: "Medical notes",
  medications: "Medications",
  authorizedPickup: "Authorized pickup",
};

/** Human-readable label for an `invalid_input` field key — used by the
 * co-located `actions.ts` to build a toast message, not thrown here. */
export function sensitiveInfoFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

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

/**
 * Ordination is lifelong; service is termed (CLAUDE.md's own invariant). The
 * `clergy_only` filter reads that lifelong signal directly rather than
 * inventing a second one: an active (`ended_on IS NULL`)
 * `minister_of_word_and_sacrament` ordination at THIS organization.
 */
async function isOrdainedClergy(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: ordinations.id })
    .from(ordinations)
    .where(
      and(
        eq(ordinations.personId, personId),
        eq(ordinations.organizationId, organizationId),
        eq(ordinations.ministry, "minister_of_word_and_sacrament"),
        isNull(ordinations.endedOn),
      ),
    )
    .limit(1);
  return !!row;
}

async function personVisibleInOrg(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: memberships.personId })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, personId),
        eq(memberships.organizationId, organizationId),
      ),
    )
    .limit(1);
  return !!row;
}

async function readDisabilityTrackingEnabled(
  tx: OrgTx,
  organizationId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ settings: organizationSettings.settings })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, organizationId))
    .limit(1);
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  return settings.trackDisabilityPerPerson === true;
}

// ---------------------------------------------------------------------------
// getSensitiveInfoGrants — cheap, permission-only read
// ---------------------------------------------------------------------------

export type GetSensitiveInfoGrants = {
  pastoralNotes: boolean;
  demographics: boolean;
  medical: boolean;
  disabilities: boolean;
};

async function computeGrants(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<GetSensitiveInfoGrants> {
  const [pastoralNotes, demographics, medical, disabilities] =
    await Promise.all([
      hasPermission(tx, personId, organizationId, PASTORAL_NOTES_MANAGE),
      hasPermission(tx, personId, organizationId, DEMOGRAPHICS_MANAGE),
      hasPermission(tx, personId, organizationId, MEDICAL_MANAGE),
      hasPermission(tx, personId, organizationId, DISABILITIES_MANAGE),
    ]);
  return { pastoralNotes, demographics, medical, disabilities };
}

/**
 * Used by the main `/edit` page to decide whether to render the link into
 * `./edit/sensitive` at all — absent, not disabled, per Phase 1's explicit
 * requirement. Cheap: no person read, permission checks only.
 */
export async function getSensitiveInfoGrants(
  viewerPersonId: string,
  organizationId: string,
): Promise<GetSensitiveInfoGrants> {
  return withOrgContext(viewerPersonId, organizationId, (tx) =>
    computeGrants(tx, viewerPersonId, organizationId),
  );
}

// ---------------------------------------------------------------------------
// getSensitiveInfoForEdit
// ---------------------------------------------------------------------------

export interface SensitiveInfoForEdit {
  personId: string;
  grants: GetSensitiveInfoGrants;
  /** Present iff grants.pastoralNotes. clergy_only rows omitted entirely for
   * a non-clergy viewer (see this module's header). */
  notes?: Array<{
    id: string;
    noteType: string;
    visibility: "staff" | "pastoral" | "clergy_only";
    body: string;
    occurredOn: string | null;
    authorUserId: string;
    createdAt: string;
  }>;
  /** Present iff grants.demographics. null = no row yet (never nulled by
   * permission — absence here always means "not entered", not "hidden"). */
  demographics?: {
    gender: string | null;
    racialEthnic: string[] | null;
    source: string;
  } | null;
  /** Present iff grants.medical. */
  medical?: {
    allergies: string | null;
    medicalNotes: string | null;
    medications: string | null;
    authorizedPickup: string | null;
  } | null;
  /** Present iff grants.disabilities. Empty array = no categories recorded. */
  disabilities?: string[];
  /** organizationSettings.settings.trackDisabilityPerPerson — the
   * disabilities section renders only when this is true AND
   * grants.disabilities is true (both, not either). */
  disabilityTrackingEnabled: boolean;
}

export type GetSensitiveInfoForEditResult =
  | { kind: "ok"; data: SensitiveInfoForEdit }
  | { kind: "forbidden" } // viewer holds NONE of the four permissions
  | { kind: "not_found" }; // same collapse as getPersonForEdit

/**
 * Enumeration-safe, matching `getPersonForEdit`'s own `{ kind }` union: a
 * denied viewer and an authorized viewer looking at a person with zero rows
 * in every one of the four tables render byte-identical shape/timing.
 */
export async function getSensitiveInfoForEdit(
  viewerPersonId: string,
  organizationId: string,
  personId: string,
): Promise<GetSensitiveInfoForEditResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const grants = await computeGrants(tx, viewerPersonId, organizationId);
    if (
      !grants.pastoralNotes &&
      !grants.demographics &&
      !grants.medical &&
      !grants.disabilities
    ) {
      return { kind: "forbidden" };
    }

    if (!(await personVisibleInOrg(tx, personId, organizationId))) {
      return { kind: "not_found" };
    }

    const disabilityTrackingEnabled = await readDisabilityTrackingEnabled(
      tx,
      organizationId,
    );

    let notes: SensitiveInfoForEdit["notes"];
    if (grants.pastoralNotes) {
      const isClergy = await isOrdainedClergy(tx, viewerPersonId, organizationId);
      const rows = await tx
        .select({
          id: personNotes.id,
          noteType: personNotes.noteType,
          visibility: personNotes.visibility,
          body: personNotes.body,
          occurredOn: personNotes.occurredOn,
          authorUserId: personNotes.authorUserId,
          createdAt: personNotes.createdAt,
        })
        .from(personNotes)
        .where(
          and(
            eq(personNotes.personId, personId),
            eq(personNotes.organizationId, organizationId),
          ),
        )
        .orderBy(desc(personNotes.createdAt));

      notes = rows
        .filter((row) => row.visibility !== "clergy_only" || isClergy)
        .map((row) => ({
          id: row.id,
          noteType: row.noteType,
          visibility: row.visibility as "staff" | "pastoral" | "clergy_only",
          body: row.body,
          occurredOn: row.occurredOn,
          authorUserId: row.authorUserId,
          createdAt: row.createdAt.toISOString(),
        }));
    }

    let demographics: SensitiveInfoForEdit["demographics"];
    if (grants.demographics) {
      const [row] = await tx
        .select({
          gender: personDemographics.gender,
          racialEthnic: personDemographics.racialEthnic,
          source: personDemographics.source,
        })
        .from(personDemographics)
        .where(
          and(
            eq(personDemographics.personId, personId),
            eq(personDemographics.organizationId, organizationId),
          ),
        )
        .limit(1);
      demographics = row ?? null;
    }

    let medical: SensitiveInfoForEdit["medical"];
    if (grants.medical) {
      const [row] = await tx
        .select({
          allergies: personMedical.allergies,
          medicalNotes: personMedical.medicalNotes,
          medications: personMedical.medications,
          authorizedPickup: personMedical.authorizedPickup,
        })
        .from(personMedical)
        .where(
          and(
            eq(personMedical.personId, personId),
            eq(personMedical.organizationId, organizationId),
          ),
        )
        .limit(1);
      medical = row ?? null;
    }

    let disabilities: string[] | undefined;
    if (grants.disabilities) {
      const rows = await tx
        .select({ category: personDisabilities.category })
        .from(personDisabilities)
        .where(
          and(
            eq(personDisabilities.personId, personId),
            eq(personDisabilities.organizationId, organizationId),
          ),
        );
      disabilities = rows.map((row) => row.category);
    }

    return {
      kind: "ok",
      data: {
        personId,
        grants,
        notes,
        demographics,
        medical,
        disabilities,
        disabilityTrackingEnabled,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// addPersonNote — person_notes, INSERT ONLY (no update/delete in v1)
// ---------------------------------------------------------------------------

export interface AddPersonNoteInput {
  noteType: string;
  visibility: "staff" | "pastoral" | "clergy_only";
  body: string;
  occurredOn?: string;
}

export type AddPersonNoteResult =
  | { kind: "ok"; noteId: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_input"; field: "body" }; // body over BODY_MAX_LENGTH

export async function addPersonNote(
  actingPersonId: string,
  organizationId: string,
  actorUserId: string,
  personId: string,
  input: AddPersonNoteInput,
): Promise<AddPersonNoteResult> {
  if (input.body.length > BODY_MAX_LENGTH) {
    return { kind: "invalid_input", field: "body" };
  }

  const result = await withOrgContext<AddPersonNoteResult>(
    actingPersonId,
    organizationId,
    async (tx) => {
      if (
        !(await hasPermission(
          tx,
          actingPersonId,
          organizationId,
          PASTORAL_NOTES_MANAGE,
        ))
      ) {
        return { kind: "forbidden" };
      }
      if (!(await personVisibleInOrg(tx, personId, organizationId))) {
        return { kind: "not_found" };
      }

      const [row] = await tx
        .insert(personNotes)
        .values({
          organizationId,
          personId,
          noteType: input.noteType,
          visibility: input.visibility,
          body: input.body,
          occurredOn: input.occurredOn ?? null,
          authorUserId: actorUserId,
        })
        .returning({ id: personNotes.id });

      return { kind: "ok", noteId: row!.id };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.TENANT_PERSON_NOTE_ADDED,
      resourceType: "person_note",
      resourceId: result.noteId,
      metadata: { organizationId, personId, visibility: input.visibility },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// setPersonDemographics — person_demographics, UPSERT (singleton per person)
// ---------------------------------------------------------------------------

export interface SetPersonDemographicsInput {
  gender: string | null;
  racialEthnic: string[] | null;
  source: "self" | "staff";
}

export type SetPersonDemographicsResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_input"; field: "gender" }; // gender over FIELD_MAX_LENGTH

export async function setPersonDemographics(
  actingPersonId: string,
  organizationId: string,
  personId: string,
  input: SetPersonDemographicsInput,
): Promise<SetPersonDemographicsResult> {
  if (input.gender !== null && input.gender.length > FIELD_MAX_LENGTH) {
    return { kind: "invalid_input", field: "gender" };
  }

  const result = await withOrgContext<SetPersonDemographicsResult>(
    actingPersonId,
    organizationId,
    async (tx) => {
      if (
        !(await hasPermission(
          tx,
          actingPersonId,
          organizationId,
          DEMOGRAPHICS_MANAGE,
        ))
      ) {
        return { kind: "forbidden" };
      }
      if (!(await personVisibleInOrg(tx, personId, organizationId))) {
        return { kind: "not_found" };
      }

      await tx
        .insert(personDemographics)
        .values({
          personId,
          organizationId,
          gender: input.gender,
          racialEthnic: input.racialEthnic,
          source: input.source,
        })
        .onConflictDoUpdate({
          target: personDemographics.personId,
          set: {
            gender: input.gender,
            racialEthnic: input.racialEthnic,
            source: input.source,
            updatedAt: new Date(),
          },
        });

      return { kind: "ok" };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.TENANT_PERSON_DEMOGRAPHICS_UPDATED,
      resourceType: "person_demographics",
      resourceId: personId,
      metadata: { organizationId },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// setPersonMedical — person_medical, UPSERT (singleton per person)
// ---------------------------------------------------------------------------

export interface SetPersonMedicalInput {
  allergies: string | null;
  medicalNotes: string | null;
  medications: string | null;
  authorizedPickup: string | null;
}

type MedicalFreeTextField =
  | "allergies"
  | "medicalNotes"
  | "medications"
  | "authorizedPickup";

export type SetPersonMedicalResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_input"; field: MedicalFreeTextField }; // over BODY_MAX_LENGTH

function firstOverlongMedicalField(
  input: SetPersonMedicalInput,
): MedicalFreeTextField | null {
  const fields: Array<[MedicalFreeTextField, string | null]> = [
    ["allergies", input.allergies],
    ["medicalNotes", input.medicalNotes],
    ["medications", input.medications],
    ["authorizedPickup", input.authorizedPickup],
  ];
  for (const [field, value] of fields) {
    if (value !== null && value.length > BODY_MAX_LENGTH) {
      return field;
    }
  }
  return null;
}

export async function setPersonMedical(
  actingPersonId: string,
  organizationId: string,
  personId: string,
  input: SetPersonMedicalInput,
): Promise<SetPersonMedicalResult> {
  const overlongField = firstOverlongMedicalField(input);
  if (overlongField) {
    return { kind: "invalid_input", field: overlongField };
  }

  const result = await withOrgContext<SetPersonMedicalResult>(
    actingPersonId,
    organizationId,
    async (tx) => {
      if (
        !(await hasPermission(tx, actingPersonId, organizationId, MEDICAL_MANAGE))
      ) {
        return { kind: "forbidden" };
      }
      if (!(await personVisibleInOrg(tx, personId, organizationId))) {
        return { kind: "not_found" };
      }

      await tx
        .insert(personMedical)
        .values({
          personId,
          organizationId,
          allergies: input.allergies,
          medicalNotes: input.medicalNotes,
          medications: input.medications,
          authorizedPickup: input.authorizedPickup,
        })
        .onConflictDoUpdate({
          target: personMedical.personId,
          set: {
            allergies: input.allergies,
            medicalNotes: input.medicalNotes,
            medications: input.medications,
            authorizedPickup: input.authorizedPickup,
            updatedAt: new Date(),
          },
        });

      return { kind: "ok" };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.TENANT_PERSON_MEDICAL_UPDATED,
      resourceType: "person_medical",
      resourceId: personId,
      metadata: { organizationId },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// setPersonDisabilities — person_disabilities, SET-REPLACE
// (delete-then-insert the whole category set for this person, one
// transaction — DECISION-108's write-semantics ruling, same "no history
// table, no concurrent-editor story" reasoning as DECISION-092's
// organization_service_times/organization_office_hours).
// ---------------------------------------------------------------------------

export interface SetPersonDisabilitiesInput {
  categories: string[];
}

export type SetPersonDisabilitiesResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "tracking_disabled" };

/**
 * Rejects if `organizationSettings.settings.trackDisabilityPerPerson` is
 * false — defense in depth; the UI already hides the section in that case.
 */
export async function setPersonDisabilities(
  actingPersonId: string,
  organizationId: string,
  personId: string,
  input: SetPersonDisabilitiesInput,
): Promise<SetPersonDisabilitiesResult> {
  const result = await withOrgContext<SetPersonDisabilitiesResult>(
    actingPersonId,
    organizationId,
    async (tx) => {
      if (
        !(await hasPermission(
          tx,
          actingPersonId,
          organizationId,
          DISABILITIES_MANAGE,
        ))
      ) {
        return { kind: "forbidden" };
      }
      if (!(await personVisibleInOrg(tx, personId, organizationId))) {
        return { kind: "not_found" };
      }
      if (!(await readDisabilityTrackingEnabled(tx, organizationId))) {
        return { kind: "tracking_disabled" };
      }

      await tx
        .delete(personDisabilities)
        .where(
          and(
            eq(personDisabilities.personId, personId),
            eq(personDisabilities.organizationId, organizationId),
          ),
        );

      if (input.categories.length > 0) {
        await tx.insert(personDisabilities).values(
          input.categories.map((category) => ({
            personId,
            organizationId,
            category,
            source: "staff_observed",
          })),
        );
      }

      return { kind: "ok" };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.TENANT_PERSON_DISABILITY_SET,
      resourceType: "person_disabilities",
      resourceId: personId,
      metadata: { organizationId, categories: input.categories },
    });
  }

  return result;
}
