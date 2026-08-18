import { describe, it, expect } from "vitest";
import { sanitizeCallbackUrl } from "./safe-callback";

describe("sanitizeCallbackUrl", () => {
  it("passes through a valid relative path", () => {
    expect(sanitizeCallbackUrl("/foo")).toBe("/foo");
  });

  it("passes through a nested valid relative path", () => {
    expect(sanitizeCallbackUrl("/admin/users")).toBe("/admin/users");
  });

  it("passes through an org path untouched — it knows nothing about slugs", () => {
    // Deliberate: this function is a pure string check. Whether the user can
    // enter /o/alder-creek is computeDestination's question, and the gate is
    // the independent resolve at /o/<slug>.
    expect(sanitizeCallbackUrl("/o/alder-creek")).toBe("/o/alder-creek");
  });

  it("rejects a protocol-relative URL (//evil.com) and returns /launch", () => {
    expect(sanitizeCallbackUrl("//evil.com")).toBe("/launch");
  });

  it("rejects an absolute http URL and returns /launch", () => {
    expect(sanitizeCallbackUrl("https://evil.com/steal")).toBe("/launch");
  });

  it("rejects a non-slash-prefixed string and returns /launch", () => {
    expect(sanitizeCallbackUrl("evil.com/steal")).toBe("/launch");
  });

  it("rejects a javascript: URI and returns /launch", () => {
    expect(sanitizeCallbackUrl("javascript:alert(1)")).toBe("/launch");
  });

  it("rejects a data: URI and returns /launch", () => {
    expect(sanitizeCallbackUrl("data:text/html,<script>alert(1)</script>")).toBe(
      "/launch",
    );
  });

  it("returns /launch for null", () => {
    expect(sanitizeCallbackUrl(null)).toBe("/launch");
  });

  it("returns /launch for undefined", () => {
    expect(sanitizeCallbackUrl(undefined)).toBe("/launch");
  });

  it("returns /launch for an empty string", () => {
    expect(sanitizeCallbackUrl("")).toBe("/launch");
  });
});
