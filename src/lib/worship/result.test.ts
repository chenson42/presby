import { describe, expect, it } from "vitest";
// Enter the domain cycle through the canonical entry point first (worship.schema.test.ts).
import "@/lib/db/schema";
import { WORSHIP_GUARD_CODES } from "@/lib/db/domain/worship";
import { ACTION_COPY } from "./copy";
import { conflict, forbidden, invalid, mapDatabaseError, notFound, ok, pgField } from "./result";

const pgError = (fields: Record<string, string>) => Object.assign(new Error("db"), fields);
const wrapped = (inner: unknown) => Object.assign(new Error("Failed query"), { cause: inner });

describe("pgField", () => {
  it("reads a field from the error or from anything in its cause chain", () => {
    expect(pgField(pgError({ code: "23514" }), "code")).toBe("23514");
    expect(pgField(wrapped(wrapped(pgError({ constraint: "x" }))), "constraint")).toBe("x");
    expect(pgField(new Error("plain"), "code")).toBeUndefined();
    expect(pgField(null, "code")).toBeUndefined();
  });
});

describe("mapDatabaseError", () => {
  it("maps every guard code in the migration's list to a result (none falls through to a rethrow)", () => {
    for (const code of WORSHIP_GUARD_CODES) {
      const mapped = mapDatabaseError(wrapped(pgError({ code: "23514", constraint: code })));
      expect(mapped, code).not.toBeNull();
    }
  });

  it("a cancelled or started service reads as 'not open' with the Copy sentences", () => {
    expect(mapDatabaseError(pgError({ constraint: "worship_guard_service_cancelled" }))).toEqual(
      conflict("not_open", ACTION_COPY.serviceCancelled),
    );
    expect(mapDatabaseError(pgError({ constraint: "worship_guard_service_started" }))).toEqual(
      conflict("not_open", ACTION_COPY.serviceStarted),
    );
  });

  it("an authority refusal is forbidden", () => {
    expect(mapDatabaseError(pgError({ constraint: "worship_guard_not_authorized" }))).toEqual(forbidden());
  });

  it("the blockout guards map to the blockout sentences", () => {
    expect(mapDatabaseError(pgError({ constraint: "worship_guard_blockout_past" }))).toMatchObject({ kind: "invalid_input" });
    expect(mapDatabaseError(pgError({ constraint: "worship_guard_blockout_cap" }))).toMatchObject({ kind: "conflict", reason: "over_cap" });
  });

  it("a unique or foreign-key violation that no guard pre-empted reads as a changed page", () => {
    expect(mapDatabaseError(pgError({ code: "23505", constraint: "something_else" }))).toEqual(conflict("not_open", ACTION_COPY.stale));
    expect(mapDatabaseError(pgError({ code: "23503", constraint: "something_else" }))).toEqual(conflict("not_open", ACTION_COPY.stale));
    expect(mapDatabaseError(pgError({ constraint: "worship_positions_live_name_idx" }))).toMatchObject({ reason: "duplicate_name" });
  });

  it("an error that is not ours is null (the caller rethrows)", () => {
    expect(mapDatabaseError(new Error("connection reset"))).toBeNull();
    expect(mapDatabaseError(pgError({ code: "08006" }))).toBeNull();
  });
});

describe("constructors", () => {
  it("build the documented shapes", () => {
    expect(ok(1)).toEqual({ kind: "ok", data: 1 });
    expect(notFound()).toEqual({ kind: "not_found" });
    expect(invalid("m")).toEqual({ kind: "invalid_input", message: "m" });
    expect(conflict("in_use", "m")).toEqual({ kind: "conflict", reason: "in_use", message: "m" });
  });
});
