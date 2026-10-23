/**
 * Characterization tests for `eventTypeFormSchema`, written on zod 3.25.76
 * before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests"
 * 1).
 */
import { describe, expect, it } from "vitest";
import { EVENT_TYPE_COLORS, EVENT_TYPE_ICONS } from "@/lib/events/type-palette";
import { resolveForm } from "@/lib/testing/zod-golden";
import { eventTypeFormSchema } from "./event-type-schema";

const valid = { name: "Potluck", color: EVENT_TYPE_COLORS[0], icon: EVENT_TYPE_ICONS[0] };

describe("eventTypeFormSchema", () => {
  it("returns a valid value unchanged and trims the name", async () => {
    expect(await resolveForm(eventTypeFormSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
    expect((await resolveForm(eventTypeFormSchema, { ...valid, name: "  Potluck " })).values).toEqual(valid);
  });

  it("accepts a 60-character name", async () => {
    expect((await resolveForm(eventTypeFormSchema, { ...valid, name: "n".repeat(60) })).failed).toBe(false);
  });

  it("pins the messages", async () => {
    expect((await resolveForm(eventTypeFormSchema, { ...valid, name: "   " })).errors).toEqual({ name: "Name is required" });
    expect((await resolveForm(eventTypeFormSchema, { ...valid, name: "n".repeat(61) })).errors).toEqual({
      name: "Use 60 characters or fewer",
    });
    expect((await resolveForm(eventTypeFormSchema, { ...valid, color: "chartreuse" })).errors).toEqual({
      color: "Choose a color.",
    });
    expect((await resolveForm(eventTypeFormSchema, { ...valid, color: "" })).errors).toEqual({ color: "Choose a color." });
    expect((await resolveForm(eventTypeFormSchema, { ...valid, icon: "skull" })).errors).toEqual({ icon: "Choose an icon." });
    expect((await resolveForm(eventTypeFormSchema, { ...valid, icon: "" })).errors).toEqual({ icon: "Choose an icon." });
  });

  it("reports every failure together", async () => {
    expect((await resolveForm(eventTypeFormSchema, { name: "", color: "x", icon: "y" })).errors).toEqual({
      name: "Name is required",
      color: "Choose a color.",
      icon: "Choose an icon.",
    });
  });
});
