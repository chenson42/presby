/**
 * The reimbursement entry in the Features-page off-warning registry, with the
 * database mocked: Copy C1 byte for byte, and the rule that a count that cannot
 * be read never silences the warning (docs/work-log/2026-10-25-treasury-inc1.md,
 * Copy C1 and its "fallback" strings). The real-database half is in
 * src/lib/reimbursement/config.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  openRequestCount: vi.fn(),
  FakeOrgAccessError: class FakeOrgAccessError extends Error {},
}));

vi.mock("@/lib/authz", () => ({
  OrgAccessError: mocks.FakeOrgAccessError,
  withOrgContext: async (_p: string, _o: string, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("@/lib/reimbursement/counts", () => ({ openRequestCount: mocks.openRequestCount }));
// The person-photos entry (DECISION-285) shares this registry; its reader is server-only and
// reaches the schema, so it is stubbed here exactly as the photos test stubs it.
vi.mock("@/lib/person-photos/reader", () => ({ countChosenPhotos: async () => 0 }));

import { loadOffWarnings } from "./org-feature-warnings";

const KEY = "org_portal.reimbursement";

beforeEach(() => vi.clearAllMocks());

describe("org_portal.reimbursement off-warning", () => {
  it("no open requests: no warning at all", async () => {
    mocks.openRequestCount.mockResolvedValue(0);
    expect(await loadOffWarnings("p", "o", [KEY])).toEqual({});
  });

  it("one open request reads in the singular, verbatim from Copy C1", async () => {
    mocks.openRequestCount.mockResolvedValue(1);
    expect(await loadOffWarnings("p", "o", [KEY])).toEqual({
      [KEY]: {
        title: "Reimbursement requests are still open",
        description:
          "1 request is open (waiting for approval, for the requester, or for payment). Turning this off hides the pages and nothing is deleted. Turning it back on restores everything.",
      },
    });
  });

  it("several read in the plural", async () => {
    mocks.openRequestCount.mockResolvedValue(7);
    const warning = (await loadOffWarnings("p", "o", [KEY]))[KEY];
    expect(warning?.description).toBe(
      "7 requests are open (waiting for approval, for the requester, or for payment). Turning this off hides the pages and nothing is deleted. Turning it back on restores everything.",
    );
  });

  it("a count that cannot be read still warns, with the fallback wording - a blip never silences it", async () => {
    mocks.openRequestCount.mockRejectedValue(new Error("connection reset"));
    expect(await loadOffWarnings("p", "o", [KEY])).toEqual({
      [KEY]: {
        title: "Reimbursement requests may still be open",
        description: "We couldn't check how many requests are open just now. Turning this off hides the pages and nothing is deleted.",
      },
    });
  });

  it("an ended membership is not swallowed into a warning: it propagates", async () => {
    mocks.openRequestCount.mockRejectedValue(new mocks.FakeOrgAccessError());
    await expect(loadOffWarnings("p", "o", [KEY])).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);
  });

  it("a key with no registry entry has no warning, and the giving entry is untouched", async () => {
    expect(await loadOffWarnings("p", "o", ["org_portal.calendar"])).toEqual({});
    expect(mocks.openRequestCount).not.toHaveBeenCalled();
  });
});
