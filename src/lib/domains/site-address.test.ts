import { describe, expect, it } from "vitest";
import { platformSiteAddress } from "./site-address";

describe("platformSiteAddress", () => {
  it("is the platform origin's host plus the slug path, with no scheme", () => {
    expect(platformSiteAddress("alder-creek", { NEXT_PUBLIC_APP_URL: "https://presbyportal.invalid" })).toBe(
      "presbyportal.invalid/site/alder-creek",
    );
  });

  it("keeps a dev port, and never reads a request: only the env origin", () => {
    expect(platformSiteAddress("alder-creek", { NEXT_PUBLIC_APP_URL: "http://localhost:3111" })).toBe("localhost:3111/site/alder-creek");
  });

  it("falls back to the bare path in production when no safe origin is configured, and encodes a hostile slug", () => {
    expect(platformSiteAddress("alder-creek", { NODE_ENV: "production" })).toBe("/site/alder-creek");
    expect(platformSiteAddress("a/b?c", { NODE_ENV: "production" })).toBe("/site/a%2Fb%3Fc");
  });
});
