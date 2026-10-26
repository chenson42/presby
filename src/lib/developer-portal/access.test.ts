import { describe, expect, it, vi } from "vitest";
import { decideDeveloperAccess } from "./access";

const yes = vi.fn(async () => true);
const no = vi.fn(async () => false);

describe("decideDeveloperAccess", () => {
  it("no user is signed out, and the predicate is never read", async () => {
    const read = vi.fn(async () => true);
    expect(await decideDeveloperAccess({ user: null, readEntitled: read })).toBe(
      "signed_out",
    );
    expect(
      await decideDeveloperAccess({ user: undefined, readEntitled: read }),
    ).toBe("signed_out");
    expect(read).not.toHaveBeenCalled();
  });

  it("a required, unverified second factor is challenged before the predicate is read", async () => {
    const read = vi.fn(async () => true);
    const verdict = await decideDeveloperAccess({
      user: { id: "u1", twoFactorRequired: true, twoFactorVerified: false },
      readEntitled: read,
    });
    expect(verdict).toBe("two_factor_required");
    expect(read).not.toHaveBeenCalled();
  });

  it("required with the verified flag absent is still a challenge", async () => {
    expect(
      await decideDeveloperAccess({
        user: { id: "u1", twoFactorRequired: true },
        readEntitled: yes,
      }),
    ).toBe("two_factor_required");
  });

  it("required and verified proceeds to the predicate", async () => {
    expect(
      await decideDeveloperAccess({
        user: { id: "u1", twoFactorRequired: true, twoFactorVerified: true },
        readEntitled: yes,
      }),
    ).toBe("ok");
  });

  it("an unverified flag with no requirement is not a challenge", async () => {
    expect(
      await decideDeveloperAccess({
        user: { id: "u1", twoFactorRequired: false, twoFactorVerified: false },
        readEntitled: yes,
      }),
    ).toBe("ok");
  });

  it("entitled is ok, and the reader receives the user id", async () => {
    const read = vi.fn(async () => true);
    expect(
      await decideDeveloperAccess({ user: { id: "u-42" }, readEntitled: read }),
    ).toBe("ok");
    expect(read).toHaveBeenCalledWith("u-42");
  });

  it("not entitled is forbidden", async () => {
    expect(
      await decideDeveloperAccess({ user: { id: "u1" }, readEntitled: no }),
    ).toBe("forbidden");
  });

  it("a throwing reader is unavailable, not forbidden", async () => {
    const boom = vi.fn(async () => {
      throw new Error("connection terminated");
    });
    expect(
      await decideDeveloperAccess({ user: { id: "u1" }, readEntitled: boom }),
    ).toBe("unavailable");
  });

  it("a reader that throws synchronously is unavailable too", async () => {
    const boom = (() => {
      throw new Error("sync failure");
    }) as unknown as (id: string) => Promise<boolean>;
    expect(
      await decideDeveloperAccess({ user: { id: "u1" }, readEntitled: boom }),
    ).toBe("unavailable");
  });
});
