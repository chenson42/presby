import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HANDLED_EVENT_TYPES, isHandledEventType, STRIPE_API_VERSION } from "./constants";

describe("the handled event list", () => {
  it("is the eighteen types the runbook subscribes the endpoint to", () => {
    expect(HANDLED_EVENT_TYPES).toHaveLength(18);
    expect(new Set(HANDLED_EVENT_TYPES).size).toBe(18);
  });

  it("matches docs/deployment.md exactly (the runbook is what the operator pastes from)", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/deployment.md"), "utf8");
    for (const type of HANDLED_EVENT_TYPES) {
      expect(doc, `docs/deployment.md must list ${type}`).toContain(`\`${type}\``);
    }
    expect(doc).toContain(STRIPE_API_VERSION);
  });

  it("the runbook's endpoint list names no event type the code does not handle (the operator pastes the list, so extras would be dropped silently)", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/deployment.md"), "utf8");
    const start = doc.indexOf("**Events — exactly these");
    const end = doc.indexOf("Any other type is acknowledged", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const listed = [...doc.slice(start, end).matchAll(/`([a-z_]+(?:\.[a-z_]+)+)`/g)].map((m) => m[1]!);
    expect([...listed].sort()).toEqual([...HANDLED_EVENT_TYPES].sort());
  });

  it("isHandledEventType is an exact match", () => {
    expect(isHandledEventType("charge.succeeded")).toBe(true);
    expect(isHandledEventType("charge.succeeded.extra")).toBe(false);
    expect(isHandledEventType("CHARGE.SUCCEEDED")).toBe(false);
    expect(isHandledEventType("customer.created")).toBe(false);
    expect(isHandledEventType("")).toBe(false);
  });
});
