/**
 * A throwaway-tenant harness for the DB-backed giving suites
 * (`src/lib/db/domain/giving.db.test.ts`, `src/lib/giving/two-factor-agreement.test.ts`,
 * and later batches). TEST SUPPORT ONLY - never imported by application code.
 *
 * Built on `createCalendarFixture()` (organizations stamped `deletable_until`,
 * the derived Active Membership group, people, roles, grants, cleanup). Giving
 * rows need nothing of their own at teardown: deleting the fixture org
 * cascades through every giving table, which the giving delete guards permit
 * because the parent organization is gone (drizzle/0055 P3-8 arm B).
 *
 * `armGivingWrite(tx)` sets the transaction-local marker
 * `presby.giving_write_active` that giving_gifts_write_guard /
 * giving_reversals_write_guard require (P3-7). It must run INSIDE the same
 * transaction as the write; outside a transaction it lasts one statement.
 *
 * Every database module is imported INSIDE the functions (the calendar
 * fixture's rule): `@/lib/db` throws at import when DATABASE_URL is unset.
 * The calling test must `vi.mock("server-only")` itself.
 *
 * Names are synthetic (`example.invalid`, invented names); provider ids are
 * obviously fake (`acct_fixture...`) - No Real Data, and no Stripe key shape.
 */
import { sql } from "drizzle-orm";
import { createCalendarFixture, type FixtureOrgOptions } from "./calendar-fixture";

/** Anything with drizzle's `execute(sql)` - a transaction or a db handle. */
interface Executor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

export async function armGivingWrite(tx: Executor): Promise<void> {
  await tx.execute(sql`select set_config('presby.giving_write_active', 'true', true)`);
}

export async function disarmGivingWrite(tx: Executor): Promise<void> {
  await tx.execute(sql`select set_config('presby.giving_write_active', 'false', true)`);
}

type Row = Record<string, unknown>;
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

let accountCounter = 0;
/** A unique, obviously-fake account id matching ^acct_[A-Za-z0-9]{8,64}$. */
export function fakeAccountId(): string {
  accountCounter += 1;
  return `acct_fixture${Date.now()}${accountCounter}${Math.floor(Math.random() * 1000)}`;
}

export interface ConnectionOptions {
  status?: "onboarding" | "active" | "restricted";
  livemode?: boolean;
  /** Attested and gone public (requires status active to be "live"). Default true for active. */
  isPublic?: boolean;
}

