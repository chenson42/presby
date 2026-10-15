import { describe, expect, it } from "vitest";
import { eventTypeFormSchema } from "./event-type-schema";

const base = { name: "Choir rehearsal", color: "teal", icon: "Music" };

describe("eventTypeFormSchema", () => {
  it("accepts a valid type", () => {
    expect(eventTypeFormSchema.safeParse(base).success).toBe(true);
  });

  it("trims the name", () => {
    const result = eventTypeFormSchema.safeParse({ ...base, name: "  Choir  " });
    expect(result.success && result.data.name).toBe("Choir");
  });

  it("rejects an empty or whitespace name with 'Name is required'", () => {
    for (const name of ["", "   "]) {
      const result = eventTypeFormSchema.safeParse({ ...base, name });
      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0].message).toBe("Name is required");
    }
  });

  it("allows exactly 60 characters and rejects 61", () => {
    expect(eventTypeFormSchema.safeParse({ ...base, name: "x".repeat(60) }).success).toBe(true);
    const result = eventTypeFormSchema.safeParse({ ...base, name: "x".repeat(61) });
    expect(!result.success && result.error.issues[0].message).toBe("Use 60 characters or fewer");
  });

  it("rejects a colour outside the closed palette", () => {
    const result = eventTypeFormSchema.safeParse({ ...base, color: "chartreuse" });
    expect(!result.success && result.error.issues[0].message).toBe("Choose a color.");
  });

  it("accepts neutral (the default type's colour; the server refuses it on create)", () => {
    expect(eventTypeFormSchema.safeParse({ ...base, color: "neutral" }).success).toBe(true);
  });

  it("rejects an icon outside the closed vocabulary", () => {
    const result = eventTypeFormSchema.safeParse({ ...base, icon: "Skull" });
    expect(!result.success && result.error.issues[0].message).toBe("Choose an icon.");
  });
});
