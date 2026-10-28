import { describe, expect, it } from "vitest";
import { PRIVACY_CONTACT_ENV, readPrivacyContactEmail } from "./env";

const withValue = (value: string | undefined) => ({ [PRIVACY_CONTACT_ENV]: value });

describe("readPrivacyContactEmail", () => {
  it("names the variable the deployment docs name", () => {
    expect(PRIVACY_CONTACT_ENV).toBe("HELP_PRIVACY_CONTACT_EMAIL");
  });

  it("is null when the variable is unset, empty or blank", () => {
    expect(readPrivacyContactEmail({})).toBeNull();
    expect(readPrivacyContactEmail(withValue(undefined))).toBeNull();
    expect(readPrivacyContactEmail(withValue(""))).toBeNull();
    expect(readPrivacyContactEmail(withValue("   "))).toBeNull();
  });

  it("returns one plain address, trimmed", () => {
    expect(readPrivacyContactEmail(withValue("privacy@example.invalid"))).toBe("privacy@example.invalid");
    expect(readPrivacyContactEmail(withValue("  a.b+c_d@mail.example.invalid \n"))).toBe("a.b+c_d@mail.example.invalid");
  });

  it("throws, naming the variable but not echoing the value, on anything that is not one plain address", () => {
    for (const bad of [
      "not-an-address",
      "two@example.invalid, three@example.invalid",
      "Name <who@example.invalid>",
      "who@example.invalid](https://x.invalid)",
      "who@example.invalid)",
      "who@localhost",
      "who @example.invalid",
    ]) {
      let message = "";
      try {
        readPrivacyContactEmail(withValue(bad));
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, bad).toContain(PRIVACY_CONTACT_ENV);
      expect(message, bad).not.toContain(bad);
    }
  });
});
