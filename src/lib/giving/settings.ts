import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { givingKeysInTx } from "./keys";
import { rowsOf } from "./db-util";
import {
  GIVING_SETTINGS_FIELDS,
  statementBlockers,
  type GivingSettingsField,
  type GivingSettingsValues,
} from "./settings-input";

/**
 * The donee identity printed on year-end statements - docs/work-log/
 * 2026-10-15-online-giving.md, R5 / DECISION-172 and the Phase 3 API contract
 * "settings.ts". `giving.manage` reads and writes it.
 *
 * ONE ROW PER ORGANIZATION (`giving_settings`, primary key `organization_id`).
 * The row is created on the first save; until then every field reads as blank.
 * Statements SNAPSHOT these values when issued, so editing here never rewrites
 * a statement already issued - the page says so.
 *
 * The audit event carries field NAMES only (the legal name, address and EIN are
 * printed on documents but do not belong in an audit trail).
 */

export type GivingSettingsRow = { [K in GivingSettingsField]: string | null };

export type GetGivingSettingsResult =
  | {
      kind: "ok";
      settings: GivingSettingsRow;
      /** What would stop a statement run right now. Empty means the identity is complete. */
      blockers: Array<"donee_name" | "donee_address">;
      /** False until the first save. */
      saved: boolean;
    }
  | { kind: "forbidden" };

const COLUMN: Record<GivingSettingsField, string> = {
  doneeLegalName: "donee_legal_name",
  doneeAddressLine1: "donee_address_line1",
  doneeAddressLine2: "donee_address_line2",
  doneeCity: "donee_city",
  doneeRegion: "donee_region",
  doneePostalCode: "donee_postal_code",
  doneeEin: "donee_ein",
  signatoryName: "signatory_name",
  signatoryTitle: "signatory_title",
  greetingText: "greeting_text",
  closingText: "closing_text",
};

function blankSettings(): GivingSettingsRow {
  return Object.fromEntries(GIVING_SETTINGS_FIELDS.map((f) => [f, null])) as GivingSettingsRow;
}

export async function getGivingSettings(
  personId: string,
  organizationId: string,
): Promise<GetGivingSettingsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    const row = rowsOf(
      await tx.execute(sql`
        select donee_legal_name, donee_address_line1, donee_address_line2, donee_city, donee_region,
               donee_postal_code, donee_ein, signatory_name, signatory_title, greeting_text, closing_text
          from giving_settings where organization_id = ${organizationId}::uuid
      `),
    )[0];
    const settings = blankSettings();
    if (row) {
      for (const field of GIVING_SETTINGS_FIELDS) {
        settings[field] = (row[COLUMN[field]] as string | null) ?? null;
      }
    }
    return {
      kind: "ok",
      settings,
      blockers: statementBlockers(settings),
      saved: Boolean(row),
    };
  });
}

export type UpdateGivingSettingsResult =
  | { kind: "ok"; changedFields: GivingSettingsField[] }
  | { kind: "forbidden" };

/** Upserts the row. `giving.manage`. Returns the names of the fields that changed. */
export async function updateGivingSettings(
  personId: string,
  organizationId: string,
  userId: string,
  values: GivingSettingsValues,
): Promise<UpdateGivingSettingsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    const existing = rowsOf(
      await tx.execute(sql`
        select donee_legal_name, donee_address_line1, donee_address_line2, donee_city, donee_region,
               donee_postal_code, donee_ein, signatory_name, signatory_title, greeting_text, closing_text
          from giving_settings where organization_id = ${organizationId}::uuid for update
      `),
    )[0];
    const changedFields = GIVING_SETTINGS_FIELDS.filter(
      (field) => ((existing ? existing[COLUMN[field]] : null) ?? null) !== (values[field] ?? null),
    );
    if (existing && changedFields.length === 0) return { kind: "ok", changedFields };

    await tx.execute(sql`
      insert into giving_settings (organization_id, donee_legal_name, donee_address_line1, donee_address_line2,
             donee_city, donee_region, donee_postal_code, donee_ein, signatory_name, signatory_title,
             greeting_text, closing_text, updated_by, updated_at)
      values (${organizationId}::uuid, ${values.doneeLegalName}, ${values.doneeAddressLine1},
              ${values.doneeAddressLine2}, ${values.doneeCity}, ${values.doneeRegion}, ${values.doneePostalCode},
              ${values.doneeEin}, ${values.signatoryName}, ${values.signatoryTitle}, ${values.greetingText},
              ${values.closingText}, ${userId}::uuid, now())
      on conflict (organization_id) do update set
        donee_legal_name = excluded.donee_legal_name, donee_address_line1 = excluded.donee_address_line1,
        donee_address_line2 = excluded.donee_address_line2, donee_city = excluded.donee_city,
        donee_region = excluded.donee_region, donee_postal_code = excluded.donee_postal_code,
        donee_ein = excluded.donee_ein, signatory_name = excluded.signatory_name,
        signatory_title = excluded.signatory_title, greeting_text = excluded.greeting_text,
        closing_text = excluded.closing_text, updated_by = excluded.updated_by, updated_at = now()
    `);
    return { kind: "ok", changedFields };
  });
}
