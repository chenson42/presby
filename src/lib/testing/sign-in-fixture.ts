/**
 * A throwaway-tenant harness for the Community Increment 2b DB suites
 * (drizzle/0065 sections 11-15: the standing core, issue / resend / revoke /
 * reader / card standing, the accept core and its in-place presentation, the
 * listing and connect). TEST SUPPORT ONLY - never imported by application
 * code.
 *
 * Built on `createInvitationFixture()` (organizations and people stamped
 * `deletable_until`, users tracked and removed at cleanup). What this adds:
 *   - `congregation()`: a MANAGED congregation with the three derived groups
 *     (Active Membership from the base fixture, plus Session and Board of
 *     Deacons) and, optionally, an `org_portal.sign_in_connect` toggle row.
 *     Raw-SQL organizations carry no toggle row unless asked: an absent row
 *     is off (DECISION-097), exactly as the e2e and Vitest fixtures rely on.
 *   - `person()`: a person with one membership (engagement and roll chosen),
 *     optionally ended, deceased, merged, or carrying a main email.
 *   - `elsewhere()`: a second membership at another organization (the R31
 *     shape), written with the claim GUC the memberships guard honours.
 *   - `user()`: an account, stamped proven on the OWNER path (the R37 trigger
 *     refuses a non-owner stamp), optionally inactive or enrolled in TOTP.
 *   - `sender()`: a linked person holding a custom role with the given keys.
 *   - `seat()`, `personGrant()`, `groupGrant()`: authority in every shape the
 *     standing core reads.
 *   - `signInRow()`: an OPEN `sign_in` invitation with a known token, on the
 *     owner connection (presby_app holds no privilege on the table).
 *   - presby_app calls for every 0065 callable, each in its own committed
 *     transaction with the organization context set where the callable reads
 *     presby_current_org().
 *
 * Every database module is imported INSIDE the functions. The calling test
 * must `vi.mock("server-only")` itself. Names are synthetic and every address
 * is `example.invalid` (No Real Data).
 */
import { sql, type SQL } from "drizzle-orm";
import { createInvitationFixture, mintToken, rowsOf, type Row } from "./invitation-fixture";

export type { Row };

export interface PersonOptions {
  first?: string;
  engagement?: string;
  roll?: string | null;
  endedOn?: string | null;
  deceased?: string | null;
  /** A main email (normalized). `false` for none; default: a fresh address. */
  email?: string | false;
}

export interface SignInRowOptions {
  createdBy?: string;
  createdAt?: SQL;
  expiresAt?: SQL;
  emailQueueId?: string | null;
}

