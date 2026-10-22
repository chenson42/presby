import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  hashInvitationToken,
  isWellFormedInvitationToken,
  mintInvitationToken,
} from "./invitation-token";

describe("invitation-token", () => {
  it("mints a 43-character base64url token and its sha256 hex digest", () => {
    const { token, tokenHash } = mintInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  it("mints a different token every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) seen.add(mintInvitationToken().token);
    expect(seen.size).toBe(50);
  });

  it("hashes deterministically and distinguishes inputs", () => {
    expect(hashInvitationToken("abc")).toBe(hashInvitationToken("abc"));
    expect(hashInvitationToken("abc")).not.toBe(hashInvitationToken("abd"));
    // The documented sha256 of "abc".
    expect(hashInvitationToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("accepts only the exact minted shape", () => {
    expect(isWellFormedInvitationToken(mintInvitationToken().token)).toBe(true);
    expect(isWellFormedInvitationToken("")).toBe(false);
    expect(isWellFormedInvitationToken("a".repeat(42))).toBe(false);
    expect(isWellFormedInvitationToken("a".repeat(44))).toBe(false);
    expect(isWellFormedInvitationToken(`${"a".repeat(42)}=`)).toBe(false);
    expect(isWellFormedInvitationToken(`${"a".repeat(42)}+`)).toBe(false);
    expect(isWellFormedInvitationToken(`${"a".repeat(42)} `)).toBe(false);
    expect(isWellFormedInvitationToken(null)).toBe(false);
    expect(isWellFormedInvitationToken(undefined)).toBe(false);
    expect(isWellFormedInvitationToken(12345)).toBe(false);
  });
});
