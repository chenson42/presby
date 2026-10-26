import "server-only";
import { sql } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";
import { readCard, rowsOf, toCount, type CardResult } from "./read-card";

/**
 * Organizations at a glance: one aggregate over `organizations`.
 *
 *   byType / byStatus  counts by organization_type and platform_status
 *   inactive           lifecycle_status <> 'active'
 *   defaultPalette     no organization_brands row (the organizations list's own
 *                      `hasBrand` definition), counted over every organization
 *                      so it agrees with that list's filter
 *
 * The public org tree and a brand-presence test only; nothing about people.
 */
export const ORG_TYPE_KEYS = [
  "general_assembly",
  "synod",
  "presbytery",
  "congregation",
  "new_worshiping_community",
] as const;
export type OrgTypeKey = (typeof ORG_TYPE_KEYS)[number];

export const PLATFORM_STATUS_KEYS = ["managed", "invited", "unmanaged"] as const;
export type PlatformStatusKey = (typeof PLATFORM_STATUS_KEYS)[number];

export interface OrganizationsCard {
  total: number;
  byType: Record<OrgTypeKey, number>;
  byStatus: Record<PlatformStatusKey, number>;
  inactive: number;
  defaultPalette: number;
}

export function readOrganizationsCard(): Promise<CardResult<OrganizationsCard>> {
  return readCard("organizations", async () => {
    const result = await getPlatformDb().execute(sql`
      select count(*)::int as total,
             count(*) filter (where o.organization_type = 'general_assembly')::int as t_general_assembly,
             count(*) filter (where o.organization_type = 'synod')::int as t_synod,
             count(*) filter (where o.organization_type = 'presbytery')::int as t_presbytery,
             count(*) filter (where o.organization_type = 'congregation')::int as t_congregation,
             count(*) filter (where o.organization_type = 'new_worshiping_community')::int as t_new_worshiping_community,
             count(*) filter (where o.platform_status = 'managed')::int as s_managed,
             count(*) filter (where o.platform_status = 'invited')::int as s_invited,
             count(*) filter (where o.platform_status = 'unmanaged')::int as s_unmanaged,
             count(*) filter (where o.lifecycle_status <> 'active')::int as inactive,
             count(*) filter (
               where not exists (select 1 from organization_brands b where b.organization_id = o.id)
             )::int as default_palette
        from organizations o
    `);
    const row = rowsOf(result)[0] ?? {};
    return {
      total: toCount(row.total),
      byType: Object.fromEntries(ORG_TYPE_KEYS.map((k) => [k, toCount(row[`t_${k}`])])) as Record<OrgTypeKey, number>,
      byStatus: Object.fromEntries(
        PLATFORM_STATUS_KEYS.map((k) => [k, toCount(row[`s_${k}`])]),
      ) as Record<PlatformStatusKey, number>,
      inactive: toCount(row.inactive),
      defaultPalette: toCount(row.default_palette),
    };
  });
}
