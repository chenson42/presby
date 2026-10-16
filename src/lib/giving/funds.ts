import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { isUniqueViolation } from "@/lib/db/errors";
import { givingKeysInTx } from "./keys";
import { rowsOf, violatesConstraint } from "./db-util";
import { type FundValues } from "./fund-input";
import type { RestrictionClass } from "./fund-input";

/**
 * Funds (designations) - docs/work-log/2026-10-15-online-giving.md, Phase 3
 * API contract "Admin - funds" and G23.
 *
 * One `withOrgContext()` transaction per function, gate first (`giving.manage`
 * for everything that changes a fund; the active-fund picker used by the
 * offline-gift form is readable by `giving.record` / `giving.view` too).
 * Typed result unions for every expected outcome; a genuine failure throws.
 * The audit write belongs to `funds/actions.ts`, after the commit.
 *
 * Rules that bind:
 *   - A fund is RETIRED, never deleted; a retired name stays reserved
 *     (`giving_funds_org_lower_name_idx` covers retired rows), so a duplicate
 *     name is a typed `duplicate_name`, not a thrown unique violation.
 *   - Retiring a fund also clears `offered_online` (the CHECK forbids both),
 *     and retiring the LAST online fund while the public page is live needs
 *     `confirm: true` - the page would silently stop working otherwise.
 *   - Reactivating does NOT put a fund back online; offering it is a second,
 *     deliberate edit (fund names offered online are public).
 *   - A retired fund can still be renamed or re-described, but not offered.
 *   - Nothing is offered online by default (G23); the create default is off.
 */

export interface FundRow {
  id: string;
  name: string;
  onlineDisplayName: string | null;
  description: string | null;
  restrictionClass: RestrictionClass;
  offeredOnline: boolean;
  isActive: boolean;
  /** 'YYYY-MM-DD' or null. */
  retiredOn: string | null;
  sortOrder: number;
  /** Any gift (any status) recorded against the fund: the reason it can only be retired. */
  hasGifts: boolean;
}

export type ListFundsResult =
  | { kind: "ok"; funds: FundRow[]; publicPageLive: boolean }
  | { kind: "forbidden" };

/** Every fund (active first, then retired), for the funds page. `giving.manage`. */
export async function listFunds(personId: string, organizationId: string): Promise<ListFundsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    const result = await tx.execute(sql`
      select f.id, f.name, f.online_display_name, f.description, f.restriction_class,
             f.offered_online, f.is_active, f.retired_at::date::text as retired_on, f.sort_order,
             exists (select 1 from giving_gifts x
                      where x.fund_id = f.id and x.organization_id = f.organization_id) as has_gifts
        from giving_funds f
       where f.organization_id = ${organizationId}::uuid
       order by f.is_active desc, f.sort_order asc, lower(f.name) asc
    `);
    const funds: FundRow[] = rowsOf(result).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      onlineDisplayName: (r.online_display_name as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      restrictionClass: r.restriction_class as RestrictionClass,
      offeredOnline: r.offered_online === true,
      isActive: r.is_active === true,
      retiredOn: (r.retired_on as string | null) ?? null,
      sortOrder: Number(r.sort_order),
      hasGifts: r.has_gifts === true,
    }));
    return { kind: "ok", funds, publicPageLive: await publicPageLive(tx, organizationId) };
  });
}

export interface FundOption {
  id: string;
  name: string;
}

export type ListFundOptionsResult =
  | { kind: "ok"; funds: FundOption[] }
  | { kind: "forbidden" };

/**
 * The ACTIVE funds, name only, for the offline-gift form's fund select and the
 * gift list's fund filter. Readable by `giving.record` or `giving.view` (a
 * recorder needs it to record; a viewer needs it to filter) or `giving.manage`.
 */
export async function listFundOptions(
  personId: string,
  organizationId: string,
  options: { includeRetired?: boolean } = {},
): Promise<ListFundOptionsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record && !has.view && !has.manage) return { kind: "forbidden" };
    const includeRetired = options.includeRetired === true && (has.view || has.manage);
    const result = await tx.execute(sql`
      select f.id, f.name
        from giving_funds f
       where f.organization_id = ${organizationId}::uuid
         and (${includeRetired} or f.is_active)
       order by f.is_active desc, f.sort_order asc, lower(f.name) asc
    `);
    return {
      kind: "ok",
      funds: rowsOf(result).map((r) => ({ id: String(r.id), name: String(r.name) })),
    };
  });
}

export type CreateFundResult =
  | { kind: "ok"; fundId: string }
  | { kind: "forbidden" }
  | { kind: "duplicate_name" };

export async function createFund(
  personId: string,
  organizationId: string,
  userId: string,
  values: FundValues,
): Promise<CreateFundResult> {
  try {
    return await withOrgContext(personId, organizationId, async (tx) => {
      const has = await givingKeysInTx(tx, { personId, organizationId });
      if (!has.manage) return { kind: "forbidden" } as const;
      const result = await tx.execute(sql`
        insert into giving_funds (organization_id, name, online_display_name, description,
               restriction_class, offered_online, created_by, updated_by, sort_order)
        values (${organizationId}::uuid, ${values.name}, ${values.onlineDisplayName},
                ${values.description}, ${values.restrictionClass}, ${values.offeredOnline},
                ${userId}::uuid, ${userId}::uuid,
                coalesce((select max(sort_order) + 10 from giving_funds where organization_id = ${organizationId}::uuid), 0))
        returning id
      `);
      return { kind: "ok", fundId: String(rowsOf(result)[0]!.id) } as const;
    });
  } catch (err) {
    if (isUniqueViolation(err) && violatesConstraint(err, "giving_funds_org_lower_name_idx")) {
      return { kind: "duplicate_name" };
    }
    throw err;
  }
}

