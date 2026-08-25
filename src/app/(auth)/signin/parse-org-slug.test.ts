import { describe, it, expect } from "vitest";
import { parseOrgSlugFromCallbackUrl } from "./parse-org-slug";

describe("parseOrgSlugFromCallbackUrl", () => {
  it("extracts the slug from a bare /o/<slug> path", () => {
    expect(parseOrgSlugFromCallbackUrl("/o/alder-creek")).toBe("alder-creek");
  });

  it("extracts the slug from a nested /o/<slug>/... path", () => {
    expect(parseOrgSlugFromCallbackUrl("/o/alder-creek/directory")).toBe(
      "alder-creek",
    );
    expect(
      parseOrgSlugFromCallbackUrl("/o/alder-creek/admin/roles"),
    ).toBe("alder-creek");
  });

  it("returns null for a bare /o with no slug", () => {
    expect(parseOrgSlugFromCallbackUrl("/o")).toBeNull();
    expect(parseOrgSlugFromCallbackUrl("/o/")).toBeNull();
  });

  it("returns null for a non-org callbackUrl", () => {
    expect(parseOrgSlugFromCallbackUrl("/admin")).toBeNull();
    expect(parseOrgSlugFromCallbackUrl("/orgs")).toBeNull();
    expect(parseOrgSlugFromCallbackUrl("/home")).toBeNull();
  });

  it("returns null for /launch, the sanitize fallback", () => {
    expect(parseOrgSlugFromCallbackUrl("/launch")).toBeNull();
  });

  it("returns null for a slug shape the DNS-label CHECK would reject (weird charset)", () => {
    expect(parseOrgSlugFromCallbackUrl("/o/Alder_Creek!")).toBeNull();
    expect(parseOrgSlugFromCallbackUrl("/o/UPPERCASE")).toBeNull();
    expect(parseOrgSlugFromCallbackUrl("/o/has space")).toBeNull();
  });

  it("returns null for a path that merely contains /o/ mid-string, not at the start", () => {
    expect(parseOrgSlugFromCallbackUrl("/not-o/alder-creek")).toBeNull();
  });

  it("does not match a path only resembling /o (no trailing slash or end)", () => {
    expect(parseOrgSlugFromCallbackUrl("/organizations")).toBeNull();
  });

  it("matches a single-character slug (the format's own minimum)", () => {
    expect(parseOrgSlugFromCallbackUrl("/o/a")).toBe("a");
  });

  it("matches a slug containing internal hyphens and digits", () => {
    expect(parseOrgSlugFromCallbackUrl("/o/first-pres-123/tickets/42")).toBe(
      "first-pres-123",
    );
  });
});
