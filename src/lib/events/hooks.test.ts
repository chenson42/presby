import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { OrgTx } from "@/lib/authz";
import {
  runEventCancelledHooks,
  runEventUpdatedHooks,
  runHookList,
  type EventCancelledHookInput,
  type EventUpdatedHookInput,
} from "./hooks";

// Neither runner touches the transaction while its list is empty, and the
// combinator only passes it through, so an opaque stand-in is enough here.
const tx = {} as OrgTx;

const cancelled: EventCancelledHookInput = {
  organizationId: "00000000-0000-4000-8000-0000000000a1",
  eventId: "00000000-0000-4000-8000-0000000000e1",
  actor: null,
};
const updated: EventUpdatedHookInput = {
  organizationId: cancelled.organizationId,
  eventId: cancelled.eventId,
  before: { startsAt: new Date(Date.UTC(2026, 10, 15, 9, 0)), endsAt: null, location: null },
  after: {
    startsAt: new Date(Date.UTC(2026, 10, 15, 10, 0)),
    endsAt: null,
    location: "Fellowship hall",
  },
};

describe("events/hooks.ts", () => {
  it("both lists are empty in Batch 0: each runner resolves { queueIds: [] } and touches nothing", async () => {
    await expect(runEventCancelledHooks(tx, cancelled)).resolves.toEqual({ queueIds: [] });
    await expect(runEventUpdatedHooks(tx, updated)).resolves.toEqual({ queueIds: [] });
  });

  it("runHookList runs every consumer in order, with the same tx and input, and combines their queue ids (S1)", async () => {
    const order: string[] = [];
    const first = vi.fn(async () => {
      order.push("first");
      return { queueIds: ["q1", "q2"] };
    });
    const second = vi.fn(async () => {
      order.push("second");
      return { queueIds: [] };
    });
    const third = vi.fn(async () => {
      order.push("third");
      return { queueIds: ["q3"] };
    });

    const result = await runHookList([first, second, third], tx, cancelled);

    expect(result).toEqual({ queueIds: ["q1", "q2", "q3"] });
    expect(order).toEqual(["first", "second", "third"]);
    for (const hook of [first, second, third]) {
      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook).toHaveBeenCalledWith(tx, cancelled);
    }
  });

  it("a consumer that throws stops the fan-out and the error reaches the caller (so the caller's transaction rolls back)", async () => {
    const boom = vi.fn(async () => {
      throw new Error("consumer failed");
    });
    const after = vi.fn(async () => ({ queueIds: ["never"] }));
    await expect(runHookList([boom, after], tx, cancelled)).rejects.toThrow("consumer failed");
    expect(after).not.toHaveBeenCalled();
  });
});