export async function createGivingFixture(label: string) {
  const base = await createCalendarFixture(label);
  const { platform } = base;

  /** A fixture org; `givingToggle: true` writes the org_portal.giving row ON. */
  async function makeOrg(
    name: string,
    options: FixtureOrgOptions & { givingToggle?: boolean } = {},
  ): Promise<string> {
    const organizationId = await base.makeOrg(name, options);
    if (options.givingToggle) {
      await platform.execute(sql`
        insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
        values (${organizationId}, 'org_portal.giving', true, null)`);
    }
    return organizationId;
  }

  async function makeConnection(organizationId: string, options: ConnectionOptions = {}): Promise<string> {
    const status = options.status ?? "active";
    const enabled = status === "active";
    const isPublic = options.isPublic ?? enabled;
    return platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      const result = await tx.execute(sql`
        insert into giving_provider_connections (organization_id, provider, external_account_id, livemode, status,
               charges_enabled, payouts_enabled, details_submitted, card_enabled, ach_enabled,
               payouts_attested_at, public_enabled_at)
        values (${organizationId}, 'stripe', ${fakeAccountId()}, ${options.livemode ?? false}, ${status},
                ${enabled}, ${enabled}, ${status !== "onboarding"}, ${enabled}, ${enabled},
                ${isPublic ? sql`now()` : sql`null`}, ${isPublic ? sql`now()` : sql`null`})
        returning id`);
      return String(rowsOf(result)[0]!.id);
    });
  }

  async function makeFund(
    organizationId: string,
    name: string,
    options: { offeredOnline?: boolean; retired?: boolean } = {},
  ): Promise<string> {
    const retired = options.retired ?? false;
    const online = (options.offeredOnline ?? true) && !retired;
    const result = await platform.execute(sql`
      insert into giving_funds (organization_id, name, online_display_name, offered_online, is_active, retired_at)
      values (${organizationId}, ${name}, ${online ? name : null}, ${online}, ${!retired},
              ${retired ? sql`now()` : sql`null`})
      returning id`);
    return String(rowsOf(result)[0]!.id);
  }

  async function makeDonor(
    organizationId: string,
    displayName: string,
    options: { email?: string | null; linkedMembershipId?: string; kind?: "identified" | "unidentified" } = {},
  ): Promise<string> {
    const kind = options.kind ?? "identified";
    const link = options.linkedMembershipId ?? null;
    const result = await platform.execute(sql`
      insert into giving_donors (organization_id, kind, display_name, email, linked_membership_id, link_source, linked_at)
      values (${organizationId}, ${kind}, ${displayName}, ${options.email ?? null}, ${link},
              ${link ? "recorder_confirmed" : null}, ${link ? sql`now()` : sql`null`})
      returning id`);
    return String(rowsOf(result)[0]!.id);
  }

  /** An offline gift written on the owner path with the marker armed. */
  async function makeOfflineGift(
    organizationId: string,
    donorId: string,
    fundId: string,
    amountCents: number,
    options: {
      occurredOn?: string;
      deletableUntil?: Date | null;
      /** A users.id; defaults to the fixture's acting user. */
      recordedBy?: string;
      /** Back-date `created_at` (frozen after insert, so the only way to age an entry). */
      createdDaysAgo?: number;
    } = {},
  ): Promise<string> {
    return platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      const result = await tx.execute(sql`
        insert into giving_gifts (organization_id, donor_id, fund_id, source, method, amount_cents, status,
               occurred_on, livemode, recorded_by, deletable_until, created_at)
        values (${organizationId}, ${donorId}, ${fundId}, 'offline', 'cash', ${amountCents}, 'succeeded',
                ${options.occurredOn ?? sql`current_date - 1`}, true, ${options.recordedBy ?? base.actingUserId},
                ${options.deletableUntil ?? null},
                now() - make_interval(days => ${options.createdDaysAgo ?? 0}))
        returning id`);
      return String(rowsOf(result)[0]!.id);
    });
  }

  /**
   * An ONLINE gift (with the intent it requires) written on the owner path with
   * the marker armed. `livemode` defaults to the connection's own (true here -
   * pass false for a Stripe test-mode gift, which every total must exclude).
   * `amountCents` must be 100..2,500,000 (the intent CHECK).
   */
  async function makeOnlineGift(
    organizationId: string,
    connectionId: string,
    donorId: string,
    fundId: string,
    amountCents: number,
    options: {
      status?: "succeeded" | "pending" | "failed";
      livemode?: boolean;
      occurredOn?: string;
      feeCents?: number | null;
      /** The part of `amountCents` the donor added to cover fees (statements, G10). */
      donorCoveredFeeCents?: number;
    } = {},
  ): Promise<string> {
    const livemode = options.livemode ?? true;
    const status = options.status ?? "succeeded";
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const feeCents = status === "succeeded" ? (options.feeCents ?? null) : null;
    const covered = options.donorCoveredFeeCents ?? 0;
    return platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      const intent = await tx.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, donor_id, frequency,
               method_choice, cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents, livemode,
               idempotency_key, status, payment_intent_id, expires_at, completed_at)
        values (${organizationId}, ${connectionId}, ${fundId}, ${donorId}, 'once', 'card', ${covered > 0},
                ${amountCents - covered}, ${covered},
                ${amountCents}, ${livemode}, ${crypto.randomUUID()}, 'completed', ${`pi_fixture${stamp}`},
                now() + interval '1 day', now())
        returning id`);
      const intentId = String(rowsOf(intent)[0]!.id);
      const gift = await tx.execute(sql`
        insert into giving_gifts (organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
               external_transaction_id, method, amount_cents, donor_covered_fee_cents, fee_cents, net_cents, status,
               occurred_on, occurred_at, livemode)
        values (${organizationId}, ${donorId}, ${fundId}, 'online', 'stripe', ${connectionId}, ${intentId},
                ${`pi_fixture${stamp}`}, 'card', ${amountCents}, ${covered}, ${feeCents},
                ${feeCents === null ? null : amountCents - feeCents}, ${status},
                ${options.occurredOn ?? sql`current_date - 1`}, now(), ${livemode})
        returning id`);
      return String(rowsOf(gift)[0]!.id);
    });
  }

  /** A provider reversal (refund/dispute/ach_return) on an online gift, owner path, marker armed. */
  async function makeReversal(
    organizationId: string,
    connectionId: string,
    giftId: string,
    kind: "refund" | "dispute" | "ach_return",
    amountCents: number,
  ): Promise<string> {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    return platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      const result = await tx.execute(sql`
        insert into giving_gift_reversals (organization_id, gift_id, connection_id, kind, amount_cents,
               external_reversal_id, occurred_on, occurred_at, livemode)
        select ${organizationId}, g.id, ${connectionId}, ${kind}, ${amountCents}, ${`re_fixture${stamp}`},
               current_date, now(), g.livemode
          from giving_gifts g where g.id = ${giftId}
        returning id`);
      return String(rowsOf(result)[0]!.id);
    });
  }

  /** A membership id for (org, person). */
  async function membershipOf(organizationId: string, personId: string): Promise<string> {
    const result = await platform.execute(sql`
      select id from memberships where organization_id = ${organizationId} and person_id = ${personId}`);
    return String(rowsOf(result)[0]!.id);
  }

  /** A platform user linked to `personId` (people.user_id), for 2FA / recorded_by claims. */
  async function linkUser(personId: string, tag: string): Promise<string> {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const result = await platform.execute(sql`
      insert into users (email, name) values (${`${label}-${tag}-${stamp}@example.invalid`}, 'Giving Fixture User')
      returning id`);
    const userId = String(rowsOf(result)[0]!.id);
    userIds.push(userId);
    await platform.execute(sql`update people set user_id = ${userId} where id = ${personId}`);
    return userId;
  }

  const userIds: string[] = [];

  /**
   * A person who is a member of `organizationId`, holds exactly `keys` (a role
   * per distinct key set, via `enroll`), and is linked to a platform user (so
   * `recorded_by` / `presby_giving__actor_may_record` can resolve them). Used by
   * the Batch 2 data-module suites: `keys: []` is a plain member.
   */
  async function makeActor(
    organizationId: string,
    first: string,
    last: string,
    keys: readonly string[],
  ): Promise<{ personId: string; userId: string }> {
    const personId = await base.makePerson(first, last);
    await base.enroll(organizationId, personId, keys);
    const userId = await linkUser(personId, `${first}.${last}`.toLowerCase());
    return { personId, userId };
  }

  /** The donee identity statements snapshot (giving_settings), invented. */
  async function makeGivingSettings(organizationId: string): Promise<void> {
    await platform.execute(sql`
      insert into giving_settings (organization_id, donee_legal_name, donee_address_line1, donee_city, donee_region,
             donee_postal_code, donee_ein, signatory_name, signatory_title, greeting_text, closing_text)
      values (${organizationId}, 'Fixture Presbyterian Church', '1 Fixture Way', 'Fixtureville', 'OH', '00000',
              '00-0000000', 'Fixture Treasurer', 'Treasurer', 'Thank you for your gifts this year.',
              'With gratitude, the Session')
      on conflict (organization_id) do nothing`);
  }

  async function cleanup() {
    await base.cleanup();
    for (const id of userIds) {
      await platform.execute(sql`delete from users where id = ${id}`);
    }
  }

  return {
    ...base,
    makeOrg,
    makeConnection,
    makeFund,
    makeDonor,
    makeOfflineGift,
    makeOnlineGift,
    makeReversal,
    membershipOf,
    linkUser,
    makeActor,
    makeGivingSettings,
    cleanup,
    rowsOf,
  };
}

export interface IssueStatementParams {
  organizationId: string;
  donorId: string;
  taxYear: number;
  /** users.id of the issuer; must hold giving.manage AND giving.view (0056 S1). */
  issuedBy: string;
  version?: number;
  supersedesId?: string | null;
  /** The policy constant written onto the header (default true, the shipped policy). */
  coveredFeeCounted?: boolean;
  /**
   * Compose the lines as if the policy were this value, while the header still
   * says `coveredFeeCounted` - a deliberate disagreement, for the consistency proofs.
   */
  composeCoveredFeeCounted?: boolean;
  /** Cents added to the header's cash total (a tampered total). */
  totalDelta?: number;
  /** Test-only retention exemption, stamped at insert (CLAUDE.md, deletable_until). */
  deletableUntil?: Date | null;
  /**
   * An issued_at to SUPPLY (default: the column default). The insert guard
   * overwrites it with now() (0056 S2) - passing one proves that.
   */
  issuedAt?: string;
}

/**
 * Issues one contribution statement through `tx` - the reference reading of
 * drizzle/0056's counting rule (deviation S4), for the DB-backed suites:
 * stores unique fake "PDF" bytes in blob_assets (store()'s INSERT), then the
 * header and its lines in ONE statement. Counting: remaining = gross - net
 * reversed - (covered fee unless counted); remaining <= 0 is excluded; stock
 * is non_cash; the donor-ROOT group (the donor and everyone merged into it);
 * live, succeeded gifts dated inside the tax year.
 *
 * `tx` is either the presby_app connection with `app.current_org_id` set (the
 * application path) or the owner connection with it set (the insert guard
 * reads presby_current_org() on every connection). The deferred consistency
 * triggers fire when `tx` COMMITS - or at `set constraints ... immediate`.
 * Returns the statement id and the blob id.
 */
export async function issueStatement(
  tx: Executor,
  params: IssueStatementParams,
): Promise<{ statementId: string; blobId: string }> {
  const counted = params.coveredFeeCounted ?? true;
  const composeCounted = params.composeCoveredFeeCounted ?? counted;
  const blob = rowsOf(
    await tx.execute(sql`
      with b as (select convert_to('%PDF-1.7 giving fixture ' || gen_random_uuid()::text, 'UTF8') as bytes)
      insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
      select ${params.organizationId}, encode(sha256(b.bytes), 'hex'), 'application/pdf', octet_length(b.bytes), b.bytes
        from b
      returning id, content_hash`),
  )[0]!;
  const blobId = String(blob.id);
  await tx.execute(sql`
    with base as (
      select g.id as gift_id, g.donor_id, g.occurred_on, g.amount_cents as gross,
             g.donor_covered_fee_cents as covered,
             case when g.method = 'stock' then 'non_cash' else 'cash' end as kind,
             coalesce(f.name, 'Fund') as fund_label,
             case when g.method = 'stock' then coalesce(g.stock_description, 'Securities')
                  else initcap(coalesce(g.method, 'gift')) end as description,
             coalesce((select sum(case when r.kind = 'reinstatement' then -r.amount_cents else r.amount_cents end)
                         from giving_gift_reversals r where r.gift_id = g.id), 0)::integer as reversed
        from giving_gifts g
        left join giving_funds f on f.id = g.fund_id and f.organization_id = g.organization_id
       where g.organization_id = ${params.organizationId}
         and g.livemode and g.status = 'succeeded'
         and g.occurred_on between make_date(${params.taxYear}::int, 1, 1) and make_date(${params.taxYear}::int, 12, 31)
         and g.donor_id in (select d.id from giving_donors d
                             where d.organization_id = ${params.organizationId}
                               and (d.id = ${params.donorId} or d.merged_into_id = ${params.donorId}))),
    counted as (
      select b.*, (b.gross - b.reversed - case when ${composeCounted}::boolean then 0 else b.covered end)::integer as remaining
        from base b),
    numbered as (
      select c.*, row_number() over (order by c.occurred_on, c.gift_id)::smallint as line_no
        from counted c where c.remaining > 0),
    hdr as (
      insert into giving_statements (organization_id, donor_id, tax_year, version, supersedes_id,
             donee_legal_name, donee_address_line1, donee_address_line2, donee_city, donee_region,
             donee_postal_code, donee_ein, signatory_name, signatory_title, greeting_text, closing_text,
             wording_version, donor_name, delivery_line1, delivery_line2, delivery_city, delivery_region,
             delivery_postal_code, delivery_country, delivery_email, period_start, period_end,
             cash_total_cents, gift_count, non_cash_count, covered_fee_counted, blob_asset_id, pdf_sha256,
             issued_by, issued_at, deletable_until)
      select ${params.organizationId}, ${params.donorId}, ${params.taxYear}::smallint, ${params.version ?? 1}::smallint,
             ${params.supersedesId ?? null}::uuid,
             gs.donee_legal_name, gs.donee_address_line1, gs.donee_address_line2, gs.donee_city, gs.donee_region,
             gs.donee_postal_code, gs.donee_ein, gs.signatory_name, gs.signatory_title,
             coalesce(gs.greeting_text, 'Thank you.'), coalesce(gs.closing_text, 'With gratitude.'),
             1, d.display_name, d.address_line1, d.address_line2, d.city, d.region, d.postal_code, d.country, d.email,
             make_date(${params.taxYear}::int, 1, 1), make_date(${params.taxYear}::int, 12, 31),
             (select coalesce(sum(n.remaining) filter (where n.kind = 'cash'), 0) from numbered n) + ${params.totalDelta ?? 0},
             (select count(*) from numbered), (select count(*) from numbered n where n.kind = 'non_cash'),
             ${counted}::boolean, ${blobId}::uuid, ${String(blob.content_hash)}, ${params.issuedBy}::uuid,
             coalesce(${params.issuedAt ?? null}::timestamptz, now()), ${params.deletableUntil ?? null}::timestamptz
        from giving_settings gs
        join giving_donors d on d.id = ${params.donorId} and d.organization_id = ${params.organizationId}
       where gs.organization_id = ${params.organizationId}
      returning id)
    insert into giving_statement_lines (organization_id, statement_id, gift_id, line_no, occurred_on, fund_label,
           description, kind, amount_cents, gross_cents, reversed_cents, covered_fee_cents)
    select ${params.organizationId}, hdr.id, n.gift_id, n.line_no, n.occurred_on, n.fund_label, n.description, n.kind,
           case when n.kind = 'cash' then n.remaining end, n.gross, n.reversed, n.covered
      from numbered n cross join hdr`);
  const statement = rowsOf(
    await tx.execute(sql`
      select id from giving_statements
       where organization_id = ${params.organizationId} and donor_id = ${params.donorId}
         and tax_year = ${params.taxYear} and version = ${params.version ?? 1}`),
  )[0];
  if (!statement) throw new Error("issueStatement: no statement row (the composer wrote nothing)");
  return { statementId: String(statement.id), blobId };
}

export type GivingFixture = Awaited<ReturnType<typeof createGivingFixture>>;
export { rowsOf as givingRowsOf };
