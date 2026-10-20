import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeClaimInput } from "@/lib/domains/hostname-rules";
import { looksLikeApex } from "./claim-input";

const ENV = { NEXT_PUBLIC_APP_URL: "https://presbyportal.invalid", DOMAINS_ALLOW_RESERVED_TLDS: "1" };

describe("looksLikeApex agrees with the server's pairing heuristic", () => {
  it.each([
    "church-one.invalid",
    "CHURCH-ONE.invalid",
    "https://church-one.invalid/about?x=1",
    "church-one.invalid:8443",
    "church-one.invalid.",
    "  church-one.invalid  ",
    "www.church-one.invalid",
    "events.church-one.invalid",
    "church.co.uk",
    "church.org.uk",
    "www.church.co.uk",
    "a.b.c.church-one.invalid",
    "church.uk.invalid",
  ])("%s", (input) => {
    const server = normalizeClaimInput(input, ENV);
    expect(server.ok).toBe(true);
    if (!server.ok) return;
    expect(looksLikeApex(input)).toBe(server.pairable);
  });

  it("is false for nothing, for an empty label, and for a bare word", () => {
    expect(looksLikeApex("")).toBe(false);
    expect(looksLikeApex("   ")).toBe(false);
    expect(looksLikeApex("a..invalid")).toBe(false);
    expect(looksLikeApex("localhost")).toBe(false);
  });
});
