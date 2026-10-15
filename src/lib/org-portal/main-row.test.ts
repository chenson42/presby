import { describe, expect, it } from "vitest";
import type { UpcomingMemberEvent } from "@/lib/calendar";
import {
  composeMainRow,
  UPCOMING_EVENTS_LIMIT,
  type MainRowInput,
} from "./main-row";

const HOUSEHOLD = { id: "h1", name: "The Fennimore Family", memberCount: 2 };
const GROUP = { groupId: "g1", name: "Altar Guild" };
const EVENT: UpcomingMemberEvent = {
  id: "e1",
  seriesKey: "e1",
  title: "Choir rehearsal",
  startsAtWallClock: "2026-10-18T10:30",
  endsAtWallClock: null,
  location: null,
  eventType: null,
};

function input(over: Partial<MainRowInput> = {}): MainRowInput {
  return {
    household: null,
    groups: [],
    events: { ok: true, value: { kind: "disabled" } },
    ...over,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe("composeMainRow", () => {
  it("renders nothing when there is nothing to show and the calendar is disabled", () => {
    expect(composeMainRow(input())).toEqual({
      layout: "none",
      yours: null,
      upcoming: null,
    });
  });

  it("household only + forbidden events is a single card", () => {
    const plan = composeMainRow(
      input({
        household: HOUSEHOLD,
        events: { ok: true, value: { kind: "forbidden" } },
      }),
    );
    expect(plan.layout).toBe("single");
    expect(plan.upcoming).toBeNull();
    expect(plan.yours).toEqual({ household: HOUSEHOLD, groups: [] });
  });

  it("groups only (household null) still produces Yours", () => {
    const plan = composeMainRow(input({ groups: [GROUP] }));
    expect(plan.yours).toEqual({ household: null, groups: [GROUP] });
    expect(plan.layout).toBe("single");
  });

  it("household and groups both travel inside Yours", () => {
    const plan = composeMainRow(
      input({ household: HOUSEHOLD, groups: [GROUP] }),
    );
    expect(plan.yours).toEqual({ household: HOUSEHOLD, groups: [GROUP] });
  });

  it("events with rows alone is a single card", () => {
    const plan = composeMainRow(
      input({ events: { ok: true, value: { kind: "ok", data: [EVENT] } } }),
    );
    expect(plan.layout).toBe("single");
    expect(plan.yours).toBeNull();
    expect(plan.upcoming).toEqual({ kind: "events", events: [EVENT] });
  });

  it("ok with zero rows is the empty state, and still a card", () => {
    const plan = composeMainRow(
      input({ events: { ok: true, value: { kind: "ok", data: [] } } }),
    );
    expect(plan.upcoming).toEqual({ kind: "empty" });
    expect(plan.layout).toBe("single");
  });

  it("a failed events read shows the failure card", () => {
    const plan = composeMainRow(input({ events: { ok: false } }));
    expect(plan.upcoming).toEqual({ kind: "failed" });
    expect(plan.layout).toBe("single");
  });

  it.each(["disabled", "forbidden"] as const)(
    "%s hides the events card even when Yours exists",
    (kind) => {
      const plan = composeMainRow(
        input({
          household: HOUSEHOLD,
          events: { ok: true, value: { kind } },
        }),
      );
      expect(plan.upcoming).toBeNull();
      expect(plan.yours).not.toBeNull();
    },
  );

  it("groups [] with a household (groups failed upstream) keeps Yours", () => {
    const plan = composeMainRow(input({ household: HOUSEHOLD, groups: [] }));
    expect(plan.yours).toEqual({ household: HOUSEHOLD, groups: [] });
  });

  it("groups [] with no household omits Yours", () => {
    expect(composeMainRow(input()).yours).toBeNull();
  });

  it("everything present is a double row, Yours first", () => {
    const plan = composeMainRow({
      household: HOUSEHOLD,
      groups: [GROUP],
      events: { ok: true, value: { kind: "ok", data: [EVENT] } },
    });
    expect(plan.layout).toBe("double");
    expect(plan.yours).not.toBeNull();
    expect(plan.upcoming).toEqual({ kind: "events", events: [EVENT] });
  });

  it("does not re-apply household suppression (that rule lives in getPortalHomeData)", () => {
    const solo = { id: "h2", name: "Solo", memberCount: 1 };
    expect(composeMainRow(input({ household: solo })).yours?.household).toBe(
      solo,
    );
  });

  it("does not mutate a deep-frozen input", () => {
    const frozen = deepFreeze({
      household: { ...HOUSEHOLD },
      groups: [{ ...GROUP }],
      events: {
        ok: true as const,
        value: { kind: "ok" as const, data: [{ ...EVENT }] },
      },
    });
    expect(() => composeMainRow(frozen)).not.toThrow();
  });

  it("lists four upcoming events", () => {
    expect(UPCOMING_EVENTS_LIMIT).toBe(4);
  });
});
