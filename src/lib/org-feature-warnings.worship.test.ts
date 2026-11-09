/**
 * The worship entry in the Features-page off-warning registry, with the database
 * mocked: Copy G8 byte for byte, the singular and zero cases, and the rule that a
 * count that cannot be read never silences the warning (docs/work-log/
 * 2026-11-04-worship-inc1.md, Copy G8). The real-database half is the
 * `presby_worship_open_count()` test in `reads.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  countUpcomingScheduled: vi.fn(),
  FakeOrgAccessError: class FakeOrgAccessError extends Error {},
}));

vi.mock("@/lib/authz", () => ({
  OrgAccessError: mocks.FakeOrgAccessError,
  withOrgContext: async (_p: string, _o: string, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("@/lib/worship/counts", () => ({ countUpcomingScheduled: mocks.countUpcomingScheduled }));
// The other entries in this registry reach the schema through their readers; stubbed as the siblings do.
vi.mock("@/lib/person-photos/reader", () => ({ countChosenPhotos: async () => 0 }));
vi.mock("@/lib/reimbursement/counts", () => ({ openRequestCount: async () => 0 }));

import { loadOffWarnings } from "./org-feature-warnings";

const KEY = "org_portal.worship";

beforeEach(() => vi.clearAllMocks());

describe("org_portal.worship off-warning", () => {
  it("nobody asked or scheduled: no warning at all", async () => {
    mocks.countUpcomingScheduled.mockResolvedValue(0);
    expect(await loadOffWarnings("p", "o", [KEY])).toEqual({});
  });

  it("one person reads in the singular, Copy G8 verbatim", async () => {
    mocks.countUpcomingScheduled.mockResolvedValue(1);
    expect(await loadOffWarnings("p", "o", [KEY])).toEqual({
      [KEY]: {
        title: "People are scheduled for upcoming services",
        description:
          "1 person is asked or scheduled for upcoming services. Turning this off hides the schedule and stops requests and reminders. People who were asked can't answer until you turn it back on. Nothing is deleted.",
      },
    });
  });

  it("several read in the plural and admit the real consequence (people cannot answer while it is off)", async () => {
    mocks.countUpcomingScheduled.mockResolvedValue(12);
    const warning = (await loadOffWarnings("p", "o", [KEY]))[KEY];
    expect(warning?.description).toBe(
      "12 people are asked or scheduled for upcoming services. Turning this off hides the schedule and stops requests and reminders. People who were asked can't answer until you turn it back on. Nothing is deleted.",
    );
    expect(warning?.description).toContain("can't answer until you turn it back on");
  });

  it("a count that cannot be read still warns, with the fallback wording - a blip never silences it", async () => {
    mocks.countUpcomingScheduled.mockRejectedValue(new Error("connection reset"));
    expect(await loadOffWarnings("p", "o", [KEY])).toEqual({
      [KEY]: {
        title: "People may be scheduled for upcoming services",
        description:
          "We couldn't check who is scheduled just now. Turning this off hides the schedule and stops requests and reminders. Nothing is deleted.",
      },
    });
  });

  it("an ended membership is not swallowed into a warning: it propagates", async () => {
    mocks.countUpcomingScheduled.mockRejectedValue(new mocks.FakeOrgAccessError());
    await expect(loadOffWarnings("p", "o", [KEY])).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);
  });

  it("only the worship key reads the worship count", async () => {
    expect(await loadOffWarnings("p", "o", ["org_portal.calendar"])).toEqual({});
    expect(mocks.countUpcomingScheduled).not.toHaveBeenCalled();
  });
});
