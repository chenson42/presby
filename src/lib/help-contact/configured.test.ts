import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_DUMMY_SECRET_KEYS,
  CLOUDFLARE_DUMMY_SITE_KEYS,
  isHelpContactConfigured,
} from "./configured";

const dev = { TURNSTILE_SECRET_KEY: "dev-secret", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "dev-site" };
const prod = {
  VERCEL_ENV: "production",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-secret-placeholder",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA-real-site-placeholder",
  UPSTASH_REDIS_REST_URL: "https://upstash.example.invalid",
  UPSTASH_REDIS_REST_TOKEN: "token-placeholder",
};

describe("isHelpContactConfigured (CA6, DECISION-303)", () => {
  it("is false with nothing set, and with either Turnstile key missing or blank, everywhere", () => {
    expect(isHelpContactConfigured({})).toBe(false);
    expect(isHelpContactConfigured({ TURNSTILE_SECRET_KEY: "s" })).toBe(false);
    expect(isHelpContactConfigured({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" })).toBe(false);
    expect(isHelpContactConfigured({ ...dev, TURNSTILE_SECRET_KEY: "  " })).toBe(false);
    expect(isHelpContactConfigured({ ...dev, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" })).toBe(false);
    expect(isHelpContactConfigured({ ...prod, TURNSTILE_SECRET_KEY: undefined })).toBe(false);
  });

  it("outside production the Turnstile pair is enough (no Upstash needed)", () => {
    expect(isHelpContactConfigured(dev)).toBe(true);
    expect(isHelpContactConfigured({ ...dev, VERCEL_ENV: "preview" })).toBe(true);
    expect(isHelpContactConfigured({ ...dev, NODE_ENV: "production" })).toBe(true); // a prod BUILD on localhost
  });

  it("outside production the limiter may be off, and Cloudflare's test keys are the point", () => {
    expect(isHelpContactConfigured({ ...dev, RATE_LIMIT_DISABLED: "true" })).toBe(true);
    expect(
      isHelpContactConfigured({
        TURNSTILE_SECRET_KEY: CLOUDFLARE_DUMMY_SECRET_KEYS[0],
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: CLOUDFLARE_DUMMY_SITE_KEYS[0],
      }),
    ).toBe(true);
  });

  it("in a production deployment a full, real configuration is configured", () => {
    expect(isHelpContactConfigured(prod)).toBe(true);
  });

  it("in a production deployment both Upstash variables are required", () => {
    expect(isHelpContactConfigured({ ...prod, UPSTASH_REDIS_REST_URL: undefined })).toBe(false);
    expect(isHelpContactConfigured({ ...prod, UPSTASH_REDIS_REST_TOKEN: "" })).toBe(false);
  });

  it("in a production deployment the limiter may not be switched off", () => {
    expect(isHelpContactConfigured({ ...prod, RATE_LIMIT_DISABLED: "true" })).toBe(false);
    expect(isHelpContactConfigured({ ...prod, RATE_LIMIT_DISABLED: "false" })).toBe(true);
  });

  it("in a production deployment each Cloudflare dummy key is refused", () => {
    for (const secret of CLOUDFLARE_DUMMY_SECRET_KEYS) {
      expect(isHelpContactConfigured({ ...prod, TURNSTILE_SECRET_KEY: secret }), secret).toBe(false);
    }
    for (const siteKey of CLOUDFLARE_DUMMY_SITE_KEYS) {
      expect(isHelpContactConfigured({ ...prod, NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey }), siteKey).toBe(false);
    }
  });

  it("holds Cloudflare's eight published dummy values", () => {
    expect([...CLOUDFLARE_DUMMY_SECRET_KEYS, ...CLOUDFLARE_DUMMY_SITE_KEYS]).toHaveLength(8);
  });
});
