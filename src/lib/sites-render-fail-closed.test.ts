/**
 * Pure-mock unit coverage for the DB-blip fail-closed behavior of
 * `getPublishedSite()` and `resolvePublishedOrganization()`
 * (docs/work-log/2026-09-26-public-render-blip.md).
 *
 * Deliberately a SEPARATE file from `sites.test.ts`, not new describe blocks
 * inside it: `sites.test.ts` is a real-Postgres integration suite
 * (`describe.skipIf(!hasDb)`) that needs `DATABASE_URL`/`PLATFORM_DATABASE_URL`
 * and writes/restores real fixture rows — appropriate for the CI `db-tests`
 * job (an ephemeral Neon branch), but this pipeline's own kickoff
 * deliberately provisions none ("no Neon branch — no schema change"), and
 * `.env.local` here is a read-only copy of `development` that must not take
 * a write. This file mocks `@/lib/db`, `@/lib/flags`, and
 * `@/lib/storage/blob-store` wholesale — same pattern `flags.test.ts` and
 * `authz.test.ts` already use for this exact class of function — so it runs
 * under plain `npm test` with no DB, no secrets, and no environment
 * dependency at all, and still exercises the identical `try/catch` this bug
 * lives in. `sites.test.ts` ALSO gained its own throwing-mock cases
 * (`vi.spyOn(db, "execute")`) matching its own existing house style, for
 * when the real-DB suite runs in CI — this file is not a replacement for
 * that coverage, it is the part of it that does not require a live database
 * to prove.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  db: { execute: vi.fn() },
  getPlatformDb: vi.fn(),
}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const resolveBlob = vi.fn();
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve: (...args: unknown[]) => resolveBlob(...args) }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPublishedSite, resolvePublishedOrganization } from "./sites";

const execute = vi.mocked(db.execute);

beforeEach(() => {
  execute.mockReset();
  isFlagEnabled.mockReset();
  isFlagEnabled.mockResolvedValue(true);
  resolveBlob.mockReset();
});

describe("getPublishedSite — fails closed on a DB read failure (not just the flag read)", () => {
  it("returns { kind: \"not_found\", reason: \"read_failed\" } — never throws — when the presby_published_site() read itself throws", async () => {
    execute.mockRejectedValueOnce(
      new Error(
        'Failed query: select * from presby_published_site($1)\nparams: fpcw,1',
      ),
    );

    await expect(getPublishedSite("fpcw")).resolves.toEqual({
      kind: "not_found",
      reason: "read_failed",
    });
  });

  it("returns the same read_failed result regardless of slug — a DB blip is not a per-slug oracle", async () => {
    execute.mockRejectedValueOnce(new Error("simulated transient DB error"));
    const realSlugOutcome = await getPublishedSite("fpcw");

    execute.mockRejectedValueOnce(new Error("simulated transient DB error"));
    const nonexistentSlugOutcome = await getPublishedSite(
      "definitely-not-a-real-slug",
    );

    expect(realSlugOutcome).toEqual(nonexistentSlugOutcome);
    expect(realSlugOutcome).toEqual({ kind: "not_found", reason: "read_failed" });
  });

  it("also fails closed when the row resolves but the blob resolve throws — a second, independent read inside the same function", async () => {
    execute.mockResolvedValueOnce({
      rows: [
        {
          organization_id: "org-1",
          organization_name: "Fixture Church",
          organization_type: "congregation",
          content_bundle_key: "bundle-key-1",
          brand_seed_hex: null,
          brand_type_pairing: null,
          brand_token_version: null,
          brand_light_only: null,
          profile_address: null,
          profile_phone: null,
          profile_facebook_url: null,
          profile_instagram_url: null,
          profile_x_twitter_url: null,
          profile_youtube_url: null,
          profile_other_url: null,
          service_times: null,
          office_hours: null,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof db.execute>>);
    resolveBlob.mockRejectedValueOnce(new Error("simulated blob-store DB blip"));

    await expect(getPublishedSite("fpcw")).resolves.toEqual({
      kind: "not_found",
      reason: "read_failed",
    });
  });

  it("logs only the slug on a DB error — never the caught error or its message (the SQL/params leak Phase 1 caught live)", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    execute.mockRejectedValueOnce(
      new Error(
        'Failed query: select * from presby_published_site($1)\nparams: fpcw,1',
      ),
    );

    await getPublishedSite("fpcw");

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(consoleErrorSpy.mock.calls[0]);
    expect(serialized).not.toMatch(/select|Failed query|params:/i);
    expect(serialized).toContain("fpcw");

    consoleErrorSpy.mockRestore();
  });

  it("still returns a confirmed-absent not_found with NO reason field when the flag is simply off — the try/catch wrap does not blur this case with a DB failure", async () => {
    isFlagEnabled.mockResolvedValue(false);

    await expect(getPublishedSite("fpcw")).resolves.toEqual({
      kind: "not_found",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("resolvePublishedOrganization — fails closed on a DB read failure", () => {
  it("returns null — never throws — when the read itself throws", async () => {
    execute.mockRejectedValueOnce(new Error("simulated transient DB error"));

    await expect(resolvePublishedOrganization("fpcw")).resolves.toBeNull();
  });

  it("logs only the slug on a DB error, never the caught error or its message", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    execute.mockRejectedValueOnce(
      new Error(
        'Failed query: select organization_id from presby_published_site($1)\nparams: fpcw,1',
      ),
    );

    await resolvePublishedOrganization("fpcw");

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(consoleErrorSpy.mock.calls[0]);
    expect(serialized).not.toMatch(/select|Failed query|params:/i);
    expect(serialized).toContain("fpcw");

    consoleErrorSpy.mockRestore();
  });
});
