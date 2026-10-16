/**
 * org-feature-warnings.ts against a REAL Postgres connection (docs/work-log/
 * 2026-10-15-online-giving.md, "Files to modify"): the Features page's
 * "turning Giving OFF with active monthly gifts" warning, readable by an
 * org_features.manage holder who holds NO giving key. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/org-feature-warnings.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { GivingFixture } from "@/lib/testing/giving-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("loadOffWarnings (Postgres-backed)", () => {
  let fx: GivingFixture;
  let warnings: typeof import("./org-feature-warnings");
  let org: string;
  let featuresAdmin: { personId: string; userId: string };

  beforeAll(async () => {
    const mod = await import("@/lib/testing/giving-fixture");
    fx = await mod.createGivingFixture("warnings-db-test");
    warnings = await import("./org-feature-warnings");
    org = await fx.makeOrg("a", { givingToggle: true });
    featuresAdmin = await fx.makeActor(org, "Fay", "Features", ["org_features.manage"]); // NO giving key
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("a feature with no registry entry has no warning, and no query runs", async () => {
    expect(await warnings.loadOffWarnings(featuresAdmin.personId, org, ["org_portal.calendar"])).toEqual({});
    expect(await warnings.loadOffWarnings(featuresAdmin.personId, org, [])).toEqual({});
  });

  it("no active monthly gifts: no warning", async () => {
    expect(await warnings.loadOffWarnings(featuresAdmin.personId, org, ["org_portal.giving"])).toEqual({});
  });

  it("N active monthly gifts: a warning that names the count and says recording continues - readable WITHOUT a giving key", async () => {
    const conn = await fx.makeConnection(org, { status: "active", livemode: true });
    const fund = await fx.makeFund(org, "General");
    const donor = await fx.makeDonor(org, "Monthly Donor");
    const { armGivingWrite } = await import("@/lib/testing/giving-fixture");
    await fx.platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      await tx.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, donor_id, frequency, method_choice,
               cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status,
               subscription_id, expires_at, completed_at)
        values (${org}, ${conn}, ${fund}, ${donor}, 'monthly', 'card', false, 2500, 0, 2500, true, ${crypto.randomUUID()}, 'completed',
                'sub_fixture_warn_001', now() + interval '1 day', now())`);
    });
    const one = await warnings.loadOffWarnings(featuresAdmin.personId, org, ["org_portal.giving"]);
    expect(one["org_portal.giving"]?.description).toMatch(/^1 monthly gift is still active in Stripe and keeps charging until cancelled there\./);
    expect(one["org_portal.giving"]?.description).toMatch(/does not stop recording/);

    await fx.platform.transaction(async (tx) => {
      await armGivingWrite(tx);
      await tx.execute(sql`
        insert into giving_checkout_intents (organization_id, connection_id, fund_id, donor_id, frequency, method_choice,
               cover_fees, gift_amount_cents, donor_covered_fee_cents, total_cents, livemode, idempotency_key, status,
               subscription_id, expires_at, completed_at)
        values (${org}, ${conn}, ${fund}, ${donor}, 'monthly', 'card', false, 3000, 0, 3000, true, ${crypto.randomUUID()}, 'completed',
                'sub_fixture_warn_002', now() + interval '1 day', now())`);
    });
    const two = await warnings.loadOffWarnings(featuresAdmin.personId, org, ["org_portal.giving"]);
    expect(two["org_portal.giving"]?.description).toMatch(/^2 monthly gifts are still active/);
  });

  it("an OrgAccessError (no membership) propagates to the page rather than being swallowed into a generic warning", async () => {
    const stranger = await fx.makePerson("Stan", "Stranger");
    await expect(warnings.loadOffWarnings(stranger, org, ["org_portal.giving"])).rejects.toThrow();
  });
});
