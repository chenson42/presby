/**
 * fixture.ts - the world the help screenshots are taken in (user-help Inc 1, Batch 4).
 *
 * Everything happens on the OWNER connection, against the scratch fixture database the guard has
 * just cleared (guard.ts). Three things, in the order the screens need them:
 *
 *   1. Global flags at the PRODUCTION posture of the operator ruling: every `org_portal.*` flag on
 *      except `filings` and `statistical_publication`, plus the sites, branding, merged-home and
 *      auth flags. The images must show what a congregation in production sees, not what a
 *      development branch happens to have on. Captured first, restored (and verified by SELECT)
 *      by `restore()`; nothing is added to scripts/ci/e2e-baseline-flags.sql.
 *   2. The fixture congregation's per-org toggles, set to the first live congregation's: calendar,
 *      job openings, website domain, giving, adding people, parish management, public calendar and
 *      sensitive info on. Previous values are restored (a toggle with no row is set back to off,
 *      never deleted).
 *   3. A founding administrator. A seeded person at Alder Creek (scripts/seed-dev.sql) is linked to
 *      the `mfa-enrolled` sign-in (the seeded sign-in that was linked to her is unlinked first: the
 *      link is one to one) and is given exactly what the real designation gives, by calling the
 *      same SECURITY DEFINER helper the invitation acceptance calls
 *      (presby_apply_founding_administrator, owner-only), so the bundle is the one a founder has,
 *      not a hand-copied approximation. The helper refuses a congregation that already has someone
 *      who can manage roles (which Alder Creek's seed does), so those seeded grants are end-dated
 *      to today first (an end date, never a delete). None of this is undone: the database is
 *      disposable, and the guard will not let this run anywhere that is not.
 */
import { withDbRetry, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import { E2E_USERS } from "../support/users";

/** The fixture congregation: invented name, scripts/seed-dev.sql. */
export const SHOTS_ORG = {
  id: "22222222-2222-2222-2222-222222222222",
  slug: "alder-creek",
} as const;

/**
 * The founding administrator signs in as the e2e `mfa-enrolled` user: a founder's role requires
 * two-factor (roles.manage and friends), and that fixture has a real TOTP secret the spec can
 * derive a code from (the same route totp-full-login.spec.ts and giving-fixture.ts take). It is
 * linked, below, to a seeded person at Alder Creek (an invented name).
 */
export const FOUNDER = {
  email: E2E_USERS["mfa-enrolled"].email,
  password: E2E_USERS["mfa-enrolled"].password,
  personId: "c0000000-0000-0000-0000-000000000002",
} as const;

/** Flags that are on in production besides the org_portal.* family. */
const PRODUCTION_ON = [
  "sites.public_render",
  "sites.public_staff_directory",
  "sites.public_committee_directory",
  "ui.brand_theming",
  "ui.branded_signin",
  "platform.merged_home",
  "auth.require_2fa",
  "auth.local_login",
] as const;
/** org_portal.* flags that are OFF in production. */
const PRODUCTION_OFF = ["org_portal.filings", "org_portal.statistical_publication"] as const;

/** Per-org toggles of the first live congregation. */
export const SHOTS_TOGGLES = [
  "org_portal.calendar",
  "org_portal.careers",
  "org_portal.domains",
  "org_portal.giving",
  "org_portal.members_create",
  "org_portal.parishes",
  "org_portal.public_calendar",
  "org_portal.sensitive_info",
] as const;

export interface ShotsWorld {
  restore(): Promise<void>;
  /** What the founding-administrator step did: "ok", or "already" on a re-run. */
  founderOutcome: string;
}

export async function setupShotsWorld(sql: Sql): Promise<ShotsWorld> {
  // 1. flags
  const portal = (await withDbRetry(
    "list org_portal flags",
    () => sql`select key from feature_flags where key like 'org_portal.%'`,
  )) as { key: string }[];
  const desired = new Map<string, boolean>();
  for (const { key } of portal) desired.set(key, !(PRODUCTION_OFF as readonly string[]).includes(key));
  for (const key of PRODUCTION_ON) desired.set(key, true);
  const flagCapture: FlagCapture = await captureFlags(sql, [...desired.keys()]);
  for (const [key, enabled] of desired) await setFlag(sql, key, enabled);

  // 2. the congregation's toggles
  const before = (await withDbRetry(
    "read fixture toggles",
    () =>
      sql`select feature_key, enabled from organization_feature_toggles
           where organization_id = ${SHOTS_ORG.id}::uuid and feature_key = any(${[...SHOTS_TOGGLES]})`,
  )) as { feature_key: string; enabled: boolean }[];
  const prior = new Map(before.map((r) => [r.feature_key, r.enabled]));
  const setToggle = (key: string, enabled: boolean) =>
    withDbRetry(
      `toggle ${key}`,
      () => sql`
        insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
        values (${SHOTS_ORG.id}::uuid, ${key}, ${enabled}, null)
        on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`,
    );
  for (const key of SHOTS_TOGGLES) await setToggle(key, true);

  // 3. the founding administrator
  await withDbRetry("unlink the seeded sign-in", () => sql`update people set user_id = null where id = ${FOUNDER.personId}::uuid`);
  const linked = (await withDbRetry(
    "link the founder's sign-in",
    () => sql`update people set user_id = (select id from users where email = ${FOUNDER.email}) where id = ${FOUNDER.personId}::uuid returning user_id`,
  )) as { user_id: string | null }[];
  if (!linked[0]?.user_id) {
    throw new Error("[help-shots] the mfa-enrolled fixture user does not exist yet; globalSetup provisions it before the spec runs.");
  }
  // A re-run finds her already a founder: end-dating "every manager" would end her own grants too and
  // pile up a new pair each time, so do nothing more.
  const existing = (await withDbRetry(
    "is the founder already a founder",
    () => sql`
      select count(*)::int as n from role_grants rg join app_roles r on r.id = rg.role_id
       where rg.organization_id = ${SHOTS_ORG.id}::uuid and rg.person_id = ${FOUNDER.personId}::uuid
         and r.key = 'founding_administrator' and (rg.ends_on is null or rg.ends_on > current_date)`,
  )) as { n: number }[];
  let founderOutcome = "already";
  if ((existing[0]?.n ?? 0) === 0) {
    await withDbRetry(
      "end-date the seeded role managers",
      () => sql`
        update role_grants rg
           set ends_on = current_date
         where rg.organization_id = ${SHOTS_ORG.id}::uuid
           and rg.ends_on is null
           and exists (select 1 from app_role_permissions arp
                        where arp.role_id = rg.role_id
                          and arp.permission_key in ('roles.manage', 'role_grants.manage'))`,
    );
    const rows = (await withDbRetry(
      "apply founding administrator",
      () => sql`select outcome from presby_apply_founding_administrator(${SHOTS_ORG.id}::uuid, ${FOUNDER.personId}::uuid, null)`,
    )) as { outcome: string }[];
    founderOutcome = rows[0]?.outcome ?? "none";
    if (founderOutcome !== "ok") {
      throw new Error(`[help-shots] the founding-administrator helper answered "${founderOutcome}"; the world is not what the images need.`);
    }
  }

  return {
    founderOutcome,
    async restore() {
      for (const key of SHOTS_TOGGLES) await setToggle(key, prior.get(key) ?? false);
      await flagCapture.restore();
    },
  };
}