export async function createSignInFixture(label: string) {
  const fx = await createInvitationFixture(label);
  const { platform, appDb } = fx;
  let counter = 0;

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  let courtTypeId: string | null = null;
  async function courtType(): Promise<string> {
    if (courtTypeId) return courtTypeId;
    await q(sql`insert into group_types (key, name) values ('court', 'Court') on conflict do nothing`);
    const [row] = await q(sql`select id from group_types where key = 'court'`);
    courtTypeId = String(row!.id);
    return courtTypeId;
  }

  /** Set (or clear, with `null`) the auto-connect toggle row. */
  async function toggle(org: string, enabled: boolean | null): Promise<void> {
    if (enabled === null) {
      await q(sql`delete from organization_feature_toggles
                   where organization_id = ${org} and feature_key = 'org_portal.sign_in_connect'`);
      return;
    }
    await q(sql`
      insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
      values (${org}, 'org_portal.sign_in_connect', ${enabled}, null)
      on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`);
  }

  async function congregation(
    tag: string,
    options: { toggle?: boolean | null; platformStatus?: string } = {},
  ): Promise<string> {
    const org = await fx.makeOrg(tag);
    await q(sql`update organizations set platform_status = ${options.platformStatus ?? "managed"} where id = ${org}`);
    const court = await courtType();
    await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      values (${org}, ${court}, 'Session', 'derived', 'session', true),
             (${org}, ${court}, 'Board of Deacons', 'derived', 'diaconate', true)`);
    if (options.toggle !== undefined && options.toggle !== null) await toggle(org, options.toggle);
    else if (options.toggle === undefined) await toggle(org, true);
    return org;
  }

  async function person(org: string, options: PersonOptions = {}): Promise<{ id: string; email: string | null }> {
    counter += 1;
    const id = await fx.makePerson(options.first ?? "Wendeline", `Ashgrove${counter}x${Math.floor(Math.random() * 1e6)}`);
    await q(sql`
      insert into memberships (organization_id, person_id, engagement_status, current_roll, ended_on)
      values (${org}, ${id}, ${options.engagement ?? "regular"},
              ${options.roll === undefined ? "active" : options.roll}, ${options.endedOn ?? null}::date)`);
    let email: string | null = null;
    if (options.email !== false) {
      email = options.email ?? fx.email("p");
      await fx.addEmail(id, email);
    }
    if (options.deceased) {
      await q(sql`update people set date_of_death = ${options.deceased}::date where id = ${id}`);
    }
    return { id, email };
  }

  /**
   * A second membership at `org` (R31), through the memberships guard's claim
   * GUC. No roll: memberships_one_active_roll_idx allows one live active roll
   * per person.
   */
  async function elsewhere(personId: string, org: string, endedOn: string | null = null): Promise<void> {
    await platform.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.person_claim_authorized', ${personId}, true)`);
      await tx.execute(sql`
        insert into memberships (organization_id, person_id, engagement_status, current_roll, ended_on)
        values (${org}, ${personId}, 'regular', null, ${endedOn}::date)`);
    });
  }

  /** Merge `personId` into a fresh survivor. */
  async function merge(personId: string): Promise<void> {
    const survivor = await fx.makePerson("Survivor", `Merge${counter}`);
    await q(sql`update people set merged_into_id = ${survivor} where id = ${personId}`);
  }

  async function user(
    address: string,
    options: { verified?: boolean; active?: boolean; totp?: boolean; name?: string } = {},
  ): Promise<string> {
    const id = await fx.makeUser(address, { isActive: options.active ?? true, name: options.name });
    if (options.verified ?? true) {
      await q(sql`update users set email_verified = clock_timestamp() where id = ${id}`);
    }
    if (options.totp) await totp(id);
    return id;
  }

  async function totp(userId: string): Promise<void> {
    await q(sql`
      insert into user_totp (user_id, secret_ciphertext, enrolled_at)
      values (${userId}, 'fixture-ciphertext', now())
      on conflict (user_id) do nothing`);
  }

  async function role(org: string, perms: readonly string[]): Promise<string> {
    counter += 1;
    return fx.makeRole(org, `fx65_${counter}_${Math.floor(Math.random() * 1e6)}`, perms);
  }

  /** A linked person at `org` holding a custom role with `perms` (2020-01-01, open). */
  async function sender(
    org: string,
    perms: readonly string[] = ["people.manage", "officers.manage"],
  ): Promise<{ userId: string; personId: string; email: string }> {
    const p = await person(org, { first: "Sender" });
    const userId = await user(p.email!);
    await fx.linkUser(p.id, userId);
    if (perms.length > 0) await fx.grant(org, await role(org, perms), p.id);
    return { userId, personId: p.id, email: p.email! };
  }

  /** An officer term; Session offices materialize into the derived roster by trigger. */
  async function seat(
    org: string,
    personId: string,
    office = "ruling_elder",
    startsOn = "2020-01-01",
    endsOn: string | null = null,
  ): Promise<void> {
    await q(sql`
      insert into officer_terms (organization_id, person_id, office, starts_on, ends_on)
      values (${org}, ${personId}, ${office}, ${startsOn}::date, ${endsOn}::date)`);
  }

  async function personGrant(
    org: string,
    personId: string,
    perms: readonly string[],
    window: { startsOn?: string; endsOn?: string | null } = {},
  ): Promise<string> {
    const roleId = await role(org, perms);
    await q(sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, ends_on)
      values (${org}, ${roleId}, ${personId}, ${window.startsOn ?? "2020-01-01"}::date, ${window.endsOn ?? null}::date)`);
    return roleId;
  }

  /**
   * A group (managed, or derived with `derivedFrom`), a role grant on it and
   * `personId`'s membership in it. Derived rosters reject a non-derived row,
   * so the membership is written with source 'derived' for a derived group.
   */
  async function groupGrant(
    org: string,
    personId: string,
    perms: readonly string[],
    options: {
      derivedFrom?: string;
      grantStartsOn?: string;
      grantEndsOn?: string | null;
      memberStartsOn?: string;
      memberEndsOn?: string | null;
    } = {},
  ): Promise<string> {
    counter += 1;
    const typeId = await courtType();
    const derived = options.derivedFrom !== undefined;
    const [g] = await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from)
      values (${org}, ${typeId}, ${`Fixture group ${counter}`}, ${derived ? "derived" : "managed"},
              ${options.derivedFrom ?? null})
      returning id`);
    const groupId = String(g!.id);
    const roleId = await role(org, perms);
    await q(sql`
      insert into role_grants (organization_id, role_id, group_id, starts_on, ends_on)
      values (${org}, ${roleId}, ${groupId}, ${options.grantStartsOn ?? "2020-01-01"}::date,
              ${options.grantEndsOn ?? null}::date)`);
    await q(sql`
      insert into group_memberships (organization_id, group_id, person_id, source, starts_on, ends_on)
      values (${org}, ${groupId}, ${personId}, ${derived ? "derived" : "managed"},
              ${options.memberStartsOn ?? "2020-01-01"}::date, ${options.memberEndsOn ?? null}::date)`);
    return groupId;
  }

  /** An OPEN sign_in invitation with a known token, on the owner connection. */
  async function signInRow(
    org: string,
    personId: string,
    address: string,
    options: SignInRowOptions = {},
  ): Promise<{ id: string; token: string; tokenHash: string }> {
    const { token, tokenHash } = mintToken();
    const [row] = await q(sql`
      insert into account_invitations (organization_id, purpose, origin, email_normalized, person_id,
             token_hash, created_by_user_id, created_at, expires_at, email_queue_id)
      values (${org}, 'sign_in', 'org', ${address}, ${personId}, ${tokenHash},
              ${options.createdBy ?? fx.actingUserId}, ${options.createdAt ?? sql`now()`},
              ${options.expiresAt ?? sql`now() + interval '7 days'`}, ${options.emailQueueId ?? null})
      returning id`);
    return { id: String(row!.id), token, tokenHash };
  }

  // ---------------------------------------------------------------------------
  // presby_app calls (the application connection), one committed tx each
  // ---------------------------------------------------------------------------

  async function app(org: string | null, query: SQL): Promise<Row[]> {
    return appDb.transaction(async (tx) => {
      if (org) await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return rowsOf(await tx.execute(query));
    });
  }

  interface IssueInput {
    confirmed: string | null;
    acknowledged?: boolean;
    tokenHash?: string;
    expiresAt?: SQL;
    queueId?: string | null;
  }

  async function issue(org: string | null, actor: string | null, personId: string | null, input: IssueInput): Promise<Row> {
    const [row] = await app(org, sql`
      select * from presby_issue_sign_in_invitation(${personId}::uuid, ${input.tokenHash ?? mintToken().tokenHash}::text,
             ${input.expiresAt ?? sql`now() + interval '7 days'`}, ${input.queueId ?? null}::uuid,
             ${input.confirmed}::text, ${input.acknowledged ?? false}, ${actor}::uuid)`);
    return row!;
  }

  async function resend(org: string | null, actor: string | null, personId: string | null, input: IssueInput): Promise<Row> {
    const [row] = await app(org, sql`
      select * from presby_resend_sign_in_invitation(${personId}::uuid, ${input.tokenHash ?? mintToken().tokenHash}::text,
             ${input.expiresAt ?? sql`now() + interval '7 days'`}, ${input.queueId ?? null}::uuid,
             ${input.confirmed}::text, ${input.acknowledged ?? false}, ${actor}::uuid)`);
    return row!;
  }

  async function revoke(org: string | null, actor: string | null, personId: string | null): Promise<Row> {
    const [row] = await app(org, sql`select * from presby_revoke_sign_in_invitation(${personId}::uuid, ${actor}::uuid)`);
    return row!;
  }

  async function states(org: string | null, actor: string | null, ids: string[] | null): Promise<Row[]> {
    const arr =
      ids === null
        ? sql`null::uuid[]`
        : ids.length === 0
          ? sql`array[]::uuid[]`
          : sql`array[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]::uuid[]`;
    return app(org, sql`select * from presby_sign_in_invitation_states(${arr}, ${actor}::uuid)`);
  }

  async function card(org: string | null, actor: string | null, personId: string | null): Promise<Row[]> {
    return app(org, sql`select * from presby_sign_in_card_standing(${personId}::uuid, ${actor}::uuid)`);
  }

  async function connect(userId: string | null, secondFactor: boolean | null): Promise<Row> {
    const [row] = await app(null, sql`select * from presby_connect_signed_in_account(${userId}::uuid, ${secondFactor}::boolean)`);
    return row!;
  }

  async function acceptInPlace(invitationId: string | null, userId: string | null, secondFactor: boolean | null): Promise<Row> {
    const [row] = await app(null, sql`
      select * from presby_accept_in_place(${invitationId}::uuid, ${userId}::uuid, ${secondFactor}::boolean)`);
    fx.trackUser(row!.user_id as string | null);
    return row!;
  }

  async function listFor(userId: string | null): Promise<Row[]> {
    return app(null, sql`select * from presby_list_invitations_for_account(${userId}::uuid)`);
  }

  /** The standing core, called on the owner connection (it has no grant). */
  async function standing(personId: string, org: string): Promise<Row> {
    const [row] = await q(sql`select * from presby__person_sign_in_standing(${personId}, ${org})`);
    return row!;
  }

  async function linkedUser(personId: string): Promise<string | null> {
    const [row] = await q(sql`select user_id from people where id = ${personId}`);
    return (row?.user_id as string | null) ?? null;
  }

  /**
   * Every row a sign-in act could touch for one organization and person, so
   * "nothing else was written" is an equality of two snapshots.
   */
  async function footprint(org: string): Promise<Row> {
    const [row] = await q(sql`
      select
        (select count(*) from memberships where organization_id = ${org})::int as memberships,
        (select count(*) from role_grants where organization_id = ${org})::int as role_grants,
        (select count(*) from app_roles where organization_id = ${org})::int as app_roles,
        (select count(*) from app_role_permissions arp join app_roles r on r.id = arp.role_id
          where r.organization_id = ${org})::int as role_permissions,
        (select count(*) from group_memberships where organization_id = ${org})::int as group_memberships,
        (select count(*) from officer_terms where organization_id = ${org})::int as officer_terms,
        (select count(*) from account_invitations where organization_id = ${org})::int as invitations,
        (select count(*) from people p join memberships m on m.person_id = p.id
          where m.organization_id = ${org} and p.user_id is not null)::int as linked,
        (select count(*) from contact_methods cm join memberships m on m.person_id = cm.person_id
          where m.organization_id = ${org} and cm.verified_at is not null)::int as verified_contacts,
        (select count(*) from users)::int as users`);
    return row!;
  }

  return {
    ...fx,
    q,
    toggle,
    congregation,
    person,
    elsewhere,
    merge,
    user,
    totp,
    role,
    sender,
    seat,
    personGrant,
    groupGrant,
    signInRow,
    app,
    issue,
    resend,
    revoke,
    states,
    card,
    connect,
    acceptInPlace,
    listFor,
    standing,
    linkedUser,
    footprint,
  };
}

export type SignInFixture = Awaited<ReturnType<typeof createSignInFixture>>;
