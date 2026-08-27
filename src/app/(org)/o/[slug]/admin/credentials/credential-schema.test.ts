/**
 * Unit tests for the credentials admin surface's client-side zod schemas —
 * presbytery-functionality Increment 2. Neither schema is the only gate
 * (see the file's own header) — these tests pin the client-side block-early
 * behavior only; server-side re-validation is proven in
 * `src/lib/credentials.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  recordAppointmentSchema,
  recordOrdinationSchema,
} from "./credential-schema";

describe("recordOrdinationSchema", () => {
  it("accepts a well-formed submission", () => {
    const result = recordOrdinationSchema.safeParse({
      personId: "person-1",
      ministry: "ruling_elder",
      ordainedOn: "2026-01-01",
      minuteReference: "Presbytery minutes, 1 Jan 2026",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty personId", () => {
    const result = recordOrdinationSchema.safeParse({
      personId: "",
      ministry: "ruling_elder",
      ordainedOn: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty ordainedOn", () => {
    const result = recordOrdinationSchema.safeParse({
      personId: "person-1",
      ministry: "ruling_elder",
      ordainedOn: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a minuteReference over the length limit", () => {
    const result = recordOrdinationSchema.safeParse({
      personId: "person-1",
      ministry: "ruling_elder",
      ordainedOn: "2026-01-01",
      minuteReference: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized ministry", () => {
    const result = recordOrdinationSchema.safeParse({
      personId: "person-1",
      ministry: "bishop",
      ordainedOn: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });
});

describe("recordAppointmentSchema", () => {
  it("accepts a well-formed submission", () => {
    const result = recordAppointmentSchema.safeParse({
      personId: "person-1",
      servingOrgId: "cong-1",
      callType: "installed_pastor",
      startsOn: "2026-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty servingOrgId", () => {
    const result = recordAppointmentSchema.safeParse({
      personId: "person-1",
      servingOrgId: "",
      callType: "installed_pastor",
      startsOn: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized callType", () => {
    const result = recordAppointmentSchema.safeParse({
      personId: "person-1",
      servingOrgId: "cong-1",
      callType: "supply_pastor",
      startsOn: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a minuteReference over the length limit", () => {
    const result = recordAppointmentSchema.safeParse({
      personId: "person-1",
      servingOrgId: "cong-1",
      callType: "installed_pastor",
      startsOn: "2026-01-01",
      minuteReference: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});
