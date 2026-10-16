import { describe, expect, it } from "vitest";
import { ProviderError } from "./errors";
import {
  assertStripeUrl,
  CHECKOUT_HOSTS,
  isAllowedStripeUrl,
  isCheckoutUrl,
  isOnboardingUrl,
  ONBOARDING_HOSTS,
} from "./urls";

describe("origin assertions - checkout.stripe.com", () => {
  it("accepts the real shapes", () => {
    expect(isCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fidkdWxOYHwnPyd1")).toBe(true);
    expect(isCheckoutUrl("https://checkout.stripe.com/")).toBe(true);
    expect(isCheckoutUrl("https://CHECKOUT.STRIPE.COM/c/pay/x")).toBe(true); // hostnames are case-insensitive
  });

  it.each([
    ["a look-alike suffix", "https://checkout.stripe.com.evil.example/c/pay/x"],
    ["a look-alike prefix", "https://evilcheckout.stripe.com/c/pay/x"],
    ["a hyphenated look-alike", "https://checkout-stripe.com/c/pay/x"],
    ["a sibling subdomain", "https://js.stripe.com/v3"],
    ["the apex", "https://stripe.com/"],
    ["a trailing-dot hostname", "https://checkout.stripe.com./c/pay/x"],
    ["userinfo naming Stripe", "https://checkout.stripe.com@evil.example/c/pay/x"], // leak-ok: hostile userinfo URL test input, not an email
    ["userinfo naming the attacker", "https://evil.example@checkout.stripe.com/c/pay/x"], // leak-ok: hostile userinfo URL test input, not an email
    ["userinfo with a password", "https://user:pass@checkout.stripe.com/"],
    ["an explicit port", "https://checkout.stripe.com:8443/c/pay/x"],
    ["an explicit default port", "https://checkout.stripe.com:443/c/pay/x"],
    ["plain http", "http://checkout.stripe.com/c/pay/x"],
    ["a protocol-relative URL", "//checkout.stripe.com/c/pay/x"],
    ["a javascript: URL", "javascript:alert(1)//checkout.stripe.com"],
    ["a data: URL", "data:text/html,checkout.stripe.com"],
    ["a backslash authority trick", "https://evil.example\\@checkout.stripe.com/"],
    ["a backslash path trick", "https://evil.example\\.checkout.stripe.com/"],
    ["an embedded newline", "https://checkout.stripe.com\n.evil.example/"],
    ["an embedded tab", "https://checkout.stripe.com\t/c/pay"],
    ["leading whitespace", " https://checkout.stripe.com/c/pay/x"],
    ["a unicode look-alike", "https://checkout.strıpe.com/c/pay/x"],
    ["an empty string", ""],
    ["a relative path", "/c/pay/x"],
  ])("rejects %s", (_label, url) => {
    expect(isCheckoutUrl(url)).toBe(false);
    expect(() => assertStripeUrl(url, CHECKOUT_HOSTS)).toThrow(ProviderError);
  });

  it.each([null, undefined, 42, {}, ["https://checkout.stripe.com/"]])("rejects the non-string %j", (value) => {
    expect(isAllowedStripeUrl(value, CHECKOUT_HOSTS)).toBe(false);
  });

  it("rejects an absurdly long URL", () => {
    expect(isCheckoutUrl(`https://checkout.stripe.com/${"a".repeat(5000)}`)).toBe(false);
  });

  it("does not accept an ONBOARDING host as a checkout host", () => {
    expect(isCheckoutUrl("https://accounts.stripe.com/r/acct_x")).toBe(false);
    expect(isCheckoutUrl("https://connect.stripe.com/setup/c/x")).toBe(false);
  });

  it("assertStripeUrl throws a ProviderError carrying the bad_origin code and no URL in the message", () => {
    try {
      assertStripeUrl("https://evil.example/secret-path-xyz", CHECKOUT_HOSTS);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("bad_origin");
      expect((err as Error).message).not.toContain("evil.example");
      expect((err as Error).message).not.toContain("secret-path-xyz");
    }
  });

  it("returns the normalized href on success", () => {
    expect(assertStripeUrl("https://checkout.stripe.com/c/pay/x?y=1", CHECKOUT_HOSTS)).toBe(
      "https://checkout.stripe.com/c/pay/x?y=1",
    );
  });
});

describe("origin assertions - accounts.stripe.com / connect.stripe.com (P3-10)", () => {
  it("accepts exactly the two onboarding hosts", () => {
    expect(ONBOARDING_HOSTS).toEqual(["accounts.stripe.com", "connect.stripe.com"]);
    expect(isOnboardingUrl("https://accounts.stripe.com/r/acct_x12345678")).toBe(true);
    expect(isOnboardingUrl("https://connect.stripe.com/setup/c/acct_x/abc")).toBe(true);
  });

  it.each([
    "https://accounts.stripe.com.evil.example/r/x",
    "https://connect.stripe.com.evil.example/setup/x",
    "https://evil-connect.stripe.com/setup/x",
    "https://dashboard.stripe.com/",
    "https://checkout.stripe.com/c/pay/x",
    "https://accounts.stripe.com@evil.example/r/x", // leak-ok: hostile userinfo URL test input, not an email
    "https://connect.stripe.com:444/setup/x",
    "http://connect.stripe.com/setup/x",
    "https://connect.stripe.com\\@evil.example/",
  ])("rejects %s", (url) => {
    expect(isOnboardingUrl(url)).toBe(false);
  });
});
