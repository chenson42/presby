import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HANDLED_EVENT_TYPES, isHandledEventType, STRIPE_API_VERSION } from "./constants";

describe("the handled event list", () => {
  it("is the sixteen types the runbook subscribes the endpoint to", () => {
    expect(HANDLED_EVENT_TYPES).toHaveLength(16);
    expect(new Set(HANDLED_EVENT_TYPES).size).toBe(16);
  });

  it("matches docs/deployment.md exactly (the runbook is what the operator pastes from)", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/deployment.md"), "utf8");
    for (const type of HANDLED_EVENT_TYPES) {
      expect(doc, `docs/deployment.md must list ${type}`).toContain(`\`${type}\``);
    }
    expect(doc).toContain(STRIPE_API_VERSION);
  });

  it("isHandledEventType is an exact match", () => {
    expect(isHandledEventType("charge.succeeded")).toBe(true);
    expect(isHandledEventType("charge.succeeded.extra")).toBe(false);
    expect(isHandledEventType("CHARGE.SUCCEEDED")).toBe(false);
    expect(isHandledEventType("customer.created")).toBe(false);
    expect(isHandledEventType("")).toBe(false);
  });
});