export type UpdateFundResult =
  | { kind: "ok"; changedFields: string[] }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "duplicate_name" };

/**
 * Edits a fund's name, public name, description, class and online offer. A
 * retired fund keeps `offered_online = false` whatever was asked. Returns the
 * names of the fields that actually changed (the audit event carries names
 * only); an edit that changes nothing is a quiet `ok` with an empty list.
 */
export async function updateFund(
  personId: string,
  organizationId: string,
  userId: string,
  fundId: string,
  values: FundValues,
): Promise<UpdateFundResult> {
  try {
    return await withOrgContext(personId, organizationId, async (tx) => {
      const has = await givingKeysInTx(tx, { personId, organizationId });
      if (!has.manage) return { kind: "forbidden" } as const;

      const existing = rowsOf(
        await tx.execute(sql`
          select name, online_display_name, description, restriction_class, offered_online, is_active
            from giving_funds
           where id = ${fundId}::uuid and organization_id = ${organizationId}::uuid
           for update
        `),
      )[0];
      if (!existing) return { kind: "not_found" } as const;

      const isActive = existing.is_active === true;
      const offeredOnline = isActive && values.offeredOnline;
      // A fund that is not offered online keeps no public name requirement, but
      // an existing public name is preserved so re-offering it is one tick.
      const onlineDisplayName = values.onlineDisplayName;

      const changedFields: string[] = [];
      if (existing.name !== values.name) changedFields.push("name");
      if ((existing.online_display_name ?? null) !== onlineDisplayName) changedFields.push("onlineDisplayName");
      if ((existing.description ?? null) !== values.description) changedFields.push("description");
      if (existing.restriction_class !== values.restrictionClass) changedFields.push("restrictionClass");
      if ((existing.offered_online === true) !== offeredOnline) changedFields.push("offeredOnline");
      if (changedFields.length === 0) return { kind: "ok", changedFields } as const;

      await tx.execute(sql`
        update giving_funds
           set name = ${values.name}, online_display_name = ${onlineDisplayName},
               description = ${values.description}, restriction_class = ${values.restrictionClass},
               offered_online = ${offeredOnline}, updated_by = ${userId}::uuid, updated_at = now()
         where id = ${fundId}::uuid and organization_id = ${organizationId}::uuid
      `);
      return { kind: "ok", changedFields } as const;
    });
  } catch (err) {
    if (isUniqueViolation(err) && violatesConstraint(err, "giving_funds_org_lower_name_idx")) {
      return { kind: "duplicate_name" };
    }
    throw err;
  }
}

export type RetireFundResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "already_retired" }
  /** The last online fund while the public page is live: ask again with `confirm: true`. */
  | { kind: "confirm_required"; reason: "last_online_fund" };

export async function retireFund(
  personId: string,
  organizationId: string,
  userId: string,
  fundId: string,
  options: { confirm?: boolean } = {},
): Promise<RetireFundResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    const fund = rowsOf(
      await tx.execute(sql`
        select is_active, offered_online from giving_funds
         where id = ${fundId}::uuid and organization_id = ${organizationId}::uuid
         for update
      `),
    )[0];
    if (!fund) return { kind: "not_found" };
    if (fund.is_active !== true) return { kind: "already_retired" };

    if (fund.offered_online === true && options.confirm !== true) {
      const otherOnline = rowsOf(
        await tx.execute(sql`
          select 1 from giving_funds
           where organization_id = ${organizationId}::uuid and offered_online and is_active
             and id <> ${fundId}::uuid
           limit 1
        `),
      );
      if (otherOnline.length === 0 && (await publicPageLive(tx, organizationId))) {
        return { kind: "confirm_required", reason: "last_online_fund" };
      }
    }

    await tx.execute(sql`
      update giving_funds
         set is_active = false, retired_at = now(), offered_online = false,
             updated_by = ${userId}::uuid, updated_at = now()
       where id = ${fundId}::uuid and organization_id = ${organizationId}::uuid
    `);
    return { kind: "ok" };
  });
}

export type ReactivateFundResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "already_active" };

export async function reactivateFund(
  personId: string,
  organizationId: string,
  userId: string,
  fundId: string,
): Promise<ReactivateFundResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    const fund = rowsOf(
      await tx.execute(sql`
        select is_active from giving_funds
         where id = ${fundId}::uuid and organization_id = ${organizationId}::uuid
         for update
      `),
    )[0];
    if (!fund) return { kind: "not_found" };
    if (fund.is_active === true) return { kind: "already_active" };

    await tx.execute(sql`
      update giving_funds
         set is_active = true, retired_at = null, updated_by = ${userId}::uuid, updated_at = now()
       where id = ${fundId}::uuid and organization_id = ${organizationId}::uuid
    `);
    return { kind: "ok" };
  });
}

/** Is the congregation's public give page live (an open connection with a go-live stamp)? */
async function publicPageLive(tx: OrgTx, organizationId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    select 1 from giving_provider_connections
     where organization_id = ${organizationId}::uuid and status <> 'disconnected'
       and public_enabled_at is not null
     limit 1
  `);
  return rowsOf(result).length > 0;
}
