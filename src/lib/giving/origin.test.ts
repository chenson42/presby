import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { givingOrigin } from "./origin";

function env(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) vi.stubEnv(key, undefined as unknown as string);
    else vi.stubEnv(key, value);
  }
}

describe("givingOrigin", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("returns the bare origin of NEXT_PUBLIC_APP_URL, dropping any path and trailing slash", () => {
    env({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://www.example.invalid/some/path/" });
    expect(givingOrigin()).toBe("https://www.example.invalid");
  });

  it("keeps a non-default port", () => {
    env({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://app.example.invalid:8443" });
    expect(givingOrigin()).toBe("https://app.example.invalid:8443");
  });

  it("in production, an unset value is null (giving is unavailable, not guessed)", () => {
    env({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "" });
    expect(givingOrigin()).toBeNull();
    env({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "   " });
    expect(givingOrigin()).toBeNull();
  });

  it("in production, http is refused", () => {
    env({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://www.example.invalid" });
    expect(givingOrigin()).toBeNull();
  });

  it.each([
    "not a url",
    "javascript:alert(1)",
    "ftp://example.invalid",
    "https://user:pw@example.invalid",
    "https://user@example.invalid",
    "//example.invalid",
    "example.invalid",
  ])("refuses %j", (value) => {
    env({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: value });
    expect(givingOrigin()).toBeNull();
  });

  it("outside production an unset value falls back to localhost and http is allowed", () => {
    env({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "" });
    expect(givingOrigin()).toBe("http://localhost:3000");
    env({ NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "http://localhost:3100" });
    expect(givingOrigin()).toBe("http://localhost:3100");
  });

  it("never reads a request header: it takes no arguments", () => {
    expect(givingOrigin.length).toBe(0);
  });
});
