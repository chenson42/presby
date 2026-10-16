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
    options: { status?: "succeeded" | "pending" | "failed"; livemode?: boolean; occurredOn?: string; feeCents?: number | null } = {},
  ): Promise<string> {
    const livemode = options.livemode ?? true;
    const status = options.status ?? "succeeded";
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const feeCents = status === "succeeded" ? (options.feeCents ?? null) : null;
    return platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      const intent = await tx.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, donor_id, frequency,
               method_choice, cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents, livemode,
               idempotency_key, status, payment_intent_id, expires_at, completed_at)
        values (${organizationId}, ${connectionId}, ${fundId}, ${donorId}, 'once', 'card', false, ${amountCents}, 0,
                ${amountCents}, ${livemode}, ${crypto.randomUUID()}, 'completed', ${`pi_fixture${stamp}`},
                now() + interval '1 day', now())
        returning id`);
      const intentId = String(rowsOf(intent)[0]!.id);
      const gift = await tx.execute(sql`
        insert into giving_gifts (organization_id, donor_id, fund_id, source, provider, connection_id, intent_id,
               external_transaction_id, method, amount_cents, fee_cents, net_cents, status, occurred_on, occurred_at, livemode)
        values (${organizationId}, ${donorId}, ${fundId}, 'online', 'stripe', ${connectionId}, ${intentId},
                ${`pi_fixture${stamp}`}, 'card', ${amountCents}, ${feeCents},
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
    cleanup,
    rowsOf,
  };
}

export type GivingFixture = Awaited<ReturnType<typeof createGivingFixture>>;
export { rowsOf as givingRowsOf };
