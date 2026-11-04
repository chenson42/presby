import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// `@/lib/audit` reaches next-auth, which this environment cannot resolve; the
// pure validators under test never touch it.
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: { EVENT_LISTED_ON_WEBSITE: "event.listed_on_website" } }));
vi.mock("@/lib/audit-tx", () => ({ insertAuditRow: vi.fn() }));
// The table objects are only handed to a stubbed transaction here; importing the
// real domain module would load the whole schema graph for nothing.
vi.mock("@/lib/db/domain/events", () => ({ events: {}, eventTypes: {} }));

import type { OrgTx } from "@/lib/authz";
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  SWITCH_INVALID,
  TITLE_MAX,
  eventTypeUsable,
  insertEventsInTx,
  switchesAreBooleans,
  validateFieldLengths,
} from "./insert";

describe("events/insert.ts validators (moved from events.ts, behaviour unchanged)", () => {
  it("validateFieldLengths: requires a non-blank title and enforces each limit", () => {
    expect(validateFieldLengths({ title: "Sunday worship" })).toBeNull();
    expect(validateFieldLengths({ title: "   " })).toBe("Title is required.");
    expect(validateFieldLengths({ title: "t".repeat(TITLE_MAX + 1) })).toBe(
      `Title must be ${TITLE_MAX} characters or fewer.`,
    );
    expect(validateFieldLengths({ title: "t", description: "d".repeat(DESCRIPTION_MAX + 1) })).toBe(
      `Description must be ${DESCRIPTION_MAX} characters or fewer.`,
    );
    expect(validateFieldLengths({ title: "t", location: "l".repeat(LOCATION_MAX + 1) })).toBe(
      `Location must be ${LOCATION_MAX} characters or fewer.`,
    );
    expect(
      validateFieldLengths({
        title: "t".repeat(TITLE_MAX),
        description: "d".repeat(DESCRIPTION_MAX),
        location: "l".repeat(LOCATION_MAX),
      }),
    ).toBeNull();
  });

  it("switchesAreBooleans: only real booleans pass (a server action is a public entry point)", () => {
    expect(switchesAreBooleans({ isPublic: true, websiteListed: false })).toBe(true);
    expect(switchesAreBooleans({ isPublic: "true", websiteListed: false })).toBe(false);
    expect(switchesAreBooleans({ isPublic: true, websiteListed: undefined })).toBe(false);
  });

  it("eventTypeUsable: a garbage id never reaches the database", async () => {
    const tx = {
      select: () => {
        throw new Error("must not query");
      },
    } as unknown as OrgTx;
    await expect(eventTypeUsable(tx, "org", "not-a-uuid", null)).resolves.toBe(false);
  });

  it("insertEventsInTx: refuses non-boolean switches, a blank title and an end before the start before any write", async () => {
    const tx = {
      insert: () => {
        throw new Error("must not write");
      },
    } as unknown as OrgTx;
    const actor = { userId: "u", email: null };
    const base = {
      title: "Sunday worship",
      startsAt: "2026-11-15T09:00",
      isPublic: true,
      websiteListed: false,
      allowsCheckin: false,
    };

    const badSwitch = await insertEventsInTx(tx, "org", actor, {
      ...base,
      isPublic: "yes" as unknown as boolean,
    });
    expect(badSwitch).toEqual({ kind: "invalid_input", message: SWITCH_INVALID });

    const blank = await insertEventsInTx(tx, "org", actor, { ...base, title: " " });
    expect(blank).toEqual({ kind: "invalid_input", message: "Title is required." });

    const backwards = await insertEventsInTx(tx, "org", actor, {
      ...base,
      endsAt: "2026-11-15T08:00",
    });
    expect(backwards).toEqual({
      kind: "invalid_input",
      message: "The end time can't be before the start time.",
    });

    const tooMany = await insertEventsInTx(tx, "org", actor, {
      ...base,
      recurrence: { pattern: "weekly", count: 10_000 },
    });
    expect(tooMany.kind).toBe("invalid_input");
  });
});
