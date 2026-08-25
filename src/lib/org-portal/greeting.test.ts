import { describe, expect, it } from "vitest";
import { timeOfDayGreeting } from "./greeting";

describe("timeOfDayGreeting() — hour-boundary logic", () => {
  it("says good morning from 5:00 up to (not including) 12:00", () => {
    expect(timeOfDayGreeting(5)).toBe("Good morning");
    expect(timeOfDayGreeting(9)).toBe("Good morning");
    expect(timeOfDayGreeting(11)).toBe("Good morning");
  });

  it("says good afternoon from 12:00 up to (not including) 17:00", () => {
    expect(timeOfDayGreeting(12)).toBe("Good afternoon");
    expect(timeOfDayGreeting(14)).toBe("Good afternoon");
    expect(timeOfDayGreeting(16)).toBe("Good afternoon");
  });

  it("says good evening from 17:00 through midnight, and before 5:00", () => {
    expect(timeOfDayGreeting(17)).toBe("Good evening");
    expect(timeOfDayGreeting(20)).toBe("Good evening");
    expect(timeOfDayGreeting(23)).toBe("Good evening");
    expect(timeOfDayGreeting(0)).toBe("Good evening");
    expect(timeOfDayGreeting(4)).toBe("Good evening");
  });
});
