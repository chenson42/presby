import { describe, expect, it } from "vitest";
import {
  GUEST_NAME_CONTACT_MESSAGE,
  GUEST_NAME_REQUIRED_MESSAGE,
  GUEST_NAME_TOO_LONG_MESSAGE,
  validateGuestName,
} from "./guest-name";

describe("validateGuestName", () => {
  it("accepts a plain name and trims it", () => {
    expect(validateGuestName("  Rev. Tamsin Holloway  ")).toEqual({ ok: true, name: "Rev. Tamsin Holloway" });
    expect(validateGuestName("Zoë Ñandú")).toEqual({ ok: true, name: "Zoë Ñandú" });
  });

  it("refuses empty, blank and non-string input", () => {
    for (const bad of ["", "   ", undefined, null, 5, {}]) {
      expect(validateGuestName(bad), String(bad)).toEqual({ ok: false, message: GUEST_NAME_REQUIRED_MESSAGE });
    }
  });

  it("allows exactly 80 characters and refuses 81", () => {
    expect(validateGuestName("a".repeat(80)).ok).toBe(true);
    expect(validateGuestName("a".repeat(81))).toEqual({ ok: false, message: GUEST_NAME_TOO_LONG_MESSAGE });
  });

  it("refuses an @ (an email address)", () => {
    expect(validateGuestName("pat@example.invalid")).toEqual({ ok: false, message: GUEST_NAME_CONTACT_MESSAGE });
  });

  it("refuses seven or more digits however they are written, allows six", () => {
    for (const bad of ["Pat 555 0100 123", "Pat (555) 0142", "5550142", "call 5-5-5-0-1-4-2"]) {
      expect(validateGuestName(bad), bad).toEqual({ ok: false, message: GUEST_NAME_CONTACT_MESSAGE });
    }
    expect(validateGuestName("Choir 123456").ok).toBe(true);
  });

  it("refuses a line break or any control character", () => {
    for (const bad of ["Pat\nHolloway", "Pat\r\nHolloway", "Pat\tHolloway", "Pat\u0000Holloway"]) {
      expect(validateGuestName(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the refusal sentence is the Copy G5 hint", () => {
    expect(GUEST_NAME_CONTACT_MESSAGE).toBe("Enter just a name. Contact details aren't kept here.");
  });
});
