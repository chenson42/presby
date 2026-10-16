import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const database = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: database }));

import { claimEvent } from "./functions";

const INBOX = "11111111-1111-4111-8111-111111111111";

const ROW = {
  raw_body: "{}",
  event_type: "refund.created",
  attempts: 1,
  body_purged: false,
  connection_id: "22222222-2222-4222-8222-222222222222",
  external_account_id: "acct_fixtureAccount0001",
  livemode: false,
  external_event_id: "evt_fixtureClaimedEvent01",
  organization_id: "33333333-3333-4333-8333-333333333333",
};

beforeEach(() => vi.clearAllMocks());

describe("claimEvent - the claim shape", () => {
  it("returns the event id and the organization id the database function names", async () => {
    database.execute.mockResolvedValue({ rows: [ROW] });
    expect(await claimEvent(INBOX)).toMatchObject({
      externalEventId: "evt_fixtureClaimedEvent01",
      organizationId: "33333333-3333-4333-8333-333333333333",
      accountId: "acct_fixtureAccount0001",
    });
  });

  it("is null when nothing is claimable", async () => {
    database.execute.mockResolvedValue({ rows: [] });
    expect(await claimEvent(INBOX)).toBeNull();
  });

  it("refuses a row from a database that lacks the 0055 correction rather than process without the ids", async () => {
    const { external_event_id: _a, organization_id: _b, ...old } = ROW;
    database.execute.mockResolvedValue({ rows: [old] });
    await expect(claimEvent(INBOX)).rejects.toThrow(/external_event_id and organization_id/);
  });
});
